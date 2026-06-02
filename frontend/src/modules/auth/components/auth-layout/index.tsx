import { motion } from "framer-motion";
import { ReactNode, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AnimatedSphereLogo from "../animated-logo";

const AUTH_RETURN_KEY = "auth_return_to";

const fadeContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

function BackButton() {
  const navigate = useNavigate();

  function handleBack() {
    const target = sessionStorage.getItem(AUTH_RETURN_KEY);
    navigate(target || "/");
    sessionStorage.removeItem(AUTH_RETURN_KEY);
  }

  return (
    <motion.button
      type="button"
      onClick={handleBack}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="absolute top-5 left-5 z-20 flex cursor-pointer items-center gap-2 rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-slate shadow-sm transition-all duration-200 hover:border-tp-hairline-strong hover:text-tp-ink sm:top-6 sm:left-6"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      <span className="hidden sm:inline">Back</span>
    </motion.button>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const prev = sessionStorage.getItem(AUTH_RETURN_KEY);

    if (!prev) {
      const referrer = document.referrer;
      const url = referrer ? new URL(referrer) : null;
      const sameOrigin = url && url.origin === window.location.origin;
      const path = sameOrigin ? url!.pathname : null;

      if (path && !path.startsWith("/authentication")) {
        sessionStorage.setItem(AUTH_RETURN_KEY, path);
      }
    }
  }, [location.key]);

  return (
    <div className="flex min-h-dvh w-full bg-tp-canvas">
      {/* ── Left panel: sunset gradient (50%) ── */}
      <div
        className="relative hidden w-1/2 overflow-hidden lg:block"
        style={{
          background:
            "linear-gradient(155deg, #ffa110 0%, #fa520f 35%, #cc3a05 65%, #1f1f1f 100%)",
        }}
      >
        {/* Ambient floating orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-tp-sunshine-500/15"
            animate={{ y: [0, 25, 0], scale: [1, 1.06, 1] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-tp-primary/10"
            animate={{ y: [0, -18, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
          />
          <motion.div
            className="absolute right-8 top-1/4 h-44 w-44 rounded-full bg-tp-yellow-saturated/15"
            animate={{ y: [0, 14, 0], x: [0, -10, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2.5 }}
          />
          <motion.div
            className="absolute bottom-1/3 left-1/3 h-28 w-28 rounded-full bg-tp-cream-deeper/20"
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col items-center justify-center p-10">
          <AnimatedSphereLogo />
        </div>

        {/* Bottom stripe */}
        <div className="absolute bottom-0 left-0 right-0">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 1.2, duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as const }}
            className="origin-left"
          >
            <div
              className="h-1.5 w-full"
              style={{
                background:
                  "linear-gradient(90deg, #fff8e0 0%, #ffd900 30%, #ffb83e 55%, #ffa110 75%, #fa520f 100%)",
              }}
            />
          </motion.div>
        </div>
      </div>

      {/* ── Right panel: form area (50%) ── */}
      <div className="relative flex w-full flex-1 flex-col lg:w-1/2">
        {/* Back button — always in the white zone */}
        <BackButton />

        {/* Mobile gradient header */}
        <div
          className="relative flex items-center justify-center px-6 pt-16 pb-8 sm:px-8 lg:hidden"
          style={{
            background:
              "linear-gradient(155deg, #ffa110 0%, #fa520f 35%, #cc3a05 65%, #1f1f1f 100%)",
          }}
        >
          <AnimatedSphereLogo className="scale-75" />
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:px-12">
          <motion.div
            variants={fadeContainer}
            initial="hidden"
            animate="show"
            className="w-full max-w-105"
          >
            {children}
          </motion.div>
        </div>

        {/* Mobile bottom stripe */}
        <div className="block lg:hidden">
          <div
            className="h-1.5 w-full"
            style={{
              background:
                "linear-gradient(90deg, #fa520f 0%, #ffa110 35%, #ffb83e 55%, #ffd900 75%, #fff8e0 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export { fadeUp };
