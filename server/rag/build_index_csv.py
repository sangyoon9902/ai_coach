# server/rag/build_index_csv.py
from __future__ import annotations
import csv, json, re
from pathlib import Path
from typing import Dict, List
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# 실제 CSV 헤더 그대로 (공백, 콜론 포함)
FIELDS = [
    "회원일련번호값",
    "측정연령수",
    "연령대구분명",
    "인증구분명",
    "성별구분코드",
    "측정항목_1값 : 신장(cm)",
    "측정항목_2값 : 체중(kg)",
    "측정항목_4값 : 허리둘레(cm)",
    "측정항목_9값 : 윗몸말아올리기(회)",
    "측정항목_12값 : 앉아윗몸앞으로굽히기(cm)",
    "측정항목_18값 : BMI(kg/㎡)",
    "운동처방내용",
    "VO₂max",
]

def _normalize(s: str) -> str:
    return s.strip().replace("\ufeff", "")

def load_csv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            row = {k: _normalize(raw.get(k, "")) for k in FIELDS}
            rows.append(row)
        return rows

def row_to_passage(r: Dict[str, str]) -> str:
    return (
        f"사례ID={r['회원일련번호값']}\n"
        f"연령={r['측정연령수']}세, 연령대={r['연령대구분명']}, 인증={r['인증구분명']}, 성별={r['성별구분코드']}\n"
        f"신장(cm)={r['측정항목_1값 : 신장(cm)']}, 체중(kg)={r['측정항목_2값 : 체중(kg)']}, 허리둘레(cm)={r['측정항목_4값 : 허리둘레(cm)']}\n"
        f"윗몸말아올리기(회)={r['측정항목_9값 : 윗몸말아올리기(회)']}, "
        f"앉아윗몸앞으로굽히기(cm)={r['측정항목_12값 : 앉아윗몸앞으로굽히기(cm)']}, "
        f"BMI(kg/㎡)={r['측정항목_18값 : BMI(kg/㎡)']}\n"
        f"VO2max={r['VO₂max']}\n"
        f"운동처방내용={r['운동처방내용']}"
    ).strip()

def build(csv_path: str, out_dir: str):
    csv_path = Path(csv_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    index_path = out_dir / "faiss.index"
    meta_path = out_dir / "meta.json"

    rows = load_csv_rows(csv_path)
    passages = [row_to_passage(r) for r in rows]
    metas = [{"id": r["회원일련번호값"], "title": f"처방사례 {i+1}", "passage": passages[i]} for i, r in enumerate(rows)]

    emb = SentenceTransformer(MODEL_NAME)
    dim = emb.get_sentence_embedding_dimension()
    vecs = emb.encode(passages, normalize_embeddings=True, show_progress_bar=True)
    vecs = np.asarray(vecs, dtype="float32")

    idx = faiss.IndexFlatIP(dim)
    idx.add(vecs)
    faiss.write_index(idx, str(index_path))

    meta = {
        "model": MODEL_NAME,
        "dim": dim,
        "count": len(passages),
        "source": str(csv_path),
        "docs": metas,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ built {index_path} & {meta_path} (n={len(passages)})")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    build(args.csv, args.out)
