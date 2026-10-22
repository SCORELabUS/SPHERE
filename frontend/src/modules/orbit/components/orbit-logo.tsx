import { useId, useLayoutEffect, useRef, useState } from 'react';

interface Props {
  /** While true, the satellite sets off along the ring and keeps orbiting. */
  busy?: boolean;
  className?: string;
}

// Everything is drawn untilted and the whole mark is turned by this angle.
const TILT = -20;
// The ring is split at its two ends: the back half runs behind the planet,
// the front half in front of it, which is what gives the mark its depth.
const RING_BACK = 'M2 12 A10 2.8 0 0 1 22 12';
const RING_FRONT = 'M2 12 A10 2.8 0 0 0 22 12';
// The satellite rests at the right end of the ring; its orbit starts there,
// passing in front of the planet first, so setting off never jumps.
const ORBIT_PATH = 'M22 12 A10 2.8 0 1 1 2 12 A10 2.8 0 1 1 22 12';
const RING_WIDTH = 1.5;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * ORBIT's mark: a planet, a tilted ring and a satellite. When ORBIT is busy the
 * satellite goes into orbit: it pulls away slowly, gathers speed over the first
 * lap and then keeps circling the planet along the ring. Drawn in currentColor.
 */
export default function OrbitLogo({ busy = false, className = '' }: Props) {
  // useId returns ids with colons, which SMIL timing references cannot contain.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const launchRef = useRef<SVGAnimateMotionElement>(null);
  const [reducedMotion] = useState(prefersReducedMotion);
  const orbiting = busy && !reducedMotion;

  // Started by hand, so the first lap begins now from the resting point rather
  // than at whatever moment the page's animation clock happens to be.
  useLayoutEffect(() => {
    if (orbiting) launchRef.current?.beginElement();
  }, [orbiting]);

  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <defs>
        <path id={`${id}-orbit`} d={ORBIT_PATH} />
        {/* Cuts a thin gap into the planet where the front of the ring crosses it. */}
        <mask id={`${id}-gap`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          <path d={RING_FRONT} stroke="black" strokeWidth={RING_WIDTH + 1.6} strokeLinecap="round" />
        </mask>
      </defs>
      <g transform={`rotate(${TILT} 12 12)`}>
        <path d={RING_BACK} stroke="currentColor" strokeWidth={RING_WIDTH} strokeLinecap="round" opacity={0.55} />
        <circle cx="12" cy="12" r="5.2" fill="currentColor" mask={`url(#${id}-gap)`} />
        <path d={RING_FRONT} stroke="currentColor" strokeWidth={RING_WIDTH} strokeLinecap="round" />
        {orbiting ? (
          <circle r="1.75" fill="currentColor">
            {/* First lap: it gathers speed as it leaves the resting point. */}
            <animateMotion
              ref={launchRef}
              id={`${id}launch`}
              begin="indefinite"
              dur="1.2s"
              calcMode="spline"
              keyPoints="0;1"
              keyTimes="0;1"
              // Starts at rest and ends at the speed of the steady orbit (1.2s / 0.9s = 4/3 of the
              // average), so the hand-over to the next animation is seamless.
              keySplines="0.5 0 0.7 0.6"
              fill="freeze"
            >
              <mpath href={`#${id}-orbit`} />
            </animateMotion>
            {/* Then it keeps a steady orbit. */}
            <animateMotion begin={`${id}launch.end`} dur="0.9s" repeatCount="indefinite">
              <mpath href={`#${id}-orbit`} />
            </animateMotion>
          </circle>
        ) : (
          <circle cx="22" cy="12" r="1.75" fill="currentColor" />
        )}
      </g>
    </svg>
  );
}
