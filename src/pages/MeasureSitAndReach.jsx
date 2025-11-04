// src/pages/MeasureSitAndReach.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState";

import {
  estimateForwardReachSignedCmX_oneSide,
  estimateYawDeg,
  angleOKForReach,
  makePeakHoldController,
} from "../logic/sitAndReachLogic.js";

// 좌전굴 규칙: 최대치에서 3초 유지
const peakHold = makePeakHoldController({
  needSec: 3.0,
  fps: 30,
  tolCm: 1.0,
  minIncrementToArm: 0.5,
});

const READY_HOLD_NEED = 30; // yaw OK를 1초 유지 시 자동 시작(30fps 가정)

export default function MeasureSitAndReach() {
  const nav = useNavigate();
  const { profile, setSession } = useApp(); // ✅ 저장용 setSession 추가
  const userHeight = Number(profile?.height || 170);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [hudFps, setHudFps] = useState(0);
  const [yawDeg, setYawDeg] = useState(NaN);
  const [angleOK, setAngleOK] = useState(false);

  // ready → countdown → running → finished
  const [phase, setPhase] = useState("ready");
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const [count, setCount] = useState(5);
  const [currentReachCm, setCurrentReachCm] = useState(0);
  const [bestReachCm, setBestReachCm] = useState(0);
  const [holdAtPeakSec, setHoldAtPeakSec] = useState("0.0");
  const [readyFrameOk, setReadyFrameOk] = useState(false);
  const [whichSide, setWhichSide] = useState("-");
  const [subtitle, setSubtitle] = useState(
    "측면 각도(85~95°)만 맞추면 됩니다. 준비되면 1초 유지 시 자동 시작합니다."
  );
  const [error, setError] = useState("");

  // ✅ 최신 best를 저장 클릭 시점에 정확히 읽기 위한 ref
  const bestRef = useRef(0);
  useEffect(() => { bestRef.current = bestReachCm; }, [bestReachCm]);

  // 자동 시작/카운트다운 제어
  const [autoStartArmed, setAutoStartArmed] = useState(true);
  const readyHoldRef = useRef(0);
  const yawOKRef = useRef(false); // countdown 중 이탈 감지용

  useEffect(() => {
    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    const ctx = canvasEl.getContext("2d");

    const pose = new window.Pose({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    let lastTs = performance.now();

    pose.onResults((res) => {
      const now = performance.now();
      const fps = Math.round(1000 / Math.max(16, now - lastTs));
      lastTs = now;
      setHudFps(fps);

      const img = res.image;
      if (img) {
        if (canvasEl.width !== img.width || canvasEl.height !== img.height) {
          canvasEl.width = img.width; canvasEl.height = img.height;
        }
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      }

      const lms = res.poseLandmarks;
      if (!lms?.length) return;

      if (window.drawConnectors && window.POSE_CONNECTIONS) {
        window.drawConnectors(ctx, lms, window.POSE_CONNECTIONS, { lineWidth: 3 });
        window.drawLandmarks(ctx, lms, { radius: 3 });
      }

      const yaw = estimateYawDeg(lms);
      setYawDeg(yaw);
      const okYaw = angleOKForReach(yaw, 85, 95);
      setAngleOK(okYaw);
      yawOKRef.current = okYaw;

      // ready 단계
      if (phaseRef.current === "ready") {
        setReadyFrameOk(okYaw);
        if (okYaw) {
          readyHoldRef.current += 1;
          const remainSec = Math.max(0, (READY_HOLD_NEED - readyHoldRef.current) / 30);
          setSubtitle(
            remainSec > 0
              ? `측면 각도 OK 유지 중… 약 ${remainSec.toFixed(1)}초 뒤 자동 시작`
              : "자동 시작!"
          );
          if (autoStartArmed && readyHoldRef.current >= READY_HOLD_NEED) {
            setAutoStartArmed(false);
            handleStartMeasure();
          }
        } else {
          readyHoldRef.current = 0;
          setSubtitle("측면 각도(85~95°)만 맞추면 됩니다. 준비되면 1초 유지 후 자동 시작.");
        }
        return;
      }

      // countdown 단계
      if (phaseRef.current === "countdown") {
        if (!okYaw) {
          setSubtitle("프레이밍 이탈로 카운트다운이 취소되었습니다. 다시 자세를 맞추세요.");
          setPhase("ready");
        }
        return;
      }

      // running 단계
      if (phaseRef.current === "running") {
        if (!okYaw) {
          peakHold.breakHold();
          setSubtitle("측면 각도 벗어남 (85~95° 필요). 다시 맞추면 이어집니다.");
          return;
        }

        const { cm, side, ok } = estimateForwardReachSignedCmX_oneSide(lms, userHeight);
        if (ok && side) setWhichSide(side);
        const cmSan = Number.isFinite(cm) ? cm : 0;
        setCurrentReachCm(cmSan);

        const { bestCm, armed, holdSec, done } = peakHold.push(cmSan);
        setBestReachCm(bestCm);
        setHoldAtPeakSec(holdSec.toFixed(1));

        if (!armed) setSubtitle("더 멀리 뻗어보세요. 최대점에서 3초 유지 시 완료!");
        else if (!done) setSubtitle("좋아요! 유지 중… 3초간 흔들림 없이 버티세요.");
        else {
          setPhase("finished");
          setSubtitle("측정 완료! 결과를 저장하세요.");
        }
        return;
      }
    });

    const camera = new window.Camera(videoEl, {
      onFrame: async () => { await pose.send({ image: videoEl }); },
      width: 1280,
      height: 720,
    });

    videoEl.playsInline = true; videoEl.muted = true; videoEl.autoplay = true;

    camera.start().catch((e) => {
      console.error(e);
      setError("카메라 시작 실패: HTTPS/권한/브라우저 설정을 확인하세요.");
    });

    return () => {
      try { camera.stop(); } catch {}
      try { pose.close(); } catch {}
      peakHold.reset();
    };
  }, [userHeight, autoStartArmed]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const timer = setInterval(() => {
      if (!yawOKRef.current) {
        clearInterval(timer);
        setSubtitle("프레이밍 이탈로 카운트다운 취소.");
        setPhase("ready");
        return;
      }
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer);
          peakHold.reset();
          setBestReachCm(0);
          setCurrentReachCm(0);
          setHoldAtPeakSec("0.0");
          setWhichSide("-");
          setSubtitle("측정 시작!");
          setPhase("running");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function handleStartMeasure() {
    if (phase !== "ready") return;
    setCount(5);
    setPhase("countdown");
    readyHoldRef.current = 0;
  }

  function handleReset() {
    peakHold.reset();
    setPhase("ready");
    setCount(5);
    setYawDeg(NaN);
    setAngleOK(false);
    setReadyFrameOk(false);
    setCurrentReachCm(0);
    setBestReachCm(0);
    setHoldAtPeakSec("0.0");
    setWhichSide("-");
    setAutoStartArmed(true);
    readyHoldRef.current = 0;
    setSubtitle("측면 각도(85~95°)만 맞추면 됩니다. 준비되면 1초 유지 시 자동 시작합니다.");
  }

  // ✅ 저장만 하고 선택창으로 돌아가기
  function handleBackToSelectSaveOnly() {
    const best = Number.isFinite(bestRef.current) ? bestRef.current : 0;
    setSession(prev => ({
      ...prev,
      reach: {
        ...(prev.reach ?? {}),
        bestCm: best, // 필요하면 Math.max(prev.reach?.bestCm ?? 0, best)
        measuredAt: new Date().toISOString(),
      },
    }));
    nav("/select");
  }

  const pillStyle = {
    background: "#0b0b0bcc",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: "8px",
    padding: "4px 8px",
    fontSize: "12px",
    lineHeight: 1.3,
    backdropFilter: "blur(3px)",
  };
  const btnStyle = (bg) => ({
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    padding: "10px 14px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    minWidth: "120px",
  });

  return (
    <div style={{ padding: 16, color: "#fff", backgroundColor: "#000" }}>
      {error && (
        <div style={{
          background: "#3a1120",
          border: "1px solid #a23",
          padding: 8,
          borderRadius: 8,
          marginBottom: 8,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 상단 안내 */}
      <div style={{
        background: "#1118",
        padding: 8,
        borderRadius: 8,
        textAlign: "center",
        marginBottom: 8,
      }}>
        {phase === "countdown" ? `곧 시작: ${count}` : subtitle}
      </div>

      {/* 카메라 + HUD 오버레이 */}
      <div className="camwrap" style={{ position: "relative" }}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 1,
          }}
        />
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            zIndex: 2,
            position: "relative",
          }}
        />

        {/* HUD (좌하단 오버레이) */}
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            background: "rgba(0,0,0,0.25)",
            padding: 8,
            borderRadius: 8,
          }}
        >
          <span style={pillStyle}>FPS {hudFps}</span>
          <span style={pillStyle}>
            Yaw {Number.isFinite(yawDeg) ? Math.round(yawDeg) : "—"}° {angleOK ? "🟢" : "🔴"}
          </span>
          <span style={pillStyle}>Side {whichSide}</span>
          <span style={pillStyle}>
            현재 {currentReachCm >= 0 ? "+" : ""}{currentReachCm.toFixed(1)} cm
          </span>
          <span style={pillStyle}>
            최대 {bestReachCm >= 0 ? "+" : ""}{bestReachCm.toFixed(1)} cm
          </span>
          {phase === "running" && (
            <span style={pillStyle}>피크 유지 {holdAtPeakSec}s / 3.0s</span>
          )}
          {phase === "ready" && (
            <>
              <span style={pillStyle}>세팅 {readyFrameOk ? "🟢OK" : "🔴조정필요"}</span>
              <span style={pillStyle}>자동시작 {autoStartArmed ? "ON" : "OFF"}</span>
            </>
          )}
          {phase === "finished" && (
            <span style={pillStyle}>
              최종 {bestReachCm >= 0 ? "+" : ""}{bestReachCm.toFixed(1)}cm
            </span>
          )}
        </div>
      </div>

      {/* 버튼: 리셋 / 결과 보기 / 종목 선택으로 */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {phase === "finished" ? (
          <>
            <button style={btnStyle("#28a")} onClick={() => nav("/results")}>
              결과 보기
            </button>
            <button style={btnStyle("#555")} onClick={handleReset}>
              다시 측정
            </button>
          </>
        ) : (
          <button style={btnStyle("#555")} onClick={handleReset}>
            리셋
          </button>
        )}
        {/* ⬇️ 저장만 하고 선택창으로 (측정 루프 영향 없음) */}
        <button style={btnStyle("#444")} onClick={handleBackToSelectSaveOnly}>
          종목 선택으로
        </button>
      </div>
    </div>
  );
}
