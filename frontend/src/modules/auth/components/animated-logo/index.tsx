import { motion } from "framer-motion";

export default function AnimatedSphereLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-6 ${className}`}>
      <div className="relative h-40 w-40 sm:h-48 sm:w-48">
        <svg
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
        >
          <defs>
            <radialGradient id="backdrop-vignette" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
              <stop offset="70%" stopColor="#000000" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffa110" stopOpacity="1" />
              <stop offset="50%" stopColor="#fa520f" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#fa520f" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="core-inner" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#ffd06a" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#fa520f" stopOpacity="0.7" />
            </radialGradient>
            <filter id="blur-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          {/* Backdrop vignette */}
          <circle cx="100" cy="100" r="90" fill="url(#backdrop-vignette)" />

          {/* Outer glow */}
          <motion.circle
            cx="100"
            cy="100"
            r="60"
            fill="url(#core-glow)"
            filter="url(#blur-glow)"
            animate={{ r: [55, 62, 55], opacity: [0.6, 0.9, 0.6] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Orbital ring 1 — horizontal */}
          <motion.ellipse
            cx="100"
            cy="100"
            rx="70"
            ry="22"
            stroke="white"
            strokeWidth="1.2"
            strokeOpacity="0.45"
            fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px" }}
          />

          {/* Orbital ring 2 — 60deg tilt */}
          <motion.ellipse
            cx="100"
            cy="100"
            rx="70"
            ry="22"
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.35"
            fill="none"
            animate={{ rotate: -360 }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px", rotate: 60 }}
          />

          {/* Orbital ring 3 — 120deg tilt */}
          <motion.ellipse
            cx="100"
            cy="100"
            rx="70"
            ry="22"
            stroke="white"
            strokeWidth="0.8"
            strokeOpacity="0.28"
            fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px", rotate: 120 }}
          />

          {/* Core sphere */}
          <motion.circle
            cx="100"
            cy="100"
            r="16"
            fill="url(#core-inner)"
            animate={{ r: [15, 17, 15] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Inner highlight */}
          <circle cx="96" cy="96" r="5" fill="white" opacity="0.7" />

          {/* Traveling dot 1 */}
          <motion.g
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle cx="170" cy="100" r="4" fill="#ffd06a" opacity="1" />
            <circle cx="170" cy="100" r="8" fill="#ffd06a" opacity="0.35" filter="url(#blur-glow)" />
          </motion.g>

          {/* Traveling dot 2 */}
          <motion.g
            animate={{ rotate: -360 }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px", rotate: 60 }}
          >
            <circle cx="170" cy="100" r="3.5" fill="#ffb83e" opacity="0.9" />
            <circle cx="170" cy="100" r="7" fill="#ffb83e" opacity="0.3" filter="url(#blur-glow)" />
          </motion.g>

          {/* Traveling dot 3 */}
          <motion.g
            animate={{ rotate: 360 }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "100px 100px", rotate: 120 }}
          >
            <circle cx="170" cy="100" r="3" fill="#ffa110" opacity="0.8" />
            <circle cx="170" cy="100" r="6" fill="#ffa110" opacity="0.25" filter="url(#blur-glow)" />
          </motion.g>
        </svg>
      </div>

      {/* Wordmark */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="flex flex-col items-center gap-1"
      >
        <span className="font-display tracking-wide text-white text-5xl">
          SPHERE
        </span>
        <span className="text-sm font-lg text-center tracking-[0.25em] text-white/60 uppercase w-full">
          SaaS Pricing Holistic Evaluation and Regulation Environment
        </span>
      </motion.div>
    </div>
  );
}
