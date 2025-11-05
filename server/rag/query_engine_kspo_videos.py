# server/rag/query_engine_kspo_videos.py  (단독 실행/임포트 모두 가능)
from __future__ import annotations
from typing import Dict, List, Tuple, Any, Optional
from pathlib import Path
import pandas as pd
import json
import re
import argparse

# ──────────────────────────────────────────────────────────
# 상수
# ──────────────────────────────────────────────────────────
VALID_CATS = ["심폐지구력", "근력/근지구력", "유연성"]
# 메타데이터 target은 아래 값 중 하나가 "정확히" 들어온다고 가정
AGE_BANDS  = ["유아기", "유소년기", "청소년기", "성인기", "어르신기"]

# 혹시 모를 변형 표기를 최소 범위에서 정규화(안 들어오면 무시)
_AGE_ALIASES = {
    "유아": "유아기",
    "유소년": "유소년기",
    "청소년": "청소년기",
    "성인": "성인기",
    "어르신": "어르신기", "노인": "어르신기", "고령": "어르신기",
}

# ──────────────────────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────────────────────
def _norm(s: Any) -> str:
    if s is None: return ""
    return re.sub(r"\s+", " ", str(s)).strip()

def _norm_title(s: str) -> str:
    s = _norm(s)
    s = re.sub(r"\([^)]*\)", " ", s)     # (…)
    s = re.sub(r"\[[^\]]*\]", " ", s)    # […]
    s = re.sub(r"[·•\-:_/]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.lower()

def _age_band_from_age(age: Optional[int]) -> str:
    try:
        a = int(age)
    except Exception:
        return "성인기"
    if a <= 6:   return "유아기"
    if a <= 12:  return "유소년기"
    if a <= 18:  return "청소년기"
    if a <= 64:  return "성인기"
    return "어르신기"

def _band_distance(a: str, b: str) -> int:
    try:
        ia = AGE_BANDS.index(a); ib = AGE_BANDS.index(b)
        return abs(ia - ib)
    except ValueError:
        # 모르는 라벨이 들어오면 멀다고 가정
        return 3

def _canon_age_label(s: str) -> Optional[str]:
    s = (s or "").strip()
    if s in AGE_BANDS:
        return s
    # 간단한 alias 대응(안 들어오면 None)
    return _AGE_ALIASES.get(s)

def _split_targets_exact(s: str) -> List[str]:
    """
    메타데이터의 target은 '유아기/유소년기/청소년기/성인기/어르신기' 중 하나가
    '정확히' 들어온다고 가정. 혹시 복수라면 구분자(/, 공백, 콤마 등)로 분리.
    """
    if not s: return []
    parts = re.split(r"[\/,|·\s]+", s.strip())
    out: List[str] = []
    for p in parts:
        canon = _canon_age_label(p)
        if canon and canon not in out:
            out.append(canon)
    return out

# ──────────────────────────────────────────────────────────
# 데이터 로딩
# ──────────────────────────────────────────────────────────
def _load_kspo_meta(path: str) -> pd.DataFrame:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"[KSPO] not found: {p}")

    if p.suffix.lower() == ".json":
        raw = json.loads(p.read_text(encoding="utf-8"))
        rows = raw["docs"] if isinstance(raw, dict) and "docs" in raw else raw
        df = pd.DataFrame(rows)
    else:
        df = pd.read_csv(p, encoding="utf-8-sig")

    for c in ["title","fitness_category","page_no","rank_on_page",
              "youtube_url","thumb_url","youtube_id","target"]:
        if c not in df.columns:
            df[c] = None

    df["title"] = df["title"].astype(str).map(_norm)
    df["fitness_category"] = df["fitness_category"].astype(str).map(_norm)
    df["page_no"] = pd.to_numeric(df["page_no"], errors="coerce")
    df["rank_on_page"] = pd.to_numeric(df["rank_on_page"], errors="coerce")

    # 우리가 사용하는 3개 카테고리만
    df = df[df["fitness_category"].isin(VALID_CATS)].copy()

    # 캐시용
    df["_norm_title"] = df["title"].map(_norm_title)
    return df

