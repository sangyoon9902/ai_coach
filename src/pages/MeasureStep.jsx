// src/pages/MeasureStep.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState";
import {
  STEP_STEPPING_SEC,   // 180
  STEP_RECOVERY_SEC,   // 60
  calcFitnessScore,
  usePulsoidBpm,       // ✅ 프록시 폴링 훅
} from "../logic/stepLogic";
import { formatMMSS } from "../utils/format";

const STEP_AUDIO_SRC = "/audio/step-beat.mp3";

// Pulsoid 프록시(API 게이트웨이)
const PULSOID_API_BASE =
  import.meta?.env?.VITE_PULSOID_PROXY || "http://localhost:3001";

// 안내(28초) → 3분 스텝 → 1분 회복
const USE_GUIDED_FLOW = true;
const GUIDE_SEC = 28;

export default function MeasureStep() {
  const nav = useNavigate();
  const { setSession } = useApp();

  // 모드/단계
  const [mode, setMode] = useState("auto"); // 'auto' | 'manual'
  const [phase, setPhase] = useState("idle"); // idle | prestep | stepping | recovery | count10 | count10_done | done
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Pulsoid 연결상태
  const [pulsoidConnected, setPulsoidConnected] = useState(false);
  const [connectStatus, setConnectStatus] = useState("idle"); // idle | connecting | connected | error
  const [connectError, setConnectError] = useState("");

  // ✅ 토큰 없이 프록시만 폴링
  const hrBpm = usePulsoidBpm(pulsoidConnected && mode === "auto", PULSOID_API_BASE);

  const lastValidHrRef = useRef(null);
  useEffect(() => {
    if (Number.isFinite(hrBpm) && hrBpm > 0) lastValidHrRef.current = hrBpm;
  }, [hrBpm]);

  // 타이머
  const [stepTimer, setStepTimer] = useState(STEP_STEPPING_SEC);
  const [recoveryTimer, setRecoveryTimer] = useState(STEP_RECOVERY_SEC);
  const [count10Timer, setCount10Timer] = useState(10);

  // 결과/입력
  const [restingBpm, setRestingBpm] = useState(null);
  const [manualResting, setManualResting] = useState("");      // 시작 전 안정심박 (수동)
  const [manualBeats10, setManualBeats10] = useState("");      // 10초 박동 수 (수동)
  const [recoveryAvg, setRecoveryAvg] = useState(null);
  const [stepScore, setStepScore] = useState(null);

  // 시작 오디오(안내+메트로놈)
  const stepAudioRef = useRef(null);
  useEffect(() => {
    const a = new Audio(STEP_AUDIO_SRC);
    a.preload = "auto";
    a.loop = false;
    a.volume = 1.0;
    stepAudioRef.current = a;
    return () => { try { a.pause(); a.currentTime = 0; } catch {} };
  }, []);

  // 안내→스텝→회복 드라이버
  const guideDriverIdRef = useRef(null);
  const guideStartTsRef = useRef(null);
  const steppedRef = useRef(false);

  function startGuidedFlow() {
    if (!stepAudioRef.current) return;
    if (guideDriverIdRef.current) clearInterval(guideDriverIdRef.current);
    steppedRef.current = false;

    try { stepAudioRef.current.currentTime = 0; stepAudioRef.current.play().catch(() => {}); } catch {}
    guideStartTsRef.current = performance.now();
    setPhase("prestep");

    guideDriverIdRef.current = setInterval(() => {
      const elapsedSec = Math.floor((performance.now() - guideStartTsRef.current) / 1000);

      if (elapsedSec < GUIDE_SEC) {
        if (phaseRef.current !== "prestep") setPhase("prestep");
      }
      if (!steppedRef.current && elapsedSec >= GUIDE_SEC) {
        steppedRef.current = true;
        setPhase("stepping");
        setStepTimer(STEP_STEPPING_SEC);
      }
      if (steppedRef.current && phaseRef.current === "stepping") {
        const measuredSec = elapsedSec - GUIDE_SEC;
        setStepTimer(Math.max(0, STEP_STEPPING_SEC - measuredSec));
      }
      if (elapsedSec >= GUIDE_SEC + STEP_STEPPING_SEC) {
        try { stepAudioRef.current.pause(); stepAudioRef.current.currentTime = 0; } catch {}
        clearInterval(guideDriverIdRef.current);
        guideDriverIdRef.current = null;
        setPhase("recovery");
        setRecoveryTimer(STEP_RECOVERY_SEC);
      }
    }, 200);
  }
  function stopGuidedFlow() {
    if (guideDriverIdRef.current) { clearInterval(guideDriverIdRef.current); guideDriverIdRef.current = null; }
    try { stepAudioRef.current?.pause(); if (stepAudioRef.current) stepAudioRef.current.currentTime = 0; } catch {}
  }

  // (비가이드) 스텝 타이머
  useEffect(() => {
    if (USE_GUIDED_FLOW) return;
    if (phase !== "stepping") return;
    if (stepTimer <= 0) { setPhase("recovery"); setRecoveryTimer(STEP_RECOVERY_SEC); return; }
    const id = setTimeout(() => setStepTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, stepTimer]);

  // 회복 타이머 끝 → 자동: 그 시점 HR / 수동: 10초 카운트
  useEffect(() => {
    if (phase !== "recovery") return;
    if (recoveryTimer <= 0) {
      if (mode === "auto") {
        const hrAt1min = Number.isFinite(lastValidHrRef.current) ? lastValidHrRef.current : null;
        finishWithBpm(hrAt1min);
      } else {
        setManualBeats10("");
        setCount10Timer(10);
        setPhase("count10");
      }
      return;
    }
    const id = setTimeout(() => setRecoveryTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, recoveryTimer, mode]);

  // 수동 10초 카운트 타이머
  useEffect(() => {
    if (phase !== "count10") return;
    if (count10Timer <= 0) {
      setPhase("count10_done"); // 입력 시간 주기
      return;
    }
    const id = setTimeout(() => setCount10Timer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, count10Timer]);

  // 결과 저장 공통
  function finishWithBpm(bpmVal) {
    const scoreObj = calcFitnessScore(bpmVal);
    setRecoveryAvg(bpmVal);
    setStepScore(scoreObj);
    setSession(prev => ({
      ...prev,
      step: {
        ...(prev.step ?? {}),
        restingBpm: restingBpm ?? prev.step?.restingBpm ?? null,
        recoveryAvg: bpmVal, // 수동: 10초×6, 자동: 1분 시점 HR
        vo2max: scoreObj?.vo2max ?? null,
        grade: scoreObj?.grade ?? null,
        gradeDesc: scoreObj?.desc ?? null,
        measuredAt: new Date().toISOString(),
      },
    }));
    setPhase("done");
  }

  // 수동 입력 완료
  function handleSubmitManualBeats() {
    const beats = parseInt(manualBeats10, 10);
    if (!Number.isFinite(beats) || beats <= 0) return;
    const bpm = beats * 6;
    finishWithBpm(bpm);
  }

  // ✅ Pulsoid 연결 시 실제 API 호출로 “연결 확인”
  async function handleConnectPulsoid() {
    setConnectStatus("connecting");
    setConnectError("");
    setPulsoidConnected(false);

    // 3초 타임아웃
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);

    try {
      const url = `${PULSOID_API_BASE}/api/heart-rate`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));

      const bpm = Number(data?.bpm ?? data?.heart_rate ?? data?.value);
      if (Number.isFinite(bpm) && bpm > 0) {
        setPulsoidConnected(true);
        setConnectStatus("connected");
      } else {
        setPulsoidConnected(false);
        setConnectStatus("error");
        setConnectError("기기에서 유효한 심박 데이터가 감지되지 않았습니다.");
      }
    } catch (e) {
      clearTimeout(t);
      setPulsoidConnected(false);
      setConnectStatus("error");
      setConnectError(
        "연결 실패: Pulsoid 프록시에 접속할 수 없습니다. " +
        `(${PULSOID_API_BASE} 확인) 서버 실행/포트/CORS 설정을 점검하세요.`
      );
      console.warn("Pulsoid connect error:", e);
    }
  }

  function handleStartStep() {
    // 시작 전 안정심박 확정(≤100)
    const startRest = mode === "auto"
      ? (Number.isFinite(hrBpm) ? hrBpm : null)
      : (Number.isFinite(parseFloat(manualResting)) ? parseFloat(manualResting) : null);

    if (!Number.isFinite(startRest) || startRest <= 0 || startRest > 100) return;
    setRestingBpm(startRest);
    setSession(prev => ({ ...prev, step: { ...(prev.step ?? {}), restingBpm: startRest } }));

    // 초기화
    setRecoveryAvg(null);
    setStepScore(null);
    setManualBeats10("");
    setStepTimer(STEP_STEPPING_SEC);
    setRecoveryTimer(STEP_RECOVERY_SEC);

    if (USE_GUIDED_FLOW) startGuidedFlow();
    else {
      try { stepAudioRef.current.currentTime = 0; stepAudioRef.current.play().catch(()=>{});} catch {}
      setPhase("stepping");
    }
  }

  function handleReset() {
    if (USE_GUIDED_FLOW) stopGuidedFlow();
    else { try { stepAudioRef.current?.pause(); stepAudioRef.current.currentTime = 0; } catch {} }

    setPulsoidConnected(false);
    setConnectStatus("idle");
    setConnectError("");

    setRestingBpm(null);
    setManualResting("");
    setManualBeats10("");
    setRecoveryAvg(null);
    setStepScore(null);
    setStepTimer(STEP_STEPPING_SEC);
    setRecoveryTimer(STEP_RECOVERY_SEC);
    setCount10Timer(10);
    setPhase("idle");
  }

  // ✅ 선택창으로 돌아가기: (완료시) 스냅샷 저장 + 토스트 메시지 전달
  function handleBackToSelect() {
    // 완료가 아니어도 그냥 이동은 가능. 완료라면 토스트/뱃지용 state 전달
    const vo2 = Number.isFinite(stepScore?.vo2max) ? Number(stepScore.vo2max).toFixed(1) : null;
    const rec = Number.isFinite(recoveryAvg) ? Math.round(recoveryAvg) : null;

    const state = (phaseRef.current === "done" && (vo2 || rec !== null))
      ? {
          justFinished: {
            test: "step",
            summary: [
              rec !== null ? `회복 ${rec} bpm` : null,
              vo2 ? `VO₂max ${vo2}` : null,
            ].filter(Boolean).join(", "),
          },
        }
      : undefined;

    nav("/select", { state });
  }

  // 시작 버튼 활성화
  const canStart = mode === "auto"
    ? pulsoidConnected && Number.isFinite(hrBpm) && hrBpm > 0 && hrBpm <= 100
    : (Number.isFinite(parseFloat(manualResting)) && parseFloat(manualResting) > 0 && parseFloat(manualResting) <= 100);

  const canSubmitBeats = Number.isFinite(parseInt(manualBeats10, 10)) && parseInt(manualBeats10, 10) > 0;

  return (
    <div style={{ padding:"16px", color:"#fff", background:"#000", minHeight:"100vh" }}>
      {/* 연결 에러 배너 */}
      {connectStatus === "error" && (
        <div style={{ background:"#3a1120", border:"1px solid #a23", padding:8, borderRadius:8, marginBottom:8 }}>
          ⚠️ {connectError}
        </div>
      )}

      {/* 안내 */}
      <div style={{ background:"#1118", padding:8, borderRadius:8, textAlign:"center", marginBottom:8 }}>
        {phase === "idle" && <>연결/입력 → 28초 안내 → 3분 스텝 → 1분 휴식 → (수동)10초 카운트×6 / (자동)1분후 HR</>}
        {phase === "prestep" && <>안내 중입니다. 곧 스텝 검사가 시작됩니다…</>}
        {phase === "stepping" && <>스텝 남은 시간 {formatMMSS(stepTimer)}</>}
        {phase === "recovery" && <>1분간 휴식하세요 — 남은 {formatMMSS(recoveryTimer)}</>}
        {phase === "count10" && <>10초간 심박을 세세요 — 남은 00:{String(count10Timer).padStart(2,"0")}</>}
        {phase === "count10_done" && <>10초 측정이 끝났습니다. 방금 센 박동 수를 입력하고 ‘입력 완료’를 눌러주세요.</>}
        {phase === "done" && <>측정 완료 ✅ 결과 확인</>}
      </div>

      {/* HUD */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:12, fontSize:12 }}>
        <Pill>모드 {mode==="auto"?"자동":"수동"}</Pill>
        <Pill>현재 HR {Number.isFinite(hrBpm)?`${hrBpm} bpm`:"--"}</Pill>
        {Number.isFinite(restingBpm) && <Pill>안정심박 {restingBpm} bpm</Pill>}
        {phase === "done" && (
          <>
            <Pill>회복 기록 {recoveryAvg!=null?`${Math.round(recoveryAvg)} bpm`:"--"}</Pill>
            {stepScore && <Pill>등급 {stepScore.grade} ({stepScore.desc})</Pill>}
            {Number.isFinite(stepScore?.vo2max) && <Pill>VO₂max {Number(stepScore.vo2max).toFixed(1)}</Pill>}
          </>
        )}
      </div>

      {/* 컨트롤 */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
        {phase === "idle" && (
          <>
            <Pill>
              모드:{" "}
              <select value={mode} onChange={e=>setMode(e.target.value)} style={{ background:"transparent", color:"#fff", border:"none" }}>
                <option value="auto">자동(Pulsoid)</option>
                <option value="manual">수동 입력</option>
              </select>
            </Pill>

            {/* 연결 버튼 */}
            <Button
              bg={
                mode!=="auto" ? "#333" :
                connectStatus==="connected" ? "#2d6" :
                connectStatus==="connecting" ? "#777" :
                "#555"
              }
              onClick={mode==="auto" ? handleConnectPulsoid : undefined}
              disabled={mode!=="auto" || connectStatus==="connecting"}
            >
              {mode!=="auto" && "수동 모드"}
              {mode==="auto" && connectStatus==="idle" && "Pulsoid 연결"}
              {mode==="auto" && connectStatus==="connecting" && "연결 중..."}
              {mode==="auto" && connectStatus==="connected" && "Pulsoid 연결됨 ✅"}
              {mode==="auto" && connectStatus==="error" && "연결 실패(다시 시도)"}
            </Button>

            {/* 수동 모드: 안정심박 입력 */}
            {mode==="manual" && (
              <input
                type="number"
                value={manualResting}
                onChange={e=>setManualResting(e.target.value)}
                placeholder="안정심박 (≤100)"
                style={{ background:"#111", color:"#fff", border:"1px solid #444", borderRadius:8, padding:"8px 10px", width:150 }}
              />
            )}

            <Button bg={canStart ? "#28a" : "#444"} disabled={!canStart} onClick={handleStartStep}>
              스텝검사 시작
            </Button>
          </>
        )}

        {(phase==="prestep" || phase==="stepping" || phase==="recovery" || phase==="count10" || phase==="count10_done") && (
          <Button bg="#a33" onClick={handleReset}>중단 / 리셋</Button>
        )}

        {(phase === "count10" || phase === "count10_done") && (
          <>
            <input
              type="number"
              value={manualBeats10}
              onChange={e=>setManualBeats10(e.target.value)}
              placeholder="10초간 박동 수 입력"
              style={{ background:"#111", color:"#fff", border:"1px solid #444", borderRadius:8, padding:"8px 10px", width:160 }}
            />
            <Button bg={canSubmitBeats ? "#28a" : "#444"} disabled={!canSubmitBeats} onClick={handleSubmitManualBeats}>
              입력 완료
            </Button>
          </>
        )}

        {phase === "done" && (
          <>
            <Button bg="#28a" onClick={()=>nav("/results")}>결과 보기 / 저장</Button>
            <Button bg="#555" onClick={handleReset}>다시 측정</Button>
          </>
        )}

        {/* ⬅️ 항상 노출: 종목 선택으로 (완료 시 토스트/뱃지용 state 함께 전달) */}
        <Button bg="#444" onClick={handleBackToSelect}>종목 선택으로</Button>
      </div>
    </div>
  );
}

function Pill({children}) {
  return (
    <span style={{ background:"#1a1a2a", border:"1px solid #444", borderRadius:"999px", padding:"6px 10px", fontSize:12 }}>
      {children}
    </span>
  );
}
function Button({bg,onClick,children,disabled}) {
  return (
    <button
      style={{ background:bg, opacity:disabled?0.4:1, color:"#fff", border:"none", borderRadius:10, padding:"10px 14px", fontSize:14, fontWeight:600, minWidth:120, cursor:"pointer" }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
