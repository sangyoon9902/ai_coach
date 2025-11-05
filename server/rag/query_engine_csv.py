from __future__ import annotations
from typing import List, Dict, Any, Optional
import json, math
from pathlib import Path
import numpy as np
import pandas as pd
import faiss, joblib

BASE = Path(__file__).resolve().parent
STORE = BASE / "embed_store" / "csv"

IDX_PATH = STORE / "faiss_structured.index"
META_PATH = STORE / "structured_meta.json"
PIPE_PATH = STORE / "structured_pipeline.joblib"

_index: Optional[faiss.Index] = None
_meta: Optional[List[Dict[str, Any]]] = None
_pipe = None


# ---------- utils ----------
def _to_int(x, default=None):
    try:
        if x is None: return default
        s = str(x).strip()
        if s in ("", "nan", "None"): return default
        return int(float(s))
    except Exception:
        return default

def _to_float(x, default=None):
    try:
        if x is None: return default
        s = str(x).strip()
        if s in ("", "nan", "None"): return default
        return float(s)
    except Exception:
        return default


# ---------- loader ----------
def _init():
    global _index, _meta, _pipe

    if _index is None:
        if not IDX_PATH.exists():
            raise FileNotFoundError(f"[CSV] FAISS index not found: {IDX_PATH}")
        _index = faiss.read_index(str(IDX_PATH))

    if _meta is None:
        if not META_PATH.exists():
            raise FileNotFoundError(f"[CSV] Meta json not found: {META_PATH}")
        meta_json = json.loads(META_PATH.read_text(encoding="utf-8"))
        docs = meta_json.get("docs", [])
        if not isinstance(docs, list):
            raise ValueError("[CSV] structured_meta.json: 'docs' must be a list")
        _meta = docs

    if _pipe is None:
        if not PIPE_PATH.exists():
            raise FileNotFoundError(f"[CSV] Pipeline joblib not found: {PIPE_PATH}")
        _pipe = joblib.load(PIPE_PATH)


# ---------- input normalize ----------
def _normalized_payload(user: dict, meas: dict) -> Dict[str, Any]:
    sex = (user or {}).get("sex")
    age = (user or {}).get("age")
    height_cm = (user or {}).get("height_cm")
    weight_kg = (user or {}).get("weight_kg")
    bmi = (user or {}).get("bmi")
    waist_cm = (user or {}).get("waist_cm")

    meas = (meas or {}).copy()
    meas.pop("step_recovery_bpm", None)
    if "vo2max" not in meas and "step_vo2max" in meas:
        meas["vo2max"] = meas.pop("step_vo2max")

    return {
        "sex": sex,
        "age": age,
        "height_cm": height_cm,
        "weight_kg": weight_kg,
        "waist_cm": waist_cm,
        "bmi": bmi,
        "situp_reps": meas.get("situp_reps"),
        "reach_cm": meas.get("reach_cm"),
        "vo2max": meas.get("vo2max"),
    }

def _row_from_input(user: dict, meas: dict) -> dict:
    z = _normalized_payload(user, meas)
    return {
        "측정연령수": _to_int(z.get("age")),
        "측정항목_1값 : 신장(cm)": _to_float(z.get("height_cm")),
        "측정항목_2값 : 체중(kg)": _to_float(z.get("weight_kg")),
        "측정항목_4값 : 허리둘레(cm)": _to_float(z.get("waist_cm")),
        "측정항목_18값 : BMI(kg/㎡)": _to_float(z.get("bmi")),
        "측정항목_9값 : 윗몸말아올리기(회)": _to_int(z.get("situp_reps")),
        "측정항목_12값 : 앉아윗몸앞으로굽히기(cm)": _to_float(z.get("reach_cm")),
        "VO₂max": _to_float(z.get("vo2max")),
        "성별구분코드": (z.get("sex") or "").strip().upper()[:1] or None,
        "연령대구분명": None,
        "인증구분명": None,
    }


# ---------- similarity helpers ----------
def _age_similarity(query_age: Optional[float], cand_age: Optional[float], half_life_years: float = 7.0) -> float:
    """|Δ| = half_life_years일 때 0.5가 되도록 설계된 지수형 유사도"""
    if query_age is None or cand_age is None:
        return 0.7
    try:
        diff = abs(float(query_age) - float(cand_age))
    except Exception:
        return 0.7
    return math.exp(- math.log(2.0) * (diff / max(half_life_years, 1e-6)))


