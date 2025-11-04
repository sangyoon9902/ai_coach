# server/rag/query_engine_csv.py
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
import faiss
import joblib

BASE = Path(__file__).resolve().parent
STORE = BASE / "embed_store" / "csv"

IDX_PATH = STORE / "faiss_structured.index"
META_PATH = STORE / "structured_meta.json"
PIPE_PATH = STORE / "structured_pipeline.joblib"

_index = None
_meta = None
_pipe = None

def _init():
    global _index, _meta, _pipe
    if _index is None:
        _index = faiss.read_index(str(IDX_PATH))
    if _meta is None:
        _meta = json.loads(META_PATH.read_text(encoding="utf-8"))["docs"]
    if _pipe is None:
        _pipe = joblib.load(PIPE_PATH)

def _row_from_input(user: dict, meas: dict) -> dict:
    # 프론트에서 오는 payload를 CSV 스키마 의미로 정렬
    return {
        "측정연령수": user.get("age"),
        "측정항목_1값 : 신장(cm)": user.get("height_cm"),
        "측정항목_2값 : 체중(kg)": user.get("weight_kg"),
        "측정항목_4값 : 허리둘레(cm)": None,  # 있으면 넣기
        "측정항목_18값 : BMI(kg/㎡)": user.get("bmi"),
        "측정항목_9값 : 윗몸말아올리기(회)": meas.get("situp_reps"),
        "측정항목_12값 : 앉아윗몸앞으로굽히기(cm)": meas.get("reach_cm"),
        "VO₂max": meas.get("step_vo2max"),
        "성별구분코드": user.get("sex"),
        "연령대구분명": None,
        "인증구분명": None,
    }

def retrieve_similar_structured(user: dict, measurements: dict, top_k=6):
    _init()
    row = _row_from_input(user, measurements)
    df = pd.DataFrame([row])
    X = _pipe.transform(df).astype("float32")
    faiss.normalize_L2(X)
    scores, idxs = _index.search(X, top_k)
    out = []
    for sc, ix in zip(scores[0].tolist(), idxs[0].tolist()):
        if ix < 0:
            continue
        m = _meta[ix]
        out.append({
            "row_id": int(m.get("row_id", ix)),
            "score": float(sc),
            "sex": m.get("sex"),
            "age": m.get("age"),
            "bmi": m.get("bmi"),
            "situp_reps": m.get("situp_reps"),
            "reach_cm": m.get("reach_cm"),
            "vo2max": m.get("vo2max"),
            "prescription_text": m.get("prescription_text", ""),
            "source": m.get("source", "csv"),
        })
    return out
