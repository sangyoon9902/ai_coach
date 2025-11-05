# /Users/sangyuni/ai-fitness/server/rag/build_acsm_index.py
from __future__ import annotations

import os, re, json, argparse
from pathlib import Path
from typing import List, Dict, Any
import numpy as np
import faiss
from dotenv import load_dotenv
from json import JSONDecodeError, JSONDecoder

# ───────────────── ENV ─────────────────
load_dotenv(dotenv_path="/Users/sangyuni/ai-fitness/server/.env")

# ───────────────── 경로 ─────────────────
HERE = Path(__file__).resolve().parent                      # .../server/rag
SERVER_ROOT = HERE.parent                                   # .../server
JSON_SRC = SERVER_ROOT / "fitness_reports" / "Acsms Guidelines for Exercise Testing and Prescription -- Gary J Balady; American College of Sports Medicine -- ( WeLib.org ).json"
OUT_DIR  = HERE / "embed_store" / "acsm6"                   # .../server/rag/embed_store/acsm6
OUT_DIR.mkdir(parents=True, exist_ok=True)

INDEX_PATH = OUT_DIR / "faiss_acsm6.index"
META_PATH  = OUT_DIR / "acsm6_meta.json"        # chunks + 메타(발췌/페이지/섹션)
PIPE_PATH  = OUT_DIR / "acsm6_pipeline.json"    # 빌드정보(모델명 등)

# ───────────────── 임베딩 설정 ─────────────────
EMBED_MODEL = "text-embedding-3-large"   # 정확도 우선
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

# ───────────────── 공통 유틸 ─────────────────
def approx_token_len(s: str) -> int:
    # 대략적인 토큰 길이 추정(영문 기준). 한글도 대충 안전하게 동작.
    return max(1, int(len((s or "").split()) * 1.3))