# ──────────────────────────────────────────────────────────
# CSV 빈도 → KSPO 카테고리 매핑
# ──────────────────────────────────────────────────────────
def map_items_to_category_by_title(
    freq: Dict[str, int], kspo_df: pd.DataFrame
) -> Tuple[Dict[str, List[Tuple[str,int]]], List[str]]:
    """
    CSV에서 뽑힌 '원문 종목명'이 포함된 KSPO title의 fitness_category로 분류.
    """
    by_cat: Dict[str, List[Tuple[str,int]]] = {c: [] for c in VALID_CATS}
    unknown: List[str] = []

    for name, cnt in (freq or {}).items():
        key = _norm(name)
        if not key:
            continue

        sub = kspo_df[kspo_df["title"].str.contains(re.escape(key), case=False, na=False)]
        if sub.empty:
            unknown.append(key)
            continue

        cat_counts = sub["fitness_category"].value_counts()
        picked_cat = cat_counts.index[0]
        if picked_cat in VALID_CATS:
            by_cat[picked_cat].append((key, int(cnt)))
        else:
            unknown.append(key)

    # 카테고리별 빈도 내림차순
    for c in VALID_CATS:
        by_cat[c].sort(key=lambda x: x[1], reverse=True)

    return by_cat, unknown

def choose_top_one_per_category(by_cat: Dict[str, List[Tuple[str,int]]]) -> Dict[str, Dict[str,int]]:
    top: Dict[str, Dict[str,int]] = {}
    for c in VALID_CATS:
        lst = by_cat.get(c, [])
        top[c] = {lst[0][0]: lst[0][1]} if lst else {}
    return top

