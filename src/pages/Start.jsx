import { useNavigate } from "react-router-dom";

export default function Start() {
  const nav = useNavigate();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      background: 'linear-gradient(180deg, #e8f0ff 0%, #ffffff 100%)',
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '2.8rem', fontWeight: 900, color: '#002b6b', marginBottom: '1rem' }}>
        국민체력 100 간편측정
      </h1>

      <img
        src="/character.png" // ✅ public 폴더에 넣은 이미지 사용 (fb8b9350-11ba-46e9-b11c-a8767b3af781.png → character.png로 저장)
        alt="캐릭터"
        style={{ width: 180, height: 'auto', marginBottom: '1.5rem' }}
      />

      <button
        onClick={() => nav('/survey1')}
        style={{
          background: '#002b6b',
          color: 'white',
          fontWeight: 700,
          fontSize: '1.25rem',
          border: 'none',
          padding: '14px 40px',
          borderRadius: '12px',
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
          transition: 'transform 0.2s ease, background 0.3s ease'
        }}
        onMouseOver={(e) => (e.target.style.background = '#0048b4')}
        onMouseOut={(e) => (e.target.style.background = '#002b6b')}
      >
        간편측정 시작하기
      </button>

      <p style={{ marginTop: '1rem', color: '#666', fontSize: '0.9rem' }}>
        AI 피트니스 코칭 기반 국민체력 100 간이 측정 서비스
      </p>
    </div>
  );
}
