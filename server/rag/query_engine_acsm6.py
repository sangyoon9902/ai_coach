from __future__ import annotations
import os, json
from pathlib import Path
from typing import List, Dict, Any
import numpy as np
import faiss
from dotenv import load_dotenv
from openai import OpenAI

BASE = Path(__file__).resolve().parent
STORE = BASE / "embed_store" / "acsm6"

IDX_PATH = STORE / "faiss_acsm6.index"
META_PATH = STORE / "acsm6_meta.json"
PIPE_PATH = STORE / "acsm6_pipeline.json"  # 빌드 때 저장한 설정(모델명 등)

_index = None
_meta = None
_pipe = None
_client = None
_ready = False


# ───────────────────────────────
# 안전한 메타 로더 (chunks/docs/items 자동 감지)
# ───────────────────────────────
def _load_meta(meta_path: Path) -> List[Dict[str, Any]]:
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[RAG][ACSM6] meta load failed: {e}")
        return []

    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        for key in ("docs", "chunks", "items", "nodes"):
            if key in raw and isinstance(raw[key], list):
                items = raw[key]
                break
        else:
            print(f"[RAG][ACSM6] meta keys={list(raw.keys())}, no known list found")
            items = []
    else:
        items = []

    # 기본 필드 정규화
    norm = []
    for it in items:
        if not isinstance(it, dict):
            continue
        norm.append({
            "text": it.get("text") or "",
            "title": it.get("title") or "",
            "path": it.get("path") or raw.get("source_file") or "",
            **it
        })
    return norm


# ───────────────────────────────
# 초기화
# ───────────────────────────────
def _init():
    global _index, _meta, _pipe, _client, _ready
    try:
        if _index is None:
            _index = faiss.read_index(str(IDX_PATH))
        if _meta is None:
            _meta = _load_meta(META_PATH)
        if _pipe is None and PIPE_PATH.exists():
            _pipe = json.loads(PIPE_PATH.read_text(encoding="utf-8"))
        if _client is None:
            load_dotenv()
            key = (os.getenv("OPENAI_API_KEY") or "").strip()
            _client = OpenAI(api_key=key)
        _ready = True
        print(f"[RAG][ACSM6] ✅ Ready (meta {len(_meta)} chunks)")
    except Exception as e:
        print(f"[RAG][ACSM6] ⚠️ init skipped: {e}")
        _ready = False


# ───────────────────────────────
# 쿼리 임베딩
# ───────────────────────────────
def _embed_query(text: str) -> np.ndarray:
    model_name = (_pipe or {}).get("embedding_model", "text-embedding-3-small")
    vec = _client.embeddings.create(model=model_name, input=text).data[0].embedding
    X = np.array([vec], dtype="float32")
    faiss.normalize_L2(X)
    return X


# ───────────────────────────────
# 사용자 입력으로 검색 질의 생성
# ───────────────────────────────
def _build_query_from_payload(payload: Dict[str, Any]) -> str:
    u = payload.get("user", {}) or {}
    m = payload.get("measurements", {}) or {}
    return (
        f"sex:{u.get('sex')} age:{u.get('age')} bmi:{u.get('bmi')} "
        f"situp:{m.get('situp_reps')} reach:{m.get('reach_cm')} vo2max:{m.get('step_vo2max')} "
        f"exercise prescription intensity frequency duration precautions"
    )


# ───────────────────────────────
# 검색 함수 (메인)
# ───────────────────────────────
def retrieve_guidelines_acsm6(payload: Dict[str, Any], top_k: int = 6) -> List[Dict[str, Any]]:
    _init()
    if not _ready or _index is None or not _meta:
        print("[RAG][ACSM6] ⚠️ index/meta not ready → fallback []")
        return []

    q = _build_query_from_payload(payload)
    X = _embed_query(q)
    scores, idxs = _index.search(X, top_k)

    out = []
    for sc, ix in zip(scores[0].tolist(), idxs[0].tolist()):
        if ix < 0 or ix >= len(_meta):
            continue
        m = _meta[ix]
        out.append({
            "doc_id": int(ix),
            "score": float(sc),
            "title": m.get("title") or m.get("path"),
            "path": m.get("path"),
            "text": m.get("text", "")[:1200],  # 너무 길면 1200자까지만
            "source": "acsm6",
        })
    return out