# ──────────────────────────────────────────────────────────
# 대표영상 선택(나이대 1순위 → 페이지/랭크)
# ──────────────────────────────────────────────────────────
def choose_representative_video(
    kspo_df: pd.DataFrame,
    category: str,
    item_name: str,
    *,
    user_age: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    if not item_name:
        return None

    # 1) 카테고리 전체 후보
    sub_all = kspo_df[kspo_df["fitness_category"] == category].copy()
    if sub_all.empty:
        return None

    # 2) 제목 일치(부드러운 가중치에만 사용)
    sub_match = sub_all[sub_all["title"].str.contains(re.escape(item_name), case=False, na=False)].copy()

    user_band = _age_band_from_age(user_age)

    def _age_distance_row(r) -> int:
        targets = _split_targets_exact(r.get("target") or "")
        if not targets:
            return 3
        return min(_band_distance(user_band, t) for t in targets)

    # 3) 카테고리 전체에 대해 age_d 계산
    sub_all["age_d"]  = sub_all.apply(_age_distance_row, axis=1).astype(int)
    sub_all["page_s"] = pd.to_numeric(sub_all["page_no"], errors="coerce").fillna(999.0)
    sub_all["rank_s"] = pd.to_numeric(sub_all["rank_on_page"], errors="coerce").fillna(999.0)

    # 4) 가장 가까운 나이대(min_age_d)만 남김 → 나이 우선
    min_age = sub_all["age_d"].min()
    near = sub_all[sub_all["age_d"] == min_age].copy()

    # 5) 그 안에서 제목일치 보너스(일치=0, 불일치=1 → 일치가 먼저 오도록)
    if not sub_match.empty:
        near["_title_penalty"] = (~near["title"].str.contains(re.escape(item_name), case=False, na=False)).astype(int)
    else:
        near["_title_penalty"] = 1  # 일치 후보가 전혀 없으면 패널티 동일

    # 6) 안정 정렬: 나이동일 집합 내에서 (제목일치 우선) → page → rank
    near = near.sort_values(
        by=["_title_penalty", "page_s", "rank_s"],
        ascending=[True, True, True],
        kind="mergesort",
    )

    picked = near.iloc[0].to_dict()
    picked["_debug"] = {
        "user_band": user_band,
        "targets": _split_targets_exact(picked.get("target") or ""),
        "age_d": int(picked.get("age_d", 999)),
        "page_s": float(picked.get("page_s", 999)),
        "rank_s": float(picked.get("rank_s", 999)),
        "title_contains_item": 0 if picked.get("_title_penalty", 1) == 0 else 1,
    }
    for c in ["age_d","page_s","rank_s","_title_penalty"]:
        if c in picked: del picked[c]
    return picked

# ──────────────────────────────────────────────────────────
# 💡 빠져있던 공개 API: CSV 빈도 → KSPO 매칭 + 대표영상 선택
# ──────────────────────────────────────────────────────────
def prescribe_from_freq_and_kspo(
    freq: Dict[str, int],
    kspo_meta_path: str,
    *,
    user_age: Optional[int] = None
) -> Dict[str, Any]:
    """
    1) KSPO 메타 로드
    2) CSV 종목명 → 카테고리 매핑
    3) 카테고리별 Top1 종목 선택
    4) 대표영상은 [나이대 최우선] → (제목일치 보너스) → page/rank 순으로 선택
    """
    df = _load_kspo_meta(kspo_meta_path)
    by_cat, unknown = map_items_to_category_by_title(freq, df)
    top = choose_top_one_per_category(by_cat)

    videos: Dict[str, Optional[Dict[str, Any]]] = {}
    for cat in VALID_CATS:
        chosen_item = next(iter(top.get(cat, {}).keys()), "")
        videos[cat] = choose_representative_video(df, cat, chosen_item, user_age=user_age)

    return {
        "freq": freq,
        "categorized": by_cat,
        "top_per_category": top,
        "videos": videos,           # 각 항목에 _debug 포함
        "unknown_items": unknown,
    }

# ──────────────────────────────────────────────────────────
# CLI(테스트용): 어떤 영상이 선택되는지 미리보기
# ──────────────────────────────────────────────────────────
def _pp(d: Dict[str, Any]) -> str:
    return json.dumps(d, ensure_ascii=False)

def preview_recommendations(kspo_path: str, freq: Dict[str, int], user_age: Optional[int]):
    plan = prescribe_from_freq_and_kspo(freq, kspo_path, user_age=user_age)
    videos = plan["videos"]

    print("\n=== 추천 대표영상 (나이대 우선 재랭크 적용) ===")
    for cat in VALID_CATS:
        v = videos.get(cat)
        if not v:
            print(f"- {cat}: (없음)")
            continue
        dbg = v.get("_debug", {})
        print(f"- {cat}")
        print(f"  · title      : {v.get('title')}")
        print(f"  · youtube_url: {v.get('youtube_url')}")
        print(f"  · target     : {v.get('target')}")
        print(f"  · page/rank  : {v.get('page_no')} / {v.get('rank_on_page')}")
        print(f"  · 디버그      : user_band={dbg.get('user_band')} "
              f"targets={dbg.get('targets')} age_d={dbg.get('age_d')} "
              f"page_s={dbg.get('page_s')} rank_s={dbg.get('rank_s')}")
    print("\n=== 근거(빈도 Top1) ===")
    for cat in VALID_CATS:
        print(f"- {cat}: {list((plan['top_per_category'].get(cat) or {}).keys())[:1]}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--kspo", required=True, help="kspo_meta.json 또는 .csv 경로")
    parser.add_argument("--age", type=int, default=50, help="사용자 나이 (기본 50)")
    args = parser.parse_args()

    # 예시 freq (실사용에선 파이프라인에서 주입)
    freq = {
        "동적 스트레칭 루틴프로그램": 1,
        "달리기": 2,
        "줄넘기": 1,
        "정적 스트레칭 루틴프로그램": 1,
        "실내 자전거타기": 1,
        "정적 스트레칭": 2,
        "유산소 운동 전 동적 루틴 스트레칭": 1,
        "버피 테스트": 1,
        "맨몸운동": 1,
    }

    preview_recommendations(args.kspo, freq, args.age)