def _sex_similarity(query_sex: Optional[str], cand_sex: Optional[str]) -> float:
    """성별 일치=1.0, 불일치=0.5, 비어있음=0.7"""
    if not query_sex or not cand_sex:
        return 0.7
    qs = str(query_sex).strip().upper()[:1]
    cs = str(cand_sex).strip().upper()[:1]
    return 1.0 if qs == cs else 0.5


# ---------- main ----------
def retrieve_similar_structured(
    user: dict,
    measurements: dict,
    top_k: int = 6,
    *,
    overfetch: int = 200,
    age_half_life: float = 7.0,
    weight_age: float = 2.0,     # ✅ 나이 가중치
    weight_sex: float = 1.5,     # ✅ 성별 가중치
    debug: bool = False,
) -> List[Dict[str, Any]]:
    """
    - 성별, 나이를 유사도로 계산 (필터 아님)
    - 나이/성별 유사도에 가중치 반영하여 재랭킹
    """
    _init()

    row = _row_from_input(user or {}, measurements or {})
    df = pd.DataFrame([row])

    X = _pipe.transform(df)
    if not isinstance(X, np.ndarray):
        try: X = X.toarray()
        except Exception:
            raise TypeError("[CSV] Pipeline transform did not return ndarray/sparse matrix")

    X = np.asarray(X, dtype="float32")
    if X.ndim == 1: X = X.reshape(1, -1)

    faiss.normalize_L2(X)

    ntotal = _index.ntotal
    if ntotal <= 0:
        return []
    fetch_k = min(ntotal, max(int(overfetch), top_k))

    scores, idxs = _index.search(X, fetch_k)
    query_age = (user or {}).get("age")
    query_sex = (user or {}).get("sex")

    cands: List[Dict[str, Any]] = []
    for sc, ix in zip(scores[0].tolist(), idxs[0].tolist()):
        if ix < 0 or ix >= len(_meta): 
            continue
        m = _meta[ix] or {}

        cand_age = m.get("age")
        cand_sex = m.get("sex")

        age_sim = _age_similarity(query_age, cand_age, half_life_years=age_half_life)
        sex_sim = _sex_similarity(query_sex, cand_sex)

        combined = float(sc) * (1.0 + weight_age * (age_sim - 0.5) + weight_sex * (sex_sim - 0.5))

        cands.append({
            "row_id": int(m.get("row_id", ix)),
            "raw_score": float(sc),
            "combined_score": combined,
            "age_sim": age_sim,
            "sex_sim": sex_sim,
            "sex": cand_sex,
            "age": cand_age,
            "height_cm": m.get("height_cm"),
            "weight_kg": m.get("weight_kg"),
            "bmi": m.get("bmi"),
            "situp_reps": m.get("situp_reps"),
            "reach_cm": m.get("reach_cm"),
            "vo2max": m.get("vo2max"),
            "prescription_text": (m.get("prescription_text") or "").strip(),
            "source": m.get("source", "csv"),
        })

    if not cands:
        return []

    cands.sort(key=lambda d: d["combined_score"], reverse=True)
    out = cands[:top_k]

    if debug:
        for i, r in enumerate(out, start=1):
            print(f"{i}. row_id={r['row_id']} score={r['combined_score']:.4f} raw={r['raw_score']:.4f} "
                  f"(age_sim={r['age_sim']:.2f}, sex_sim={r['sex_sim']:.2f})  sex={r['sex']} age={r['age']}")
    return out


# ---------- debug main ----------
if __name__ == "__main__":
    user = {"sex": "m", "age": 20, "height_cm": 170, "weight_kg": 65, "bmi": 22.5}
    measurements = {"situp_reps": 10, "reach_cm": 10, "step_vo2max": 40}

    print("=== Top 5 유사 사례 ===")
    res = retrieve_similar_structured(user, measurements, top_k=5, overfetch=300, age_half_life=6.0, debug=True)
    if not res:
        print("(결과 없음)")
    else:
        for i, r in enumerate(res,  start=1):
            print(f"{i}. [row_id={r['row_id']}] combined={r['combined_score']:.4f} raw={r['raw_score']:.4f}")
            print(f"   윗몸일으키기:{r['situp_reps']}  성별:{r['sex']}  나이:{r['age']}  (age_sim={r['age_sim']:.2f}, sex_sim={r['sex_sim']:.2f})")
            print(f"   처방: { (r['prescription_text'] or '')[:90] }...")
