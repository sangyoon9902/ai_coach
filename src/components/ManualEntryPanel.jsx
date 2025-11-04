// src/components/ManualEntryPanel.jsx
import { useState } from "react";
import { useApp } from "../state/AppState";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function ManualEntryPanel() {
  const { profile, setProfile, session, setSession, markSessionReady } = useApp();

  // 초기값은 현재 컨텍스트에서 가져와서 폼에 프리필
  const [form, setForm] = useState({
    name: profile?.name ?? "",
    sex: profile?.sex ?? "M",
    age: profile?.age ?? "",
    height_cm: profile?.height ?? "",
    weight_kg: profile?.weight ?? "",

    situp_reps: session?.situp?.reps ?? "",
    reach_cm: session?.reach?.bestCm ?? "",
    step_recovery_bpm: session?.step?.recoveryAvg ?? "",
    step_vo2max: session?.step?.vo2max ?? "",
  });

  const onChange = (k) => (e) => {
    const v = e?.target?.value ?? e;
    setForm((s) => ({ ...s, [k]: v }));
  };

  function applyToContext() {
    // 1) 프로필 저장
    setProfile((p) => ({
      ...p,
      name: form.name,
      sex: form.sex,
      age: toNum(form.age) ?? p.age ?? 0,
      height: toNum(form.height_cm) ?? p.height ?? 0,
      weight: toNum(form.weight_kg) ?? p.weight ?? 0,
    }));

    // 2) 측정치 저장
    setSession((s) => ({
      ...s,
      situp: {
        ...(s.situp ?? {}),
        reps: toNum(form.situp_reps) ?? 0,
      },
      reach: {
        ...(s.reach ?? {}),
        bestCm: toNum(form.reach_cm) ?? 0,
      },
      step: {
        ...(s.step ?? {}),
        recoveryAvg: toNum(form.step_recovery_bpm),
        vo2max: toNum(form.step_vo2max),
      },
    }));
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>수동 입력 (프로필 · 측정값)</h3>

      <div style={styles.grid}>
        {/* 프로필 */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>프로필</div>
          <label style={styles.row}>
            <span style={styles.lbl}>이름</span>
            <input style={styles.input} value={form.name} onChange={onChange("name")} />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>성별</span>
            <select style={styles.input} value={form.sex} onChange={onChange("sex")}>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>나이</span>
            <input
              style={styles.input}
              type="number"
              value={form.age}
              onChange={onChange("age")}
              placeholder="예: 25"
            />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>키(cm)</span>
            <input
              style={styles.input}
              type="number"
              step="0.1"
              value={form.height_cm}
              onChange={onChange("height_cm")}
              placeholder="예: 170.1"
            />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>체중(kg)</span>
            <input
              style={styles.input}
              type="number"
              step="0.1"
              value={form.weight_kg}
              onChange={onChange("weight_kg")}
              placeholder="예: 65.0"
            />
          </label>
        </div>

        {/* 측정값 */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>측정값</div>

          <label style={styles.row}>
            <span style={styles.lbl}>윗몸일으키기(회)</span>
            <input
              style={styles.input}
              type="number"
              value={form.situp_reps}
              onChange={onChange("situp_reps")}
              placeholder="예: 30"
            />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>좌전굴(cm)</span>
            <input
              style={styles.input}
              type="number"
              step="0.1"
              value={form.reach_cm}
              onChange={onChange("reach_cm")}
              placeholder="예: 6.9"
            />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>스텝 회복기 BPM</span>
            <input
              style={styles.input}
              type="number"
              value={form.step_recovery_bpm}
              onChange={onChange("step_recovery_bpm")}
              placeholder="예: 96"
            />
          </label>

          <label style={styles.row}>
            <span style={styles.lbl}>추정 VO₂max</span>
            <input
              style={styles.input}
              type="number"
              step="0.1"
              value={form.step_vo2max}
              onChange={onChange("step_vo2max")}
              placeholder="예: 36.5"
            />
          </label>
        </div>
      </div>

      <div style={styles.actions}>
        <button style={styles.secondaryBtn} onClick={applyToContext}>
          값 적용
        </button>

        <button
          style={styles.primaryBtn}
          onClick={() => {
            applyToContext();
            markSessionReady(); // 전송 준비 완료 → Results에서 버튼 활성화
          }}
        >
          모든 입력 완료(전송 준비)
        </button>
      </div>

      {session?.readyToSend ? (
        <div style={styles.readyMsg}>✅ 전송 준비 완료 — 이제 “운동처방 받기” 버튼을 눌러주세요.</div>
      ) : (
        <div style={styles.hint}>입력 후 “모든 입력 완료(전송 준비)”를 누르면 Results에서 전송 버튼이 켜집니다.</div>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "#fafafa",
    border: "1px solid rgba(0,0,0,0.06)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  title: { margin: "0 0 12px", fontSize: 16, fontWeight: 700 },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  section: {
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.05)",
    borderRadius: 10,
    padding: 12,
  },
  sectionTitle: { fontWeight: 600, marginBottom: 8, fontSize: 14 },
  row: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  lbl: { width: 140, fontSize: 13, color: "#333" },
  input: {
    flex: 1,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
  },
  actions: { display: "flex", gap: 10, marginTop: 12 },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #0b5cab",
    background: "#0b5cab",
    color: "#fff",
    fontWeight: 700,
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #aaa",
    background: "#fff",
    color: "#111",
    fontWeight: 600,
  },
  readyMsg: { marginTop: 10, color: "#0b5cab", fontSize: 13 },
  hint: { marginTop: 10, color: "#666", fontSize: 13 },
};
