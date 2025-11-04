// src/pages/MeasureSitup.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { usePoseCamera } from "../hooks/usePoseCamera";
import { estimateYawDeg, angleOKForTest } from "../logic/framing";
import { updateSitupCountByBodyAngle, resetSitupCounterByBodyAngle } from "../logic/situpCounterByBodyAngle";
import { IDX, VIS_TH, SIT_SIDE_MIN } from "../utils/poseIdx";
import { angleDeg } from "../utils/math";
import { useApp } from "../state/AppState"; // ✅ 전역 세션 저장을 위해 추가

export default function MeasureSitup() {
  const nav = useNavigate();
  const { setSession } = useApp(); // ✅ 추가: 완료 결과를 전역으로 저장

  // 카메라/포즈
  const { videoRef, canvasRef, landmarks, fps, error } = usePoseCamera({ enable: true });

  // 상태
  const [phase, setPhase] = useState("guide"); // guide→countdown→running→finished
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const [yawDeg, setYawDeg] = useState(NaN);
  const [angleOK, setAngleOK] = useState(false);
  const [sideCount, setSideCount] = useState(0);
  const [bodyAngle, setBodyAngle] = useState(NaN); // 화면에 띄울 "몸각도"
  const [hudStatus, setHudStatus] = useState("대기");
  const [reps, setReps] = useState(0);
  const repsRef = useRef(0);
  useEffect(() => { repsRef.current = reps; }, [reps]);

  const [countdown, setCountdown] = useState(5);

  // ⏱️ 4초 종료 타이머
  const repFinishTimerRef = useRef(null);

  // 오디오
  const situpAudioRef = useRef(null);
  useEffect(() => {
    const el = new Audio("/audio/situp-cue.mp3");
    situpAudioRef.current = el;
    return () => { try { el.pause(); } catch {} };
  }, []);

  // ── 내부 유틸: 측면 가시성 점수 & 엉덩이 각도 계산
  function sideVisibilityCount(lms, side /* "L" | "R" */) {
    const arr = side === "L"
      ? [IDX.L_SH, IDX.L_EL, IDX.L_WR, IDX.L_HIP, IDX.L_KNEE, IDX.L_ANK]
      : [IDX.R_SH, IDX.R_EL, IDX.R_WR, IDX.R_HIP, IDX.R_KNEE, IDX.R_ANK];
    return arr.reduce((c, i) => {
      const p = lms?.[i];
      if (!p) return c;
      const ok = (p.visibility ?? 0) >= VIS_TH && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      return c + (ok ? 1 : 0);
    }, 0);
  }

  function hipAngle(lms, side /* "L" | "R" */) {
    if (!lms) return NaN;
    const SH = side === "L" ? lms[IDX.L_SH] : lms[IDX.R_SH];
    const HIP = side === "L" ? lms[IDX.L_HIP] : lms[IDX.R_HIP];
    const KNEE = side === "L" ? lms[IDX.L_KNEE] : lms[IDX.R_KNEE];
    if (!SH || !HIP || !KNEE) return NaN;
    return angleDeg(SH, HIP, KNEE); // 어깨-엉덩이-무릎
  }

  // 미디어파이프 관절 & 뼈대 그리기
  function drawSkeleton(ctx, lms) {
    if (!lms || !ctx) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const pairs = [
      [IDX.L_SH, IDX.R_SH], [IDX.L_HIP, IDX.R_HIP],
      [IDX.L_SH, IDX.L_EL], [IDX.L_EL, IDX.L_WR],
      [IDX.R_SH, IDX.R_EL], [IDX.R_EL, IDX.R_WR],
      [IDX.L_HIP, IDX.L_KNEE], [IDX.L_KNEE, IDX.L_ANK],
      [IDX.R_HIP, IDX.R_KNEE], [IDX.R_KNEE, IDX.R_ANK],
      [IDX.L_SH, IDX.L_HIP], [IDX.R_SH, IDX.R_HIP],
    ];

    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 200, 255, 0.9)";
    ctx.fillStyle = "rgba(255, 255, 255, 1)";
    for (const [a, b] of pairs) {
      const pa = lms[a], pb = lms[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 0) < VIS_TH || (pb.visibility ?? 0) < VIS_TH) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * W, pa.y * H);
      ctx.lineTo(pb.x * W, pb.y * H);
      ctx.stroke();
    }
    for (const i of [IDX.L_SH, IDX.R_SH, IDX.L_EL, IDX.R_EL, IDX.L_WR, IDX.R_WR, IDX.L_HIP, IDX.R_HIP, IDX.L_KNEE, IDX.R_KNEE, IDX.L_ANK, IDX.R_ANK]) {
      const p = lms[i];
      if (!p || (p.visibility ?? 0) < VIS_TH) continue;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // landmark 들어올 때마다 처리 + 스켈레톤 드로잉
  useEffect(() => {
    if (!landmarks) return;

    // 1) 카메라 각도 체크
    const yaw = estimateYawDeg(landmarks);
    setYawDeg(yaw);
    const okYaw = angleOKForTest("situp", yaw);
    setAngleOK(okYaw);

    // 2) 좌/우 가시성 점수 & 몸각도 산출
    const lc = sideVisibilityCount(landmarks, "L");
    const rc = sideVisibilityCount(landmarks, "R");
    const side = lc >= rc ? "L" : "R";
    const count = Math.max(lc, rc);
    setSideCount(count);

    const ang = hipAngle(landmarks, side);
    setBodyAngle(ang);

    // 3) 카운팅
    if (phaseRef.current === "running") {
      if (!okYaw) {
        setHudStatus("프레이밍 불량(Yaw) — 카운트 일시정지");
        return;
      }
      const { phaseStr, reps: newReps, debugAngle } =
        updateSitupCountByBodyAngle(ang, repsRef);
      setReps(newReps);
      setHudStatus(
        `각도 ${Number.isFinite(debugAngle) ? Math.round(debugAngle) : "—"}° (${phaseStr})`
      );
    } else {
      setHudStatus("대기");
    }

    // 4) 스켈레톤 그리기
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      drawSkeleton(ctx, landmarks);
    }
  }, [landmarks]);

  // guide → countdown 자동 전환
  useEffect(() => {
    if (phase !== "guide") return;
    if (sideCount >= SIT_SIDE_MIN && angleOK) {
      const t = setTimeout(() => {
        setPhase("countdown");
        setCountdown(5);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [phase, sideCount, angleOK]);

  // countdown → running
  useEffect(() => {
    if (phase !== "countdown") return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setPhase("running");
          try {
            situpAudioRef.current.currentTime = 0;
            situpAudioRef.current.play();
          } catch {}
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // reps 증가시 4초 종료 타이머 (추가 증가 없으면 종료)
  useEffect(() => {
    if (phase !== "running") return;
    if (reps <= 0) return;

    if (repFinishTimerRef.current) clearTimeout(repFinishTimerRef.current);
    const snapshot = reps;
    repFinishTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "running" && repsRef.current === snapshot) {
        setPhase("finished");

        // ✅ 측정 종료 시점에 전역 세션 저장 (완전 자동)
        setSession((s) => ({
          ...s,
          situp: {
            ...s.situp,
            reps: repsRef.current,
            // maxTorsoDeg 등을 따로 추적했다면 여기서 같이 저장
          },
        }));
      }
    }, 4000);

    return () => {
      if (repFinishTimerRef.current) clearTimeout(repFinishTimerRef.current);
    };
  }, [reps, phase, setSession]);

  // 종료 시 오디오 중지
  useEffect(() => {
    if (phase !== "finished") return;
    try {
      if (situpAudioRef.current) {
        situpAudioRef.current.pause();
        situpAudioRef.current.currentTime = 0;
      }
    } catch {}
  }, [phase]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (repFinishTimerRef.current) clearTimeout(repFinishTimerRef.current);
    };
  }, []);

  function handleReset() {
    resetSitupCounterByBodyAngle();
    setPhase("guide");
    setCountdown(5);
    setYawDeg(NaN);
    setAngleOK(false);
    setSideCount(0);
    setBodyAngle(NaN);
    setHudStatus("대기");
    setReps(0);
    if (repFinishTimerRef.current) clearTimeout(repFinishTimerRef.current);
    try {
      if (situpAudioRef.current) {
        situpAudioRef.current.pause();
        situpAudioRef.current.currentTime = 0;
      }
    } catch {}
  }

  // ✅ “종목 선택으로” 눌렀을 때도 마지막 스냅샷 저장 + 선택창 알림
  function handleBackToSelect() {
    setSession((s) => ({
      ...s,
      situp: {
        ...s.situp,
        reps: Math.max(s?.situp?.reps ?? 0, repsRef.current), // 기존값보다 큰 경우만 갱신
      },
    }));
    nav("/select", {
      state: {
        justFinished: {
          test: "situp",
          summary: `횟수 ${Math.max(repsRef.current, 0)}회`,
        },
      },
    });
  }

  return (
    <div style={{ padding:0, color:"#fff", background:"#000" }}>
      {error && (
        <div style={{
          background:"#3a1120", border:"1px solid #a23",
          padding:8, borderRadius:8, margin:8
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 안내 영역 */}
      <div style={{
        background:"#1118", padding:8, borderRadius:8,
        textAlign:"center", margin:"8px"
      }}>
        {phase === "countdown"
          ? `곧 시작: ${countdown}`
          : phase === "running"
          ? "계속 반복하세요. 자동으로 카운트합니다."
          : phase === "finished"
          ? "측정 종료"
          : "프레이밍을 맞춰주세요."}
      </div>

      {/* 카메라 + 오버레이들 */}
      <div style={{ position:"relative" }}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{
            position:"absolute", inset:0,
            width:"100%", height:"100%",
            objectFit:"cover",
          }}
        />
        {/* 관절 오버레이 캔버스 */}
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          style={{
            position:"relative",
            width:"100%",
            height:"auto",
          }}
        />

        {/* 좌측-하단 오버레이 (HUD + 버튼) */}
        <div style={{
          position:"absolute",
          left:12,
          bottom:12,
          display:"flex",
          flexDirection:"column",
          gap:10
        }}>
          {/* HUD */}
          <div style={{
            display:"flex",
            gap:10,
            flexWrap:"wrap",
            alignItems:"center",
            background:"rgba(0,0,0,0.35)",
            border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:14,
            padding:"8px 10px",
            backdropFilter:"blur(4px)"
          }}>
            <Pill>FPS {fps}</Pill>
            <Pill>상태 {hudStatus}</Pill>
            <Pill>Yaw {Number.isFinite(yawDeg) ? Math.round(yawDeg):"—"}° {angleOK?"🟢":"🔴"}</Pill>
            <Pill>측면 가시 {sideCount}/6</Pill>
            <Pill>몸각도 {Number.isFinite(bodyAngle)?Math.round(bodyAngle):"—"}°</Pill>
            <Pill>횟수 {reps}</Pill>
          </div>

          {/* 버튼들 */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Button bg="#555" onClick={handleReset}>리셋</Button>
            {(phase === "running" || phase === "finished") ? (
              <Button bg="#28a" onClick={()=>nav("/results")}>결과 보기</Button>
            ) : null}
            <Button bg="#444" onClick={handleBackToSelect}>종목 선택으로</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({children}) {
  return (
    <span style={{
      background:"#1a1a2a",
      border:"1px solid #444",
      borderRadius:"999px",
      padding:"6px 10px",
      fontSize:"12px"
    }}>{children}</span>
  );
}
function Button({bg,onClick,children,disabled}) {
  return (
    <button
      style={{
        background:bg,
        opacity: disabled?0.4:1,
        color:"#fff",
        border:"none",
        borderRadius:"10px",
        padding:"10px 14px",
        fontSize:"14px",
        fontWeight:600,
        minWidth:"120px",
        cursor:"pointer"
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
