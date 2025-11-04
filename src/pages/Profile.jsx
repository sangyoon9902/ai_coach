// src/pages/Profile.jsx
import { useApp } from "../state/AppState";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function Profile() {
  const nav = useNavigate();
  const { profile, setProfile } = useApp();

  // 입력값이 비어 있으면 초기값 세팅
  const [form, setForm] = useState({
    name: profile?.name ?? "",
    sex: profile?.sex ?? "M",
    age: profile?.age ?? "",
    height: profile?.height ?? "",
    weight: profile?.weight ?? "",
  });

  const update = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  function handleSave() {
    // 유효성 검사
    if (!form.name.trim()) return alert("이름을 입력해주세요.");
    if (!form.age || form.age <= 0) return alert("나이를 올바르게 입력해주세요.");
    if (!form.height || form.height <= 0) return alert("키(cm)를 올바르게 입력해주세요.");
    if (!form.weight || form.weight <= 0) return alert("몸무게(kg)를 올바르게 입력해주세요.");

    // 저장
    setProfile(form);
    nav("/select");
  }

  return (
    <div className="card" style={{ padding: "20px", color: "#fff", background: "#000", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0, color: "#9cf" }}>개인정보 입력</h2>

      <div
        className="grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 16,
          marginTop: 12,
        }}
      >
        <label>
          이름<br />
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="홍길동"
          />
        </label>

        <label>
          성별<br />
          <select value={form.sex} onChange={(e) => update("sex", e.target.value)}>
            <option value="M">남</option>
            <option value="F">여</option>
          </select>
        </label>

        <label>
          나이<br />
          <input
            type="number"
            value={form.age}
            onChange={(e) => update("age", Number(e.target.value))}
            placeholder="20"
          />
        </label>

        <label>
          키 (cm)<br />
          <input
            type="number"
            value={form.height}
            onChange={(e) => update("height", Number(e.target.value))}
            placeholder="170"
          />
        </label>

        <label>
          몸무게 (kg)<br />
          <input
            type="number"
            value={form.weight}
            onChange={(e) => update("weight", Number(e.target.value))}
            placeholder="65"
          />
        </label>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button
          className="btn"
          style={{
            background: "#28a",
            color: "#fff",
            border: "none",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
          onClick={handleSave}
        >
          다음 → 종목 선택
        </button>
      </div>

      <p style={{ marginTop: 12, fontSize: "12px", color: "#ccc" }}>
        입력값은 브라우저 로컬 상태에만 저장됩니다.
      </p>
    </div>
  );
}
