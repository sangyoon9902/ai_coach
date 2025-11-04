# /Users/sangyuni/ai-fitness/server/rag/build_acsm_index.py

import os, re, json, argparse
from pathlib import Path
import numpy as np
import faiss
from dotenv import load_dotenv
load_dotenv(dotenv_path="/Users/sangyuni/ai-fitness/server/.env")


# ───────────────── 경로 설정 (현재 파일 위치 기준) ─────────────────
HERE = Path(__file__).resolve().parent                      # .../server/rag
SERVER_ROOT = HERE.parent                                   # .../server
JSON_SRC = SERVER_ROOT / "fitness_reports" / "Acsms Guidelines for Exercise Testing and Prescription -- Gary J Balady; American College of Sports Medicine -- ( WeLib.org ).json"
OUT_DIR  = HERE / "embed_store" / "acsm6"                   # .../server/rag/embed_store/acsm6
OUT_DIR.mkdir(parents=True, exist_ok=True)

INDEX_PATH = OUT_DIR / "faiss_acsm6.index"
META_PATH  = OUT_DIR / "acsm6_meta.json"
PIPE_PATH  = OUT_DIR / "acsm6_pipeline.json"

# ───────────────── 임베딩 설정 ─────────────────
EMBED_MODEL = "text-embedding-3-small"   # OpenAI 임베딩 (다국어 OK)
BATCH = 64
CHUNK_TOKENS = 700
OVERLAP_TOKENS = 150

# ───────────────── OpenAI ─────────────────
from openai import OpenAI
def _get_client():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    return OpenAI(api_key=key)

def approx_token_len(s: str) -> int:
    # 대략적인 토큰 길이 추정(영문 기준, 한글도 대충 동작)
    return max(1, int(len(s.split()) * 1.3))

def collect_markdowns(js: dict):
    paras = []
    for page in js.get("pages", []):
        for it in page.get("items", []):
            md = it.get("md") or it.get("value")
            if not md:
                continue
            md = re.sub(r"\n{3,}", "\n\n", md).strip()
            if md:
                paras.append(md)
    return paras

def chunk_paragraphs(paras, max_tokens=CHUNK_TOKENS, overlap=OVERLAP_TOKENS):
    chunks, buf, size = [], [], 0
    for p in paras:
        L = approx_token_len(p)
        if size + L <= max_tokens:
            buf.append(p); size += L
        else:
            if buf:
                chunks.append("\n\n".join(buf))
            # overlap 유지
            keep, cur = [], 0
            for q in reversed(buf):
                qL = approx_token_len(q)
                if cur + qL <= overlap:
                    keep.append(q); cur += qL
                else:
                    break
            keep.reverse()
            buf = keep + [p]
            size = sum(approx_token_len(x) for x in buf)
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks

def embed_texts(texts, model=EMBED_MODEL, batch=BATCH):
    client = _get_client()
    vecs = []
    for i in range(0, len(texts), batch):
        batch_texts = texts[i:i+batch]
        res = client.embeddings.create(model=model, input=batch_texts)
        vecs.extend([d.embedding for d in res.data])
    return np.array(vecs, dtype="float32")

def rebuild_index():
    assert JSON_SRC.exists(), f"문서가 없습니다: {JSON_SRC}"
    data = json.loads(JSON_SRC.read_text(encoding="utf-8"))

    paras = collect_markdowns(data)
    chunks = chunk_paragraphs(paras)

    meta = {
        "corpus": "acsm6",
        "source_file": JSON_SRC.name,
        "model": EMBED_MODEL,
        "chunk_tokens": CHUNK_TOKENS,
        "overlap_tokens": OVERLAP_TOKENS,
        "chunks": [{"id": i, "text": t} for i, t in enumerate(chunks)]
    }

    X = embed_texts([c["text"] for c in meta["chunks"]], model=EMBED_MODEL)
    dim = int(X.shape[1])

    index = faiss.IndexFlatL2(dim)
    index.add(X)

    faiss.write_index(index, str(INDEX_PATH))
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    PIPE_PATH.write_text(json.dumps({"built_from": JSON_SRC.name, "model": EMBED_MODEL}, ensure_ascii=False, indent=2),
                         encoding="utf-8")

    print(f"[OK] index: {INDEX_PATH}")
    print(f"[OK] meta : {META_PATH}")
    print(f"dim={dim}, ntotal={index.ntotal}")

def embed_query(q: str, model=EMBED_MODEL) -> np.ndarray:
    client = _get_client()
    e = client.embeddings.create(model=model, input=[q]).data[0].embedding
    return np.array([e], dtype="float32")

def search(query: str, k=5):
    assert INDEX_PATH.exists() and META_PATH.exists(), "인덱스가 없습니다. 먼저 --rebuild 실행"
    index = faiss.read_index(str(INDEX_PATH))
    meta  = json.loads(META_PATH.read_text(encoding="utf-8"))
    v = embed_query(query, model=meta["model"])
    D, I = index.search(v, k)
    hits = []
    for rank, (idx, dist) in enumerate(zip(I[0], D[0]), start=1):
        ch = meta["chunks"][int(idx)]
        hits.append({"rank": rank, "score": float(dist), "id": ch["id"], "text": ch["text"]})
    return hits

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="ACSM JSON으로부터 인덱스 재생성")
    ap.add_argument("--search", type=str, help="간단 검색 테스트 쿼리")
    ap.add_argument("-k", type=int, default=5, help="검색 top-k")
    args = ap.parse_args()

    if args.rebuild:
        rebuild_index()

    if args.search:
        for h in search(args.search, k=args.k):
            preview = h["text"][:160].replace("\n", " ")
            print(f"[{h['rank']}] score={h['score']:.4f}  id={h['id']}  {preview}")
