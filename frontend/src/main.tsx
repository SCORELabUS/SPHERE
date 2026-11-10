import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { AuthConfigProvider } from "./modules/auth/contexts/authConfig";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import LoadingView from "./modules/core/pages/loading";
import SkeletonThemeProvider from "./modules/core/components/skeleton-theme-provider";
import "react-loading-skeleton/dist/skeleton.css";
import "./styles/tailwind.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <SkeletonThemeProvider>
          <Suspense fallback={<LoadingView />}>
            <AuthConfigProvider><App /></AuthConfigProvider>
          </Suspense>
        </SkeletonThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>
);
