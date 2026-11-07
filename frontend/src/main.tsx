import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import LoadingView from "./modules/core/pages/loading";
import SkeletonThemeProvider from "./modules/core/components/skeleton-theme-provider";
import "react-loading-skeleton/dist/skeleton.css";
import "./styles/tailwind.css";
// After tailwind.css on purpose: cascade-layer order follows first appearance, and the
// renderer's layer has to register after Tailwind's so its rules outrank preflight.
// See the @layer statement at the top of styles/tailwind.css.
import "pricing-renderer/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <SkeletonThemeProvider>
          <Suspense fallback={<LoadingView />}>
            <App />
          </Suspense>
        </SkeletonThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>
);
