# ───────────────────────────────────────────────
# server/rag/query_engine.py  (FINAL)
# ───────────────────────────────────────────────
from __future__ import annotations
import os, json, re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from openai import OpenAI

from .query_engine_csv import retrieve_similar_structured
from .query_engine_acsm6 import retrieve_guidelines_acsm6

# ───────── .env 명시 로드 ─────────
SERVER_DIR = Path(__file__).resolve().parent.parent  # server/
ENV_PATH = SERVER_DIR / ".env"
load_dotenv(ENV_PATH)

# 디버그: 키 로드 확인
_k = (os.getenv("OPENAI_API_KEY") or "").strip()
print(f"[RAG] OPENAI_API_KEY loaded? {bool(_k)}  len={len(_k)}  prefix={_k[:7]}  suffix={_k[-4:]}")
os.environ["OPENAI_API_KEY"] = _k

# ───────── OpenAI Client ─────────
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    organization=os.getenv("OPENAI_ORG_ID")  # 없으면 None
)

# ───────── 유틸(안전 변환/버킷팅) ─────────
def _safe_int(x, default: int = 0) -> int:
    try:
        if x is None or str(x).strip() == "":
            return default
        return int(float(x))
    except Exception:
        return default

def _safe_float(x, default: float = 0.0) -> float:
    try:
        if x is None or str(x).strip() == "":
            return default
        return float(x)
    except Exception:
        return default

def _bmi_bucket(bmi: Optional[float]) -> str:
    if bmi is None: return "unknown-bmi"
    if bmi < 18.5: return "underweight"
    if bmi < 23:   return "normal"
    if bmi < 25:   return "overweight-risk"
    if bmi < 30:   return "overweight"
    return "obese"

def _situp_grade(reps: int) -> str:
    return "excellent" if reps>=40 else "good" if reps>=30 else "fair" if reps>=20 else "poor" if reps>=10 else "very-poor"

def _reach_grade(cm: float) -> str:
    return "excellent" if cm>=15 else "good" if cm>=10 else "fair" if cm>=5 else "poor" if cm>=0 else "very-poor"

def _vo2_bucket(vo2: Optional[float]) -> str:
    if vo2 is None: return "unknown-vo2"
    return "excellent" if vo2>=45 else "good" if vo2>=40 else "fair" if vo2>=35 else "poor" if vo2>=30 else "very-poor"

# ───────── 상태 리포트 ─────────
BASE = Path(__file__).resolve().parent
def rag_status() -> Dict[str, Any]:
    structured_store = BASE / "embed_store" / "csv"
    return {
        "csv_structured_files": {
            "index": (structured_store / "faiss_structured.index").exists(),
            "pipeline": (structured_store / "structured_pipeline.joblib").exists(),
            "meta": (structured_store / "structured_meta.json").exists(),
        },
    }

# ───────── LLM 호출 ─────────
def call_openai(system_prompt: str, user_prompt: str) -> str:
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            max_tokens=900,
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception as e:
        return f"⚠️ LLM 호출 중 오류 발생: {e}"

