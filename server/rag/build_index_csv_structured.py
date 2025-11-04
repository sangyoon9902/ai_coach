# server/rag/build_index_csv_structured.py
from __future__ import annotations
import json
from pathlib import Path
from typing import Dict, List
import numpy as np
import pandas as pd
import faiss
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer
import joblib

BASE = Path(__file__).resolve().parent

# CSV의 실제 컬럼명 (질문에서 준 그대로)
COL = {
    "ID": "회원일련번호값",
    "AGE": "측정연령수",
    "AGE_BUCKET": "연령대구분명",
    "CERT": "인증구분명",
    "SEX": "성별구분코드",
    "HEIGHT": "측정항목_1값 : 신장(cm)",
    "WEIGHT": "측정항목_2값 : 체중(kg)",
    "WAIST": "측정항목_4값 : 허리둘레(cm)",
    "SITUP": "측정항목_9값 : 윗몸말아올리기(회)",
    "REACH": "측정항목_12값 : 앉아윗몸앞으로굽히기(cm)",
    "BMI": "측정항목_18값 : BMI(kg/㎡)",
    "PRESC": "운동처방내용",
    "VO2": "VO₂max",  # 실제 헤더가 VO2max면 여기만 "VO2max"로 바꿔주세요
}

def safe_num(x):
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)): return None
        s = str(x).strip()
        if s == "": return None
        return float(s)
    except Exception:
        return None

def safe_str(x):
    return "" if x is None else str(x)

def build(csv_path: str, out_dir: str):
    csv_path = Path(csv_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # CSV 로드 (BOM 고려)
    df = pd.read_csv(csv_path, encoding="utf-8-sig")

    # 필요한 컬럼 보정
    for k in COL.values():
        if k not in df.columns:
            df[k] = np.nan

    # 숫자/카테고리 정의
    numeric_cols = [
        COL["AGE"], COL["HEIGHT"], COL["WEIGHT"], COL["WAIST"],
        COL["BMI"], COL["SITUP"], COL["REACH"], COL["VO2"],
    ]
    cat_cols = [COL["SEX"], COL["AGE_BUCKET"], COL["CERT"]]

    # 파이프라인: 숫자 표준화 + 범주형 원-핫
    num_proc = Pipeline([("impute", SimpleImputer(strategy="median")),
                         ("scale", StandardScaler())])
    cat_proc = Pipeline([("impute", SimpleImputer(strategy="most_frequent")),
                         ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False))])

    ct = ColumnTransformer(
        [("num", num_proc, numeric_cols),
         ("cat", cat_proc, cat_cols)],
        remainder="drop",
        verbose_feature_names_out=False,
    )

    pipe = Pipeline([("ct", ct)])
    X = pipe.fit_transform(df[numeric_cols + cat_cols]).astype("float32")

    # 코사인 유사도용 L2 정규화 + 내적 인덱스
    faiss.normalize_L2(X)
    index = faiss.IndexFlatIP(X.shape[1])
    index.add(X)

    # 메타 저장 (처방 텍스트 포함)
    meta_docs = []
    for i, row in df.reset_index(drop=True).iterrows():
        meta_docs.append({
            "row_id": int(i),
            "id": safe_str(row.get(COL["ID"])),
            "sex": safe_str(row.get(COL["SEX"])),
            "age": safe_num(row.get(COL["AGE"])),
            "bmi": safe_num(row.get(COL["BMI"])),
            "height_cm": safe_num(row.get(COL["HEIGHT"])),
            "weight_kg": safe_num(row.get(COL["WEIGHT"])),
            "waist_cm": safe_num(row.get(COL["WAIST"])),
            "situp_reps": safe_num(row.get(COL["SITUP"])),
            "reach_cm": safe_num(row.get(COL["REACH"])),
            "vo2max": safe_num(row.get(COL["VO2"])),
            "prescription_text": safe_str(row.get(COL["PRESC"])),
            "source": csv_path.name,
        })

    # 저장
    faiss.write_index(index, str(out_dir / "faiss_structured.index"))
    joblib.dump(pipe, out_dir / "structured_pipeline.joblib")
    (out_dir / "structured_meta.json").write_text(
        json.dumps({"count": len(meta_docs), "docs": meta_docs}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"✅ structured index: {out_dir / 'faiss_structured.index'}")
    print(f"✅ pipeline:        {out_dir / 'structured_pipeline.joblib'}")
    print(f"✅ meta:            {out_dir / 'structured_meta.json'} (n={len(meta_docs)})")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    build(args.csv, args.out)
