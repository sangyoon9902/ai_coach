# server/main.py
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Any, Dict
from uuid import uuid4
import json

# ✅ 변경된 부분: KSPO 전용 엔진 불러오기
from .rag.query_engine_kspo_only import (
    generate_prescription_kspo_only,
)
from .rag.query_engine_kspo_only import _get_openai_client  # optional health check

app = FastAPI(title="AI Fitness API", version="0.2.0")

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
        # 간단한 초기화 테스트
        _ = _get_openai_client()
        print("✅ OpenAI 클라이언트 로드 완료 (KSPO 전용)")
    except Exception as e:
        print("⚠️ OpenAI 초기화 실패:", e)

@app.get("/health")
def health():
    return {"ok": True, "service": "ai-fitness", "version": app.version}

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
        return JSONResponse(
            status_code=400,
            content={"trace_id": trace_id, "error": "invalid_json", "detail": str(e)},
        )

    print(f"🌐 [session_summary] 요청 수신: {trace_id}")
    try:
        print(json.dumps(body, ensure_ascii=False, indent=2))
    except Exception:
        print(str(body))

    try:
        # ✅ 변경 포인트: KSPO 전용 추천 함수 사용
        plan = generate_prescription_kspo_only(body, per_cat=3)
    except Exception as e:
        print(f"⚠️ RAG 생성 오류({trace_id}): {e}")
        raise HTTPException(status_code=500, detail=f"RAG error: {e}")

    return {
        "trace_id": trace_id,
        "received": body,
        **plan,  # planText + recommendations + case_refs 포함
    }

@app.get("/")
def root():
    return {
        "hello": "AI Fitness API",
        "health": "/health",
        "post_endpoint": "/session_summary",
        "version": app.version,
    }
