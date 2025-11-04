import { Outlet, Link, useLocation } from 'react-router-dom'

export default function App() {
  const loc = useLocation()
  console.log("✅ App render, pathname =", loc.pathname)

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: '64px 1fr',
      minHeight: '100vh',
      backgroundColor: '#000',
      color: '#fff',
      fontFamily: 'system-ui,sans-serif'
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid #1a2550',
        backgroundColor: '#0a0a16',
        height: '64px'
      }}>
        <strong>🏋️ AI Fitness</strong>
        <nav style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: '13px',
          lineHeight: 1.3
        }}>
          {/* 메인 네비게이션 */}
          <NavBtn to="/">시작</NavBtn>
          <NavBtn to="/profile">개인정보</NavBtn>
          <NavBtn to="/select">종목선택</NavBtn>
          <NavBtn to="/measure/situp">윗몸</NavBtn>
          <NavBtn to="/measure/reach">좌전굴</NavBtn>
          <NavBtn to="/measure/step">스텝</NavBtn>
          <NavBtn to="/results">결과</NavBtn>
          <NavBtn to="/gesture-test">제스처테스트</NavBtn>

          {/* 설문 네비게이션 추가 */}
          <NavBtn to="/survey1">설문1</NavBtn>
          <NavBtn to="/survey2">설문2</NavBtn>
          <NavBtn to="/survey3">설문3</NavBtn>
          <NavBtn to="/survey4">설문4</NavBtn>
        </nav>
      </header>

      <main style={{ padding: 16 }}>
        <Outlet key={loc.key} />
      </main>
    </div>
  )
}

/* 공통 버튼 스타일 */
function NavBtn({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        background: '#1a1a2a',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '6px 10px',
        color: '#fff',
        textDecoration: 'none',
        fontWeight: 500,
        fontSize: '13px',
        lineHeight: 1.3,
      }}
    >
      {children}
    </Link>
  )
}