# ───────── 프롬프트(사례+가이드라인 이원 컨텍스트) ─────────
def build_dual_prompt(payload: Dict[str, Any],
                      csv_neighbors: List[Dict[str, Any]],
                      acsm_guides: List[Dict[str, Any]]) -> Dict[str, str]:
    import json as _json
    u = payload.get("user", {}) or {}
    m = payload.get("measurements", {}) or {}

    user_summary = (
        f"- 성별: {u.get('sex')}\n"
        f"- 나이: {u.get('age')}\n"
        f"- 키/체중/BMI: {u.get('height_cm')}cm / {u.get('weight_kg')}kg / {u.get('bmi')}\n"
        f"- 측정치: 싯업 {m.get('situp_reps')}회, 좌전굴 {m.get('reach_cm')}cm, VO₂max {m.get('step_vo2max')}\n"
        f"- 상태 요약: BMI={_bmi_bucket(_safe_float(u.get('bmi')))}, "
        f"Situp={_situp_grade(_safe_int(m.get('situp_reps')))}, "
        f"Flex={_reach_grade(_safe_float(m.get('reach_cm')))}, "
        f"Cardio={_vo2_bucket(_safe_float(m.get('step_vo2max')))}\n"
    )

    # CSV 근거
    csv_blocks = []
    for n in (csv_neighbors or []):
        csv_blocks.append(
            f"[CSV:{n.get('row_id')}] (유사도 {n.get('score'):.2f}) "
            f"성별 {n.get('sex')} · 나이 {n.get('age')} · BMI {n.get('bmi')} · "
            f"싯업 {n.get('situp_reps')} · 좌전굴 {n.get('reach_cm')}cm · VO₂max {n.get('vo2max')}\n"
            f"처방 요약: {n.get('prescription_text','')}"
        )
    csv_text = "\n\n".join(csv_blocks) if csv_blocks else "(유사 사례 없음)"

    # ACSM6 근거
    guide_blocks = []
    for g in (acsm_guides or []):
        guide_blocks.append(
            f"[ACSM6:{g.get('doc_id')}] {g.get('title') or g.get('path') or ''}\n{g.get('text','')}"
        )
    guide_text = "\n\n-----\n\n".join(guide_blocks) if guide_blocks else "(가이드라인 없음)"

    system = (
        "당신은 임상 운동전문가이자 운동처방 코치입니다. "
        "당신의 목표는 사용자의 체력 수준, 건강 상태, 목표에 따라 과학적이고 안전한 4~6주 FITT 원칙 기반 운동처방을 작성하는 것입니다. "
        "다음 지침을 반드시 따르세요:\n"
        "1️⃣ 유사 사례(CSV 근거)를 바탕으로 맞춤형 처방을 작성하고, 각 권고 뒤에 [CSV:row_id]를 명시하세요.\n"
        "2️⃣ 설문 조사 및 사용자 개인정보·측정 결과를 기반으로 ACSM 제6판(ACSM6) 전문가 가이드라인을 근거로 논리적 이유, 안전 고려사항, 대안을 제시하고 [ACSM6:doc_id]를 인용하세요.\n"
        "3️⃣ 한국어로 작성하고, 수치(빈도/강도/시간/유형)를 명확히 제시하세요.\n"
        "4️⃣ FITT 구성요소(Frequency, Intensity, Time, Type)를 모두 포함하세요.\n"
        "5️⃣ 구체적인 운동 명칭과 세트·반복·속도·휴식 정보를 포함하세요.\n"
    )

    user_prompt = (
        "=== 사용자 요약 ===\n" + user_summary +
        "\n=== 유사 사례 근거 Top-K ===\n" + csv_text +
        "\n\n=== 전문가 가이드라인 근거 Top-K ===\n" + guide_text +
        "\n\n=== 원본 입력(JSON) ===\n" + _json.dumps(payload, ensure_ascii=False, indent=2) +
        "\n\n[출력 형식]\n"
        "## 맞춤 운동처방 (4~6주)\n"
        "### 1. 유산소 운동\n"
        "- 빈도(F): 주 X회\n"
        "- 강도(I): 심박수 XX~YY bpm 또는 RPE XX 수준\n"
        "- 시간(T): 회당 XX분\n"
        "- 유형(T): 예) 빠른 걷기, 실내 자전거, 수영 등 [CSV:x]\n\n"
        "### 2. 근력 운동\n"
        "- 주요 부위: 상체/하체/코어 등\n"
        "- 빈도(F): 주 X회\n"
        "- 강도(I): 1RM의 XX% 또는 10~15회 반복 가능 중량\n"
        "- 세트/반복: X세트 × X회\n"
        "- 휴식: 세트 간 XX초 [CSV:y]\n\n"
        "### 3. 유연성 운동\n"
        "- 부위: 햄스트링, 어깨, 척추 등\n"
        "- 빈도(F): 주 X회\n"
        "- 강도(I): 통증 없는 범위\n"
        "- 시간(T): 부위당 XX초 × X세트 [CSV:z]\n\n"
        "## 근거 및 안전(ACSM6)\n"
        "- 강도 설정 근거: ... [ACSM6:a]\n"
        "- 안전/금기 고려: ... [ACSM6:b]\n"
        "- 대안 제시: ... [ACSM6:c]\n\n"
        "## 유사 사례 인사이트\n"
        "- [CSV:id1] ~ [CSV:id3]의 사례를 참고하여 설계 이유 서술\n"
        "- 사용자와의 유사점(연령, 체력 수준, 목표) 간략 비교\n"
    )

    return {"system": system, "user": user_prompt}

# ───────── 공개 엔진 API ─────────
def generate_prescription_with_query(payload: Dict[str, Any]) -> Dict[str, Any]:
    # 1) CSV 유사 사례
    u = payload.get("user", {}) or {}
    m = payload.get("measurements", {}) or {}
    csv_neighbors = retrieve_similar_structured(u, m, top_k=6)

    # 2) ACSM6 가이드라인
    acsm_guides = retrieve_guidelines_acsm6(payload, top_k=6)

    # 3) 프롬프트
    prompts = build_dual_prompt(payload, csv_neighbors, acsm_guides)

    # 4) LLM 호출
    answer = call_openai(prompts["system"], prompts["user"])

    # 5) 결과
    return {
        "planText": {
            "planText": answer,
            "debug": {
                "query": "csv-kNN + acsm6-text",
                "retrieved_csv": [
                    {"score": n.get("score"), "meta": {"row_id": n.get("row_id")}}
                    for n in csv_neighbors
                ],
                "retrieved_acsm6": [
                    {"score": g.get("score"), "meta": {"doc_id": g.get("doc_id")}}
                    for g in acsm_guides
                ],
                "rag_status": rag_status(),
            },
        },
        "case_refs": csv_neighbors,
        "guideline_refs": acsm_guides,
    }

# 명시적 export
__all__ = ["generate_prescription_with_query", "rag_status"]