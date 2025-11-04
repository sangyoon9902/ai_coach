# server/main.py
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Any, Dict
from uuid import uuid4
import json

from .rag.query_engine import generate_prescription_with_query, rag_status as rag_status_fn

app = FastAPI(title="AI Fitness API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def _startup_rag():
    try:
        status = rag_status_fn()
        print("✅ RAG 상태:", status)
    except Exception as e:
        print("⚠️ RAG 상태 확인 실패:", e)

@app.get("/health")
def health():
    return {"ok": True, "service": "ai-fitness", "version": app.version}

@app.get("/rag_status")
def get_rag_status():
    try:
        return {"ok": True, "status": rag_status_fn()}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/session_summary")
def session_summary_get():
    return {
        "detail": "Use POST with JSON body to /session_summary",
        "example": {
            "user": {"name": "문채희", "sex": "F", "age": 25, "height_cm": 160, "weight_kg": 55, "bmi": 21.5},
            "measurements": {"situp_reps": 20, "reach_cm": 5.0, "step_vo2max": None},
            "surveys": {},
        },
    }

@app.post("/session_summary")
async def session_summary(req: Request):
    trace_id = str(uuid4())
    try:
        body: Dict[str, Any] = await req.json()
    except Exception as e:
        print(f"❌ [session_summary] JSON parse error ({trace_id}): {e}")
        return JSONResponse(status_code=400, content={"trace_id": trace_id, "error": "invalid_json", "detail": str(e)})

    print(f"🌐 [session_summary] 요청 수신: {trace_id}")
    try:
        print(json.dumps(body, ensure_ascii=False, indent=2))
    except Exception:
        print(str(body))

    try:
        plan = generate_prescription_with_query(body)
    except Exception as e:
        print(f"⚠️ RAG 생성 오류({trace_id}): {e}")
        raise HTTPException(status_code=500, detail=f"RAG error: {e}")

    return {
        "trace_id": trace_id,
        "received": body,
        **plan,  # planText + evidence 포함
    }

@app.get("/")
def root():
    return {
        "hello": "AI Fitness API",
        "health": "/health",
        "rag_status": "/rag_status",
        "docs": "/docs",
        "post_endpoint": "/session_summary",
    }