def _clean_md(md: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", (md or "")).strip()

def chunk_paragraphs(paras: List[str], max_tokens=CHUNK_TOKENS, overlap=OVERLAP_TOKENS) -> List[str]:
    """문단 리스트를 토큰 기반 슬라이딩으로 분할."""
    chunks, buf, size = [], [], 0
    for p in paras:
        if not p:
            continue
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

def _as_list(x):
    return x if isinstance(x, list) else []

# ───────────────── 관대한 JSON 로더(스캐너) ─────────────────
def _read_json_relaxed(path: Path) -> dict | list:
    """
    파일 전체를 스캔하여 유효한 JSON 객체를 최대한 회수한다.
    우선순위: 'pages' 가진 dict 중 pages가 가장 긴 것 → 그 외 첫 dict/list.
    Concatenated / NDJSON / 앞뒤 잡음 / HTML 섞임까지 견딘다.
    """
    s = path.read_text(encoding="utf-8", errors="ignore")
    if s.startswith("\ufeff"):
        s = s.lstrip("\ufeff")

    # 빠른 보정: 트레일링 콤마 제거
    s_try = re.sub(r",(\s*[}\]])", r"\1", s)

    dec = JSONDecoder()
    i, n = 0, len(s_try)
    best_obj, best_pages = None, -1
    first_valid: Any = None

    while True:
        i = s_try.find("{", i)
        if i < 0:
            break
        try:
            obj, end = dec.raw_decode(s_try, idx=i)
        except JSONDecodeError:
            i += 1
            continue

        if first_valid is None and isinstance(obj, (dict, list)):
            first_valid = obj

        if isinstance(obj, dict):
            pages = obj.get("pages") or []
            if isinstance(pages, list) and len(pages) > best_pages:
                best_obj, best_pages = obj, len(pages)

        i = max(i + 1, end)

    if best_obj is not None:
        return best_obj

    # NDJSON 폴백
    if best_obj is None:
        best_obj2, best_pages2 = None, -1
        for line in s_try.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if first_valid is None and isinstance(obj, (dict, list)):
                first_valid = obj
            if isinstance(obj, dict):
                pages = obj.get("pages") or []
                if isinstance(pages, list) and len(pages) > best_pages2:
                    best_obj2, best_pages2 = obj, len(pages)
        if best_obj2 is not None:
            return best_obj2

    if first_valid is not None:
        return first_valid

    raise RuntimeError(
        "ACSM 원본 JSON 파싱 실패: 파일 안에서 유효한 JSON 객체를 찾지 못했습니다."
    )

# ───────────────── 다양한 스키마 → 통일된 chunks ─────────────────
def _normalize_chunks_from_any(obj: dict | list) -> List[Dict[str, Any]]:
    """
    지원 포맷:
      (A) WeLib pages: dict with 'pages[].items[].md|value'
      (B) 이미 chunk 메타: dict with 'chunks' | 'docs' | 'items' | 'nodes'
      (C) list of chunk-like dicts
    반환: [{'id','text','doc_id','title','section','page_no'}...]
    """
    chunks: List[Dict[str, Any]] = []

    # (A) WeLib pages
    if isinstance(obj, dict) and isinstance(obj.get("pages"), list):
        for page in obj["pages"]:
            pno = page.get("page_no") or page.get("page") or page.get("number")
            title_p = page.get("title") or ""
            for it in _as_list(page.get("items")):
                text = _clean_md(it.get("md") or it.get("value"))
                if not text:
                    continue
                chunks.append({
                    "id": len(chunks),
                    "text": text,
                    "doc_id": it.get("doc_id") or "ACSM6",
                    "title": it.get("title") or title_p,
                    "section": it.get("section") or it.get("heading") or it.get("h") or "",
                    "page_no": pno,
                })
        return chunks

    # (B) dict with known lists or (C) list itself
    cand_list = None
    if isinstance(obj, dict):
        for k in ("chunks", "docs", "items", "nodes"):
            v = obj.get(k)
            if isinstance(v, list):
                cand_list = v
                break
    elif isinstance(obj, list):
        cand_list = obj

    if isinstance(cand_list, list):
        for it in cand_list:
            if not isinstance(it, dict):
                continue
            text = _clean_md(it.get("text") or it.get("md") or it.get("value"))
            if not text:
                continue
            chunks.append({
                "id": len(chunks),
                "text": text,
                "doc_id": it.get("doc_id") or "ACSM6",
                "title": it.get("title") or "",
                "section": it.get("section") or it.get("heading") or it.get("h") or "",
                "page_no": it.get("page_no") or it.get("page") or it.get("number"),
            })
        return chunks

    return []

# ───────────────── 임베딩 ─────────────────
def embed_texts(texts: List[str], model=EMBED_MODEL, batch=BATCH):
    client = _get_client()
    vecs = []
    for i in range(0, len(texts), batch):
        batch_texts = texts[i:i+batch]
        res = client.embeddings.create(model=model, input=batch_texts)
        vecs.extend([d.embedding for d in res.data])
    X = np.array(vecs, dtype="float32")
    faiss.normalize_L2(X)  # 코사인 유사도
    return X

def embed_query(q: str, model=EMBED_MODEL) -> np.ndarray:
    client = _get_client()
    e = client.embeddings.create(model=model, input=[q]).data[0].embedding
    v = np.array([e], dtype="float32")
    faiss.normalize_L2(v)  # 코사인 유사도
    return v

# ───────────────── 인덱스 빌드 ─────────────────
def rebuild_index(reindex_from_meta: bool = False):
    """
    reindex_from_meta=True 이면 META_PATH만으로 재인덱싱(원본 JSON 무시)
    아니면 원본 JSON 시도 → 실패 시 META_PATH 폴백
    """
    obj: dict | list | None = None

    if reindex_from_meta and META_PATH.exists():
        obj = json.loads(META_PATH.read_text(encoding="utf-8"))
        print("[ACSM6] --reindex-from-meta: meta JSON에서 재인덱싱")
    else:
        if JSON_SRC.exists():
            try:
                obj = _read_json_relaxed(JSON_SRC)
            except Exception as e:
                print(f"[ACSM6] source JSON parse failed: {e}")
        if obj is None and META_PATH.exists():
            try:
                obj = json.loads(META_PATH.read_text(encoding="utf-8"))
                print("[ACSM6] Fallback: meta JSON에서 재인덱싱")
            except Exception as e:
                print(f"[ACSM6] meta load failed as fallback: {e}")

    if obj is None:
        raise RuntimeError("소스 JSON/메타 모두 읽기 실패")

    base_chunks = _normalize_chunks_from_any(obj)
    if not base_chunks:
        raise RuntimeError("정규화된 chunks를 만들 수 없습니다. 소스 포맷을 확인하세요.")

    # 길면 분할, 짧으면 그대로
    chunks: List[Dict[str, Any]] = []
    for row in base_chunks:
        text = row.get("text") or ""
        pieces = chunk_paragraphs([text]) if len(text) > 800 else [text]
        for t in pieces:
            chunks.append({
                "id": len(chunks),
                "text": t,
                "doc_id": row.get("doc_id", "ACSM6"),
                "title": row.get("title", ""),
                "section": row.get("section", ""),
                "page_no": row.get("page_no"),
            })

    meta = {
        "corpus": "acsm6",
        "source_file": JSON_SRC.name if JSON_SRC.exists() else "",
        "model": EMBED_MODEL,
        "chunk_tokens": CHUNK_TOKENS,
        "overlap_tokens": OVERLAP_TOKENS,
        "chunks": chunks
    }

    X = embed_texts([c["text"] for c in chunks], model=EMBED_MODEL)
    dim = int(X.shape[1])

    index = faiss.IndexFlatIP(dim)  # 코사인(IP)
    index.add(X)

    faiss.write_index(index, str(INDEX_PATH))
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    PIPE_PATH.write_text(json.dumps({
        "built_from": JSON_SRC.name if JSON_SRC.exists() else "(meta)",
        "embedding_model": EMBED_MODEL
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] index: {INDEX_PATH}")
    print(f"[OK] meta : {META_PATH}")
    print(f"dim={dim}, ntotal={index.ntotal}")

# ───────────────── 검색 ─────────────────
def _mk_query_from_payload(payload: Dict[str, Any]) -> str:
    """처방 입력(payload) → 질의문."""
    u = payload.get("user") or {}
    m = payload.get("measurements") or {}
    surveys = payload.get("surveys") or {}

    parts = [
        f"sex {u.get('sex')}, age {u.get('age')}",
        f"VO2max {m.get('step_vo2max')}, situp {m.get('situp_reps')}, sit-and-reach {m.get('reach_cm')}cm",
        "FITT aerobic intensity HRR RPE, resistance 1RM sets reps rest, flexibility static stretching guidelines",
    ]
    flags = [k for k, v in surveys.items() if v in (True, "Y", "YES", 1)]
    if flags:
        parts.append("risk factors: " + ", ".join(flags))
    return " ".join(p for p in parts if p)

def search(query: str, k=5):
    """수동 쿼리 문자열 검색 (코사인/IP)."""
    assert INDEX_PATH.exists() and META_PATH.exists(), "인덱스가 없습니다. 먼저 --rebuild 실행"
    index = faiss.read_index(str(INDEX_PATH))
    meta  = json.loads(META_PATH.read_text(encoding="utf-8"))

    v = embed_query(query, model=meta["model"])
    D, I = index.search(v, k)

    hits = []
    for rank, (idx, score) in enumerate(zip(I[0], D[0]), start=1):
        ch = meta["chunks"][int(idx)]
        hits.append({
            "rank": rank,
            "score": float(score),
            "id": ch["id"],
            "text": ch["text"],
            "doc_id": ch.get("doc_id", "ACSM6"),
            "title": ch.get("title", ""),
            "section": ch.get("section", ""),
            "page_no": ch.get("page_no"),
        })
    return hits

def search_payload(payload: Dict[str, Any], k=8, rerank_top_k: int = 50):
    """
    처방 payload 기반 검색 + (선택) Cross-Encoder 재정렬.
    재정렬은 sentence-transformers CrossEncoder가 설치되어 있으면 적용.
    """
    assert INDEX_PATH.exists() and META_PATH.exists(), "인덱스가 없습니다. 먼저 --rebuild 실행"
    index = faiss.read_index(str(INDEX_PATH))
    meta  = json.loads(META_PATH.read_text(encoding="utf-8"))
    chunks = meta["chunks"]

    q = _mk_query_from_payload(payload)
    v = embed_query(q, model=meta["model"])

    D, I = index.search(v, max(k, rerank_top_k))
    cands = []
    for rank, (idx, score) in enumerate(zip(I[0], D[0]), start=1):
        ch = chunks[int(idx)]
        cands.append({
            "rank": rank,
            "score_vec": float(score),
            **ch
        })

    # (선택) Cross-Encoder 재정렬
    if rerank_top_k and rerank_top_k > 0:
        try:
            from sentence_transformers import CrossEncoder
            ce = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            pairs = [(q, c["text"]) for c in cands[:rerank_top_k]]
            scores = ce.predict(pairs, batch_size=64)
            for i, s in enumerate(scores):
                cands[i]["score_ce"] = float(s)
            cands[:rerank_top_k] = sorted(
                cands[:rerank_top_k],
                key=lambda x: x.get("score_ce", 0.0),
                reverse=True
            )
        except Exception:
            pass

    # 최종 k개 정리(발췌문 포함)
    out = []
    for c in cands[:k]:
        out.append({
            "doc_id": c.get("doc_id", "ACSM6"),
            "title": c.get("title", ""),
            "section": c.get("section", ""),
            "page_no": c.get("page_no"),
            "passage": c["text"],
            "score": float(c.get("score_ce") or c.get("score_vec")),
        })
    return out

# ───────────────── CLI ─────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="ACSM JSON으로부터 인덱스 재생성")
    ap.add_argument("--search", type=str, help="간단 검색 테스트 쿼리(문자열)")
    ap.add_argument("--search-payload", dest="search_payload", type=str,
                    help="payload JSON 경로(파일에서 로드하여 검색)")
    ap.add_argument("--reindex-from-meta", action="store_true",
                    help="원본 JSON 무시, acsm6_meta.json만으로 임베딩/인덱스 재생성")
    ap.add_argument("-k", type=int, default=5, help="검색 top-k")
    ap.add_argument("--json", type=str, help="원본 ACSM JSON 경로 override")
    args = ap.parse_args()

    # JSON_SRC override (global 키워드 불필요)
    if args.json:
        JSON_SRC = Path(args.json)

    if args.rebuild:
        rebuild_index(reindex_from_meta=args.reindex_from_meta)

    if args.search:
        for h in search(args.search, k=args.k):
            preview = h["text"][:160].replace("\n", " ")
            print(f"[{h['rank']}] score={h['score']:.4f}  id={h['id']}  {preview}")

    sp = getattr(args, "search_payload", None)
    if sp:
        payload_path = Path(sp)
        payload = json.loads(payload_path.read_text("utf-8"))
        for i, it in enumerate(search_payload(payload, k=args.k), 1):
            pv = it["passage"][:160].replace("\n", " ")
            loc = f" p.{it['page_no']}" if it.get("page_no") else ""
            print(f"[{i}] {it['doc_id']}{loc}  score={it['score']:.4f}  {pv}")
