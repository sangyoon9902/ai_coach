import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppProvider } from "./state/AppState";

import App from "./App";
import Start from "./pages/Start.jsx";
import Select from "./pages/Select.jsx";
import Profile from "./pages/Profile.jsx";
import Results from "./pages/Results.jsx";

import MeasureSitup from "./pages/MeasureSitUp.jsx";        // 파일명 대소문자 확인
import MeasureReach from "./pages/MeasureSitAndReach.jsx";
import MeasureStep from "./pages/MeasureStep.jsx";

import Survey1 from "./pages/survey1.jsx";
import Survey2 from "./pages/survey2.jsx";
import Survey3 from "./pages/survey3.jsx";
import Survey4 from "./pages/survey4.jsx";

import Review from "./pages/Review.jsx"; // ✅ 추가: 검수 페이지

// 라우터 정의
const router = createBrowserRouter([
  {
    path: "/",
    element: <App />, // useLocation(), Link, Outlet 전부 정상 작동
    children: [
      { index: true, element: <Start /> },
      { path: "select", element: <Select /> },
      { path: "profile", element: <Profile /> },
      { path: "results", element: <Results /> },

      // 측정 페이지들
      { path: "measure/situp", element: <MeasureSitup /> },
      { path: "measure/reach", element: <MeasureReach /> },
      { path: "measure/step", element: <MeasureStep /> },

      // 설문 페이지들
      { path: "survey1", element: <Survey1 /> },
      { path: "survey2", element: <Survey2 /> },
      { path: "survey3", element: <Survey3 /> },
      { path: "survey4", element: <Survey4 /> },

      // ✅ 검수 페이지
      { path: "review", element: <Review /> },
    ],
  },
]);

// ✅ StrictMode 제거 (useEffect 중복 실행 방지)
ReactDOM.createRoot(document.getElementById("root")).render(
  <AppProvider>
    <RouterProvider router={router} />
  </AppProvider>
);
