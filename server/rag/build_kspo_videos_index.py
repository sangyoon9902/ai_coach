# -*- coding: utf-8 -*-
from __future__ import annotations
import os, json, csv, glob
from pathlib import Path
from typing import Dict, List
import numpy as np
import faiss

from dotenv import load_dotenv
from openai import OpenAI

BASE = Path(__file__).resolve().parent
OUT_DIR = BASE / "embed_store" / "kspo_videos"
IDX_PATH = OUT_DIR / "faiss_kspo.index"
META_PATH = OUT_DIR / "kspo_meta.json"
PIPE_PATH = OUT_DIR / "kspo_pipeline.json"

EMBED_MODEL = "text-embedding-3-small"  # ACSM6와 동일 계열

def _load_csvs(path: Path) -> List[Dict]:
    files = []
    if path.is_dir():
        files = sorted(Path(path).glob("*.csv"))
    else:
        files = [path]
    rows = []
    for f in files:
        with f.open("r", encoding="utf-8-sig", newline="") as fp:
            for row in csv.DictReader(fp):
                rows.append(row)
    return rows

def _row_to_text(row: Dict) -> str:
    # 검색 친화 자연어 문장
    return "\n".join([
        f"제목: {row.get('title','')}",
        f"운동 분류: {row.get('fitness_category','')}",
        f"도구: {row.get('tool','')}",
        f"주 대상 부위: {row.get('body_part','')}",
        f"대상: {row.get('target','')}",
        f"질환/유의: {row.get('disease','')}",
        f"YouTube: {row.get('youtube_url','')}",
        f"썸네일: {row.get('thumb_url','')}",
        f"페이지/순번: p{row.get('page_no','')} #{row.get('rank_on_page','')}",
    ]).strip()

def _normalize(X: np.ndarray) -> np.ndarray:
    faiss.normalize_L2(X)
    return X

def _embed_texts(client: OpenAI, texts: List[str]) -> np.ndarray:
    # OpenAI는 대량 배치로 보내는 것보다 1회 input에 리스트 전달이 좋음
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = np.array([d.embedding for d in resp.data], dtype="float32")
    return _normalize(vecs)

def main(csv_path: str):
    load_dotenv()
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY 누락")
    client = OpenAI(api_key=key)

    src = Path(csv_path)
    rows = _load_csvs(src)

    # 기존 메타 로드
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing = []
    if META_PATH.exists():
        try:
            existing = json.loads(META_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    exist_ids = {m.get("youtube_id") for m in existing}

    # 신규만 선별
    new_items = []
    for r in rows:
        yt = (r.get("youtube_id") or "").strip()
        if not yt or yt in exist_ids:
            continue
        new_items.append({
            "id": f"VIDEO:{yt}",
            "youtube_id": yt,
            "title": r.get("title",""),
            "fitness_category": r.get("fitness_category",""),
            "tool": r.get("tool",""),
            "body_part": r.get("body_part",""),
            "target": r.get("target",""),
            "disease": r.get("disease",""),
            "youtube_url": r.get("youtube_url",""),
            "thumb_url": r.get("thumb_url",""),
            "page_no": r.get("page_no",""),
            "rank_on_page": r.get("rank_on_page",""),
            "text": _row_to_text(r),
            "source": "kspo_videos",
        })

    if not new_items:
        print("✅ 추가할 신규 항목 없음")
        return

    texts = [it["text"] for it in new_items]
    vecs = _embed_texts(client, texts)

    # 인덱스 로드/생성 (Inner Product)
    if IDX_PATH.exists():
        index = faiss.read_index(str(IDX_PATH))
        if index.d != vecs.shape[1]:
            raise RuntimeError(f"차원 불일치: {index.d} vs {vecs.shape[1]}")
    else:
        index = faiss.IndexFlatIP(vecs.shape[1])

    index.add(vecs)
    faiss.write_index(index, str(IDX_PATH))

    # 메타 Append
    META_PATH.write_text(json.dumps(existing + new_items, ensure_ascii=False, indent=2), encoding="utf-8")

    # 파이프라인 정보 기록
    PIPE_PATH.write_text(json.dumps({
        "embedding_model": EMBED_MODEL,
        "source": "kspo_videos",
        "schema": ["title","fitness_category","tool","body_part","target","disease","youtube_id","youtube_url","thumb_url","page_no","rank_on_page","text"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ KSPO 인덱스 업데이트: +{len(new_items)}개")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="CSV 파일 또는 CSV 폴더 경로")
    args = ap.parse_args()
    main(args.csv)
