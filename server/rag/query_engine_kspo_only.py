# server/rag/query_engine_kspo_only.py
from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path
import os, json, re

from dotenv import load_dotenv
from openai import OpenAI

# 1) CSV kNN
from .query_engine_csv import retrieve_similar_structured
# 2) CSV 빈도 → KSPO 매칭/대표영상 선택(카테고리: 심폐지구력/근력·근지구력/유연성)
from .query_engine_kspo_videos import prescribe_from_freq_and_kspo

# ───────── .env 명시 로드 ─────────
SERVER_DIR = Path(__file__).resolve().parent.parent  # server/
ENV_PATH = SERVER_DIR / ".env"
load_dotenv(ENV_PATH)

_k = (os.getenv("OPENAI_API_KEY") or "").strip()
os.environ["OPENAI_API_KEY"] = _k

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    organization=os.getenv("OPENAI_ORG_ID")
)

VALID_CATS = ["심폐지구력", "근력/근지구력", "유연성"]

def _score_of(n: Dict[str, Any]) -> float:
    return float(n.get("combined_score") or n.get("raw_score") or n.get("score") or 0.0)

def _kspo_meta_path() -> str:
    return str(Path(__file__).resolve().parent / "embed_store" / "kspo_videos" / "kspo_meta.json")

def _acsm_meta_path() -> str:
    return str(Path(__file__).resolve().parent / "embed_store" / "acsm6" / "acsm6_meta.json")

# ✅ 정확 라벨 집합
AGE_BANDS = ["유아기", "유소년", "청소년", "성인", "어르신"]

# ✅ alias → 정확 라벨
_AGE_ALIASES = {
    "유아기": "유아기", "유아": "유아기",
    "유소년기": "유소년", "유소년": "유소년",
    "청소년기": "청소년", "청소년": "청소년",
    "성인기": "성인", "성인": "성인",
    "어르신기": "어르신", "어르신": "어르신", "노인": "어르신", "고령": "어르신",
}

def _norm_title(s: str) -> str:
    if not s: return ""
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"[·•\-:_/]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.lower()

def _canon_age_label(tok: str) -> Optional[str]:
    tok = (tok or "").strip()
    if tok in AGE_BANDS:
        return tok
    return _AGE_ALIASES.get(tok)

def _age_band_from_age(age: Optional[int]) -> str:
    try:
        a = int(age)
    except Exception:
        return "성인"
    if a <= 6:   return "유아기"
    if a <= 12:  return "유소년"
    if a <= 18:  return "청소년"
    if a <= 64:  return "성인"
    return "어르신"

def _band_distance(a: str, b: str) -> int:
    try:
        ia = AGE_BANDS.index(a); ib = AGE_BANDS.index(b)
        return abs(ia - ib)
    except ValueError:
        return 3

def _split_targets(s: str) -> List[str]:
    if not s: return []
    # 괄호 안 범위(예: 19~64세) 제거
    s = re.sub(r"\([^)]*\)", "", s)
    parts = re.split(r"[\/,\s|·]+", s.strip())
    out: List[str] = []
    for p in parts:
        canon = _canon_age_label(p)
        if canon and canon not in out:
            out.append(canon)
    return out

