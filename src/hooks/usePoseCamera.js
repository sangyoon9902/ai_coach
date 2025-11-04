// src/hooks/usePoseCamera.js
import { useEffect, useRef, useState } from "react";

/** landmarks가 '충분히' 동일하면 true */
function sameLandmarks(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // 주요 관절만 소수점 3자리 비교(노이즈 억제)
  for (let i of [0, 11, 12, 23, 24, 25, 26, 27, 28]) {
    if (i >= a.length || i >= b.length) continue;
    const pa = a[i], pb = b[i];
    if (!pa || !pb) continue;
    if (Math.round((pa.x ?? 0) * 1000) !== Math.round((pb.x ?? 0) * 1000)) return false;
    if (Math.round((pa.y ?? 0) * 1000) !== Math.round((pb.y ?? 0) * 1000)) return false;
  }
  return true;
}

export function usePoseCamera({ enable = true } = {}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // 페이지에서 관절 오버레이 용으로 사용

  const [landmarks, setLandmarks] = useState(null);
  const lastLmsRef = useRef(null);

  const [fps, setFps] = useState(0);
  const fpsFramesRef = useRef(0);
  const fpsLastReportRef = useRef(performance.now());

  const [error, setError] = useState("");

  const poseRef = useRef(null);
  const cameraRef = useRef(null);
  const initializedRef = useRef(false); // StrictMode 중복 마운트 가드

  useEffect(() => {
    if (!enable) return;
    if (initializedRef.current) return; // 🔒 중복 init 방지
    initializedRef.current = true;

    // 브라우저/SDK 가드
    if (typeof window === "undefined") {
      setError("window가 없습니다(SSR 환경).");
      return;
    }
    if (!window.Pose || !window.Camera) {
      setError("Mediapipe Pose 스크립트가 로드되지 않았습니다.");
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) {
      setError("video 엘리먼트를 찾을 수 없습니다.");
      return;
    }

    // Pose 인스턴스
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
    poseRef.current = pose;

    // FPS 계산(250ms 단위로만 setState)
    let lastFrameTs = performance.now();
    pose.onResults((res) => {
      const now = performance.now();
      const dt = now - lastFrameTs;
      lastFrameTs = now;

      fpsFramesRef.current += 1;
      if (now - fpsLastReportRef.current >= 250) {
        const fpsEst = Math.round((fpsFramesRef.current * 1000) / (now - fpsLastReportRef.current));
        setFps(fpsEst);
        fpsFramesRef.current = 0;
        fpsLastReportRef.current = now;
      }

      const lms = res?.poseLandmarks ?? null;

      // landmarks가 이전과 실질적으로 동일하면 setState 생략 → 렌더 폭주 방지
      if (!sameLandmarks(lms, lastLmsRef.current)) {
        lastLmsRef.current = lms;
        setLandmarks(lms);
      }

      // ⚠️ 여기서는 캔버스에 비디오/관절을 그리지 않음.
      // 실제 드로잉은 페이지(MeasureSitup.jsx)에서 처리해 오버라이프/리렌더 분리.
    });

    // Camera
    const camera = new window.Camera(videoEl, {
      onFrame: async () => {
        try {
          await pose.send({ image: videoEl });
        } catch (e) {
          // send 중 에러가 나도 루프 끊기지 않도록
          // console.debug("pose.send error", e);
        }
      },
      width: 1280,
      height: 720,
    });
    cameraRef.current = camera;

    // 비디오 속성
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.autoplay = true;

    camera
      .start()
      .catch((e) => {
        console.error(e);
        setError("카메라 시작 실패: HTTPS/권한/브라우저를 확인하세요.");
      });

    return () => {
      // 정리
      try { cameraRef.current?.stop(); } catch {}
      try { poseRef.current?.close(); } catch {}
      cameraRef.current = null;
      poseRef.current = null;
      initializedRef.current = false;
    };
  }, [enable]);

  return { videoRef, canvasRef, landmarks, fps, error };
}