def _rerank_video_by_age_and_target(
    picked: Optional[Dict[str, Any]],
    *,
    title: str,
    category: str,
    user_age_band: str,
    meta_rows: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    norm_t = _norm_title(title)
    cands = [
        r for r in meta_rows
        if _norm_title(r.get("title") or "") == norm_t
        and (r.get("fitness_category") or "").strip() == (category or "").strip()
    ]
    if not cands:
        cands = [r for r in meta_rows if _norm_title(r.get("title") or "") == norm_t]
    if not cands:
        return picked

    def score(r: Dict[str, Any]) -> Tuple[int, int, int]:
        targets = _split_targets(r.get("target") or "")
        d = min((_band_distance(user_age_band, t) for t in targets), default=3)
        cat_penalty = 0 if (r.get("fitness_category") or "") == category else 2
        try:
            rank = int(r.get("rank_on_page") or 999)
        except Exception:
            rank = 999
        return (d, cat_penalty, rank)

    cands.sort(key=score)
    best = cands[0]
    if picked and best.get("youtube_id") != picked.get("youtube_id"):
        print(
            f"[KSPO-rerank] '{title}' ({category}) "
            f"user_band={user_age_band} -> {best.get('youtube_id')} "
            f"(target={best.get('target')}, rank={best.get('rank_on_page')})"
        )
    return best

# ───────── CSV 유사사례 텍스트에서 종목 토큰 수집 ─────────
def _extract_names_from_csv_neighbors(csv_neighbors: List[Dict[str, Any]]) -> Dict[str, int]:
    bag: Dict[str, int] = {}
    sep_re = re.compile(r"[;,/]| / |·|•|\n")
    clean_re = re.compile(r"\s+")
    for n in (csv_neighbors or []):
        text = f"{n.get('prescription_text') or ''} {n.get('prescription') or ''}"
        text = re.sub(r"(준비운동|본운동|정리운동)\s*:\s*", " ", text)
        parts = [p.strip() for p in sep_re.split(text) if p.strip()]
        for p in parts:
            if any(tok in p for tok in ["루틴프로그램","루틴 스트레칭","루틴","프로그램"]):
                continue
            p = re.sub(r"\d+\s*(세트|회|분|초|RM|%)", " ", p)
            p = re.sub(r"[()\[\]]", " ", p)
            p = clean_re.sub(" ", p).strip()
            if 1 <= len(p) <= 30:
                bag[p] = bag.get(p, 0) + 1
    return bag

# ───────── ACSM6 간단 후보 검색기 ─────────
def _load_acsm_meta() -> List[Dict[str, Any]]:
    p = _acsm_meta_path()
    if not os.path.exists(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return data.get("items", [])
    except Exception:
        return []

def _match_score(text: str, q_terms: List[str]) -> int:
    s = 0
    tl = text.lower()
    for t in q_terms:
        t = (t or "").lower().strip()
        if not t: continue
        if t in tl: s += 2
    return s

def _mk_terms(payload: Dict[str, Any]) -> List[str]:
    u = payload.get("user") or {}
    m = payload.get("measurements") or {}
    surveys = payload.get("surveys") or {}

    terms = [
        "유산소", "근력", "근지구력", "유연성",
        "빈도", "강도", "시간", "RPE", "HRR", "1RM", "정적 스트레칭",
    ]
    age = u.get("age")
    sex = (u.get("sex") or "").upper()
    if isinstance(age, (int, float)):
        if age >= 65: terms += ["고령자", "노인", "낙상", "균형"]
        elif age <= 18: terms += ["청소년", "소아"]
    if sex in ("F","M"): terms.append(f"성별:{sex}")

    if m.get("situp_reps") is not None: terms += ["복근", "체간", "코어"]
    if m.get("reach_cm") is not None: terms += ["좌전굴", "햄스트링", "유연성"]
    if m.get("step_vo2max") is not None: terms += ["VO2max", "심폐", "중강도", "고강도"]

    risk_flags = []
    # survey1/high_risk, survey4/frailty_flag 등 키워드가 있으면 안전 관련 용어 강화
    s1 = (surveys.get("survey1") or {})
    if s1.get("high_risk") is True: risk_flags.append("parq_high_risk")
    s4 = (surveys.get("survey4") or {})
    if s4.get("frailty_flag") is True: risk_flags.append("frailty_flag")
    if risk_flags:
        terms += ["안전", "금기", "모니터링", "고위험", "의학적 평가"]

    return list(dict.fromkeys(terms))

def retrieve_acsm_candidates(payload: Dict[str, Any], top_k: int = 8) -> List[Dict[str, Any]]:
    meta = _load_acsm_meta()
    if not meta:
        return []
    terms = _mk_terms(payload)
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for it in meta:
        text = " ".join([
            it.get("title") or "",
            " ".join(it.get("keywords") or []),
            it.get("excerpt") or ""
        ])
        s = _match_score(text, terms)
        if s > 0:
            scored.append((s, it))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [it for _, it in scored[:top_k]]

# ───────── 상태 리포트 ─────────
BASE = Path(__file__).resolve().parent
def rag_status() -> Dict[str, Any]:
    structured_store = BASE / "embed_store" / "csv"
    kspo_store = BASE / "embed_store" / "kspo_videos"
    acsm_store = BASE / "embed_store" / "acsm6"
    return {
        "csv_structured_files": {
            "index": (structured_store / "faiss_structured.index").exists(),
            "pipeline": (structured_store / "structured_pipeline.joblib").exists(),
            "meta": (structured_store / "structured_meta.json").exists(),
        },
        "kspo_video_files": {
            "meta": (kspo_store / "kspo_meta.json").exists(),
        },
        "acsm6_files": {
            "meta": (acsm_store / "acsm6_meta.json").exists(),
        },
    }

# ───────── KSPO 유형(T) & 헤더 고정 헬퍼 ─────────
def _type_line_for_category(cat: str, kspo_plan: Dict[str, Any], max_names: int = 2) -> str:
    freq_map = (kspo_plan.get("top_per_category", {}) or {}).get(cat) or {}
    top_names = list(freq_map.keys())[:max_names]
    v = (kspo_plan.get("videos", {}) or {}).get(cat) or {}
    vtitle = v.get("title") or "(대표영상 없음)"
    vyoutube = v.get("youtube_url") or ""
    names = ", ".join(top_names) if top_names else "(CSV 근거 부족)"
    if vyoutube:
        return f"{names} · 대표영상: {vtitle} (YouTube: {vyoutube})"
    return f"{names} · 대표영상: {vtitle}"

def _head_line_for_category(cat: str, kspo_plan: Dict[str, Any]) -> str:
    v = (kspo_plan.get("videos", {}) or {}).get(cat) or {}
    title = v.get("title")
    if title:
        return title
    freq_map = (kspo_plan.get("top_per_category", {}) or {}).get(cat) or {}
    if freq_map:
        return list(freq_map.keys())[0]
    return "(CSV 근거 부족)"

# ───────── 카드 포맷터(최종 양식 강제) ─────────
def _format_fitt_card(
    *,
    name: str,
    freq: str,
    inten: str,
    time_: str,
    type_text: str,
    video_title: str,
    rule_or_caution: str,
    csv_id: str = ""
) -> str:
    """
    요구된 최종 카드 양식으로 강제 포맷.
    (라벨 줄 + 값 줄 / 이모지 / CSV:숫자 라인까지 고정)
    """
    lines = [
        "종목",
        f"{name}",
        "빈도(F)",
        f"{freq}",
        "강도(I)",
        f"{inten}",
        "시간(T)",
        f"{time_}",
        "유형(T)",
        f"{type_text}",
        f"(대표영상: {video_title})",
        "진행규칙·주의",
        f"{rule_or_caution}",
        f"🎬 {video_title}",
    ]
    if str(csv_id).strip():
        lines.append(f"CSV:{csv_id}")
    return "\n".join(lines).strip()

# ───────── LLM 응답 파서(콜론/개행 둘 다 허용) ─────────
def _grab_after(label_pat: str, block: str) -> str:
    # "라벨\n값" 또는 "라벨: 값" 모두 허용
    m = re.search(rf"{label_pat}\s*\n\s*(.+)", block)
    if m: return m.group(1).strip()
    m = re.search(rf"{label_pat}\s*:\s*(.+)", block)
    return m.group(1).strip() if m else ""

def _csv_from(block: str) -> str:
    m = re.search(r"\[CSV:(\d+)\]", block)
    return m.group(1) if m else ""

def _cut(ans: str, start_pat: str, end_pats: List[str]) -> str:
    m = re.search(start_pat, ans)
    if not m: return ""
    s = m.start()
    ends = []
    for p in end_pats:
        mm = re.search(p, ans[s+1:])
        if mm: ends.append(s + 1 + mm.start())
    e = min(ends) if ends else len(ans)
    return ans[s:e].strip()

def _split_main_sections(ans: str) -> Tuple[str, str, str]:
    # 1) 유산소(심폐) 2) 근력/근지구력 3) 유연성
    a = _cut(ans, r"\b1\)\s*유산소\(심폐\)", [r"\n2\)\s*근력/근지구력", r"\n3\)\s*유연성", r"\n### "])
    s = _cut(ans, r"\b2\)\s*근력/근지구력", [r"\n3\)\s*유연성", r"\n### "])
    f = _cut(ans, r"\b3\)\s*유연성", [r"\n### "])
    return a or "", s or "", f or ""

# 추가: 설문 파생 블록 파서
def _extract_extra_blocks(ans: str) -> Dict[str, str]:
    # 헤더는 프롬프트에서 고정: "### 설문 1·4 기반 주의사항 (ACSM 근거)" 등
    b1 = _cut(ans, r"###\s*설문\s*1·4\s*기반\s*주의사항\s*\(ACSM 근거\)", ["\n### "])
    b2 = _cut(ans, r"###\s*설문\s*2\s*기반\s*상담/동기부여\s*\(ACSM 근거\)", ["\n### "])
    b3 = _cut(ans, r"###\s*설문\s*3\s*기반\s*달성\s*전략", ["\n### "])
    return {
        "survey14_caution": b1.strip(),
        "survey2_motivation": b2.strip(),
        "survey3_action": b3.strip(),
    }

def _cards_from_llm(answer: str, kspo_plan: Dict[str, Any], csv_neighbors: List[Dict[str, Any]]) -> str:
    a_blk, s_blk, f_blk = _split_main_sections(answer)

    # 유산소
    a_name = _grab_after(r"종목", a_blk)
    a_freq = _grab_after(r"빈도\(F\)", a_blk) or "주 3회"
    a_intn = _grab_after(r"강도\(I\)", a_blk) or "심박수 120~150 bpm 또는 RPE 12-15"
    a_time = _grab_after(r"시간\(T\)", a_blk) or "회당 30분"
    a_type = _grab_after(r"유형\(T\)", a_blk) or _type_line_for_category("심폐지구력", kspo_plan)
    a_rule = _grab_after(r"진행규칙·주의", a_blk) or "유산소 전 동적 스트레칭 포함, 통증 시 즉시 중단."
    a_csv  = _csv_from(a_blk) or str((csv_neighbors or [{}])[0].get("row_id") or "")
    v_a = (kspo_plan.get("videos", {}) or {}).get("심폐지구력") or {}
    a_video = v_a.get("title") or _head_line_for_category("심폐지구력", kspo_plan)

    # 근력/근지구력
    s_name = _grab_after(r"종목", s_blk)
    s_freq = _grab_after(r"빈도\(F\)", s_blk) or "주 2~3회(비연속일)"
    s_intn = _grab_after(r"강도\(I\)", s_blk) or "1RM 60% 또는 10~15회 가능 중량"
    s_time = _grab_after(r"시간\(T\)", s_blk) or "회당 20~40분"
    s_type = _grab_after(r"유형\(T\)", s_blk) or _type_line_for_category("근력/근지구력", kspo_plan)
    s_rule = _grab_after(r"주의/대안", s_blk) or "통증 없는 범위, 세트 간 60~90초 휴식."
    s_csv  = _csv_from(s_blk) or str((csv_neighbors or [{}])[0].get("row_id") or "")
    v_s = (kspo_plan.get("videos", {}) or {}).get("근력/근지구력") or {}
    s_video = v_s.get("title") or _head_line_for_category("근력/근지구력", kspo_plan)

    # 유연성
    f_name = _grab_after(r"종목", f_blk)
    f_freq = _grab_after(r"빈도\(F\)", f_blk) or "주 3~5회"
    f_intn = _grab_after(r"강도\(I\)", f_blk) or "통증 없는 범위에서 천천히 신장"
    f_time = _grab_after(r"시간\(T\)", f_blk) or "부위당 20~30초×2~4세트"
    f_type = _grab_after(r"유형\(T\)", f_blk) or _type_line_for_category("유연성", kspo_plan)
    f_rule = "호흡을 참지 말고 반동 없이 유지."
    f_csv  = _csv_from(f_blk) or str((csv_neighbors or [{}])[0].get("row_id") or "")
    v_f = (kspo_plan.get("videos", {}) or {}).get("유연성") or {}
    f_video = v_f.get("title") or _head_line_for_category("유연성", kspo_plan)

    card_aero = _format_fitt_card(
        name=a_name or _head_line_for_category("심폐지구력", kspo_plan),
        freq=a_freq, inten=a_intn, time_=a_time,
        type_text=a_type, video_title=a_video,
        rule_or_caution=a_rule, csv_id=a_csv
    )
    card_strn = _format_fitt_card(
        name=s_name or _head_line_for_category("근력/근지구력", kspo_plan),
        freq=s_freq, inten=s_intn, time_=s_time,
        type_text=s_type, video_title=s_video,
        rule_or_caution=s_rule, csv_id=s_csv
    )
    card_flex = _format_fitt_card(
        name=f_name or _head_line_for_category("유연성", kspo_plan),
        freq=f_freq, inten=f_intn, time_=f_time,
        type_text=f_type, video_title=f_video,
        rule_or_caution=f_rule, csv_id=f_csv
    )
    return "\n\n".join([card_aero, card_strn, card_flex]) + "\n"

# ───────── OpenAI 호출 ─────────
def call_openai(system_prompt: str, user_prompt: str) -> str:
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            max_tokens=1200,
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception as e:
        return f"⚠️ LLM 호출 중 오류 발생: {e}"

def _fmt_allowlist(top_per_category: Dict[str, Dict[str,int]], videos: Dict[str, Any], n:int=5) -> str:
    out = ["### 허용 종목/대표 영상 (카테고리별)"]
    for cat in VALID_CATS:
        freq_map = top_per_category.get(cat) or {}
        names_sorted = sorted(freq_map.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
        names = [f"{i+1}. {name} (x{cnt})" for i, (name, cnt) in enumerate(names_sorted)]
        v = (videos or {}).get(cat) or {}
        vline = f"- 대표영상: {v.get('title','(없음)')} (YouTube: {v.get('youtube_url','')})"
        out.append(f"\n**{cat}**\n- 허용 종목 Top{n}: " + (", ".join(names) if names else "(없음)") + f"\n{vline}")
    return "\n".join(out)

def _fmt_csv_block(csv_neighbors: List[Dict[str, Any]]) -> str:
    lines = []
    for n in (csv_neighbors or []):
        score = _score_of(n)
        lines.append(
            f"[CSV:{n.get('row_id')}] (유사도 {score:.2f}) "
            f"성별 {n.get('sex')} · 나이 {n.get('age')} · BMI {n.get('bmi')} · "
            f"싯업 {n.get('situp_reps')} · 좌전굴 {n.get('reach_cm')}cm · VO₂max {n.get('vo2max')}\n"
            f"처방 요약: {(n.get('prescription_text') or '').strip()}"
        )
    return "\n\n".join(lines) if lines else "(유사 사례 없음)"

def _fmt_acsm_block(cands: List[Dict[str, Any]]) -> str:
    if not cands:
        return "(ACSM6 근거 없음)"
    lines = []
    for it in cands:
        did = it.get("doc_id") or "ACSM6:UNK"
        title = it.get("title") or "(제목 없음)"
        excerpt = (it.get("excerpt") or "").strip()
        if len(excerpt) > 240:
            excerpt = excerpt[:240].rstrip() + "…"
        lines.append(f"[ACSM6:{did}] {title}\n- 핵심: {excerpt}")
    return "\n\n".join(lines)

def build_kspo_prompt(payload: Dict[str, Any],
                      csv_neighbors: List[Dict[str, Any]],
                      kspo_plan: Dict[str, Any],
                      acsm_cands: List[Dict[str, Any]]) -> Dict[str, str]:
    u = payload.get("user", {}) or {}
    m = payload.get("measurements", {}) or {}
    surveys = payload.get("surveys", {}) or {}

    allow_md = _fmt_allowlist(kspo_plan.get("top_per_category", {}), kspo_plan.get("videos", {}))
    csv_md   = _fmt_csv_block(csv_neighbors)
    acsm_md  = _fmt_acsm_block(acsm_cands)

    # ── SYSTEM: 설문 규칙 + 안전 원칙 + 자리표시자 유지 지시 ──
    system = (
        "당신은 임상 운동전문가이자 운동처방 코치입니다. 한국어로 작성합니다. "
        "아래 ‘출력 형식’의 제목/라벨/순서/구두점을 1자도 바꾸지 말고 그대로 채우세요. "
        "유형(T) 자리표시자(<<TYPE_*>>)와 종목 헤드(<<HEAD_*>>)는 그대로 출력합니다(후처리로 치환됨). "
        "모든 권고 항목의 근거는 [CSV:row_id], [ACSM6:doc_id]를 반드시 포함하세요.\n"
        "[데이터 원칙]\n"
        "- KSPO 허용 리스트 내 종목/영상만 사용.\n"
        "- FITT 수치를 명확히 제시.\n"
        "- 안전 최우선: PAR-Q/노쇠 신호가 있으면 저강도/점진·증상 모니터링·의료상담 권고.\n"
        "[설문 해석 규칙]\n"
        "- 설문1(PAR-Q): Q2=예(운동 시 흉통) → 저강도 시작, 증상 모니터링, 의료평가 권고. "
        "Q5=예(근골격 문제) → 통증 유발 동작 회피·ROM 내 수행·저충격 대체. high_risk=true → 초기 1~2주 RPE 9~11.\n"
        "- 설문4(노쇠): frailty_flag=true 또는 피로/보행곤란=예 → 균형·기능 중심, 세트·시간 축소, 휴식 연장.\n"
        "- 설문2(목적/장벽): ‘체력측정(채용용)’이면 검사 점수 향상 지향(기본기·안전·규칙성). "
        "장벽: 흥미부재→게임화/챌린지, 효과불확실→주간 지표 시각화(RPE·휴식심박·세트수), 시간부족→10~15분 블록, 통증→저강도·대체동작.\n"
        "- 설문3(IPAQ): MET 변환(고강도8.0·중강도4.0·걷기3.3)으로 주간 총량 분류(≥3000 높음/≥600 중간/그 외 낮음). "
        "앉아있기 ≥120분/일 → 30~45분마다 1~2분 기립/보행. 고강도 과다 시 중강도·휴식일 배치.\n"
    )

    # ── USER: 요약 + 허용리스트 + 근거 + 설문 JSON + 출력 템플릿 ──
    user_prompt = (
        "=== 사용자 요약 ===\n"
        f"성별: {u.get('sex')} | 나이: {u.get('age')}\n"
        f"키/체중/BMI: {u.get('height_cm')}cm / {u.get('weight_kg')}kg / {u.get('bmi')}\n"
        f"측정치: 싯업 {m.get('situp_reps')}회 · 좌전굴 {m.get('reach_cm')}cm · VO₂max {m.get('step_vo2max')}\n"
        "\n=== 허용 리스트(필수 준수; KSPO 매칭 결과) ===\n" + allow_md +
        "\n\n=== 유사 사례 근거 Top-K (CSV) ===\n" + csv_md +
        "\n\n=== ACSM6 근거 후보 ===\n" + acsm_md +
        "\n\n=== 설문 JSON ===\n" + json.dumps(surveys, ensure_ascii=False) +
        "\n\n[출력 형식]\n"
        "맞춤 운동처방 (4~6주)\n"
        "1) 유산소(심폐)\n"
        "종목: <<HEAD_AERO>>\n"
        "\n"
        "빈도(F): 주 3회\n"
        "강도(I): 심박수 XX~YY bpm 또는 RPE XX\n"
        "시간(T): 회당 XX분\n"
        "유형(T): <<TYPE_AERO>>\n"
        "진행규칙·주의: …\n"
        "근거: [CSV:row_id], [ACSM6:doc_id]\n"
        "2) 근력/근지구력\n"
        "종목: <<HEAD_STRENGTH>>\n"
        "\n"
        "빈도(F): 주 2회\n"
        "강도(I): 1RM XX% 또는 X~Y회 가능 중량\n"
        "시간(T): X세트×Y회, 세트 간 ZZ초\n"
        "유형(T): <<TYPE_STRENGTH>>\n"
        "주의/대안: …\n"
        "근거: [CSV:row_id], [ACSM6:doc_id]\n"
        "3) 유연성\n"
        "종목: <<HEAD_FLEX>>\n"
        "\n"
        "빈도(F): 주 4회\n"
        "시간(T): 부위당 XX초×X세트\n"
        "강도(I): 통증 없는 범위\n"
        "유형(T): <<TYPE_FLEX>>\n"
        "근거: [CSV:row_id], [ACSM6:doc_id]\n"
        "\n"
        "근거 추적표\n"
        "| 항목 | 선택 이유(핵심) | CSV | ACSM6 |\n"
        "|---|---|---|---|\n"
        "\n"
        "### 설문 1·4 기반 주의사항 (ACSM 근거)\n"
        "- …\n"
        "\n"
        "### 설문 2 기반 상담/동기부여 (ACSM 근거)\n"
        "- …\n"
        "\n"
        "### 설문 3 기반 달성 전략\n"
        "- …\n"
    )
    return {"system": system, "user": user_prompt}

def generate_prescription_kspo_only(
    payload: Dict[str, Any],
    *,
    top_k: int = 10,
    per_cat: int = 1,      # (현재 미사용; 인터페이스 유지)
    acsm_top_k: int = 8
) -> Dict[str, Any]:
    # 1) CSV 유사 사례
    u = payload.get("user", {}) or {}
    m = payload.get("measurements", {}) or {}
    csv_neighbors = retrieve_similar_structured(u, m, top_k=top_k, overfetch=top_k*10)

    # 2) CSV 사례 텍스트 → 종목 빈도 dict
    freq = _extract_names_from_csv_neighbors(csv_neighbors)

    # 3) KSPO 매칭/대표영상(초기 선택; 나이 우선 적용)
    kspo_meta_path = _kspo_meta_path()
    user_age = (payload.get("user") or {}).get("age")
    kspo_plan = prescribe_from_freq_and_kspo(freq, kspo_meta_path, user_age=user_age)

    # 3-1) 동일 제목 중복 시 target(정확 라벨) 우선 재랭크
    meta_rows = _load_json_list(_kspo_meta_path())
    user_band = _age_band_from_age(user_age)
    for cat in VALID_CATS:
        v = (kspo_plan.get("videos", {}) or {}).get(cat) or {}
        title = v.get("title") or ""
        if not title:
            continue
        best = _rerank_video_by_age_and_target(
            picked=v, title=title, category=cat,
            user_age_band=user_band, meta_rows=meta_rows,
        )
        if best and best is not v:
            kspo_plan["videos"][cat] = best

    # 4) ACSM6 근거 후보
    acsm_cands = retrieve_acsm_candidates(payload, top_k=acsm_top_k)

    # 5) 프롬프트 생성 및 호출
    prompts = build_kspo_prompt(payload, csv_neighbors, kspo_plan, acsm_cands)
    answer = call_openai(prompts["system"], prompts["user"]) or ""

    # 6) 자리표시자 치환
    aero_head = _head_line_for_category("심폐지구력", kspo_plan)
    str_head  = _head_line_for_category("근력/근지구력", kspo_plan)
    flex_head = _head_line_for_category("유연성", kspo_plan)

    aero_line = _type_line_for_category("심폐지구력", kspo_plan)
    str_line  = _type_line_for_category("근력/근지구력", kspo_plan)
    flex_line = _type_line_for_category("유연성", kspo_plan)

    answer = (answer
        .replace("<<HEAD_AERO>>", aero_head)
        .replace("<<HEAD_STRENGTH>>", str_head)
        .replace("<<HEAD_FLEX>>", flex_head)
        .replace("<<TYPE_AERO>>", aero_line)
        .replace("<<TYPE_STRENGTH>>", str_line)
        .replace("<<TYPE_FLEX>>", flex_line)
    )

    # 7) 메인 3종 카드 변환
    cards_text = _cards_from_llm(answer, kspo_plan, csv_neighbors)

    # 7-1) 설문 파생 블록 추출
    extra = _extract_extra_blocks(answer)
    extra_md_parts = []
    if extra.get("survey14_caution"):
        extra_md_parts.append("### 설문 1·4 기반 주의사항 (ACSM 근거)\n" + extra["survey14_caution"].strip())
    if extra.get("survey2_motivation"):
        extra_md_parts.append("### 설문 2 기반 상담/동기부여 (ACSM 근거)\n" + extra["survey2_motivation"].strip())
    if extra.get("survey3_action"):
        extra_md_parts.append("### 설문 3 기반 달성 전략\n" + extra["survey3_action"].strip())
    extra_md = ("\n\n" + "\n\n".join(extra_md_parts)) if extra_md_parts else ""

    # 8) 대표 영상 필드 정규화 (디버그/프런트 부가정보)
    def _as_int(x):
        try: return int(float(x))
        except Exception: return None
    def _project_video(v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not v: return None
        return {
            "title": v.get("title") or "",
            "fitness_category": v.get("fitness_category") or "",
            "tool": v.get("tool") or "",
            "body_part": v.get("body_part") or "",
            "target": v.get("target") or "",
            "disease": v.get("disease") or "",
            "youtube_id": v.get("youtube_id") or "",
            "youtube_url": v.get("youtube_url") or "",
            "thumb_url": v.get("thumb_url") or "",
            "page_no": _as_int(v.get("page_no")),
            "rank_on_page": _as_int(v.get("rank_on_page")),
        }
    videos_projected = {cat: _project_video(kspo_plan.get("videos", {}).get(cat)) for cat in VALID_CATS}

    # 9) 최종 반환
    return {
        "planText": {
            # 프런트에서는 planMd처럼 그대로 뿌려도 됨(카드 3종 + 설문 파생 블록)
            "planText": (cards_text + extra_md).strip(),
            "cardsOnly": cards_text.strip(),
            "surveyBlocks": extra,  # 개별 접근이 필요할 때 사용
            "debug": {
                "query": "csv-kNN → KSPO allow-list + ACSM6 (+age-target rerank)",
                "args": {"top_k": top_k, "per_cat": per_cat, "acsm_top_k": acsm_top_k},
                "retrieved_csv": [
                    {"score": _score_of(n), "meta": {"row_id": n.get("row_id")}}
                    for n in (csv_neighbors or [])
                ],
                "kspo_top_per_category": kspo_plan.get("top_per_category", {}),
                "kspo_videos": videos_projected,
                "acsm_candidates": [
                    {"doc_id": c.get("doc_id"), "title": c.get("title")}
                    for c in (acsm_cands or [])
                ],
                "rag_status": rag_status(),
            },
        },
        "case_refs": csv_neighbors,
        "kspo": {
            "top_per_category": kspo_plan.get("top_per_category", {}),
            "videos": videos_projected,
            "unknown_items": kspo_plan.get("unknown_items", []),
            "categorized": kspo_plan.get("categorized", {}),
            "freq": kspo_plan.get("freq", {}),
        },
        "acsm6": {
            "candidates": acsm_cands or [],
        },
    }

# 내부: 메타 로드(JSON list 지원)
def _load_json_list(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        # 혹시 {"docs":[...]} 형태일 수도 있음
        return data.get("docs") or data.get("items") or []
    except Exception:
        return []

def _get_openai_client() -> OpenAI:
    return client

__all__ = ["generate_prescription_kspo_only", "rag_status", "_get_openai_client"]
