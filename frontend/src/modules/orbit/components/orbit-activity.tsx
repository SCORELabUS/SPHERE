import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MdCheck } from 'react-icons/md';
import OrbitAvatar from './orbit-avatar';
import type { OrbitActivity as Activity } from '../hooks/useOrbitChat';

interface Props {
  activity: Activity;
}

const VISIBLE_STEPS = 4;
const SHOW_TIMER_AFTER_MS = 2500;
const REASSURE_AFTER_MS = 12000;

function formatSeconds(ms: number) {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/**
 * What ORBIT is doing for the message being answered, live: each step as the
 * server reports it, a running clock so a long step never looks frozen, and the
 * answer itself as it is written. The clock runs on a timer rather than on
 * animation frames, so it keeps counting even when animations are paused.
 */
export default function OrbitActivity({ activity }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - activity.startedAt;
  const current = activity.steps[activity.steps.length - 1];
  const finished = activity.steps.slice(0, -1);
  const hidden = Math.max(0, finished.length - (VISIBLE_STEPS - 1));
  const writing = activity.draft.length > 0;

  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="flex max-w-[85%] gap-2.5">
        <OrbitAvatar busy />
        <div className="flex min-w-0 flex-col items-start">
          <span className="mb-1 text-[11px] font-medium text-tp-steel">ORBIT</span>

          {writing ? (
            <div className="rounded-2xl rounded-tl-md bg-tp-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-tp-ink">
              <div className="prose prose-sm max-w-none prose-p:mb-1 prose-p:leading-relaxed [&_p:last-child]:mb-0 [&_p:last-child]:inline">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.draft}</ReactMarkdown>
              </div>
              <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-orbit-caret bg-tp-primary align-baseline" />
            </div>
          ) : (
            <div className="relative min-w-[220px] overflow-hidden rounded-2xl rounded-tl-md border border-tp-hairline-soft bg-tp-surface px-3.5 py-2.5">
              <ul className="space-y-1">
                {hidden > 0 && (
                  <li className="text-[11px] text-tp-stone">
                    {hidden} earlier step{hidden === 1 ? '' : 's'}
                  </li>
                )}
                {finished.slice(hidden).map(step => (
                  <li key={`${step.label}-${step.startedAt}`} className="flex items-center gap-1.5 text-[12px] text-tp-stone animate-fade-in">
                    <MdCheck size={13} className="shrink-0 text-tp-severity-success" />
                    <span className="truncate">{step.label}</span>
                    {step.doneAt && step.doneAt - step.startedAt > 900 && (
                      <span className="ml-auto pl-2 tabular-nums text-[10px]">{formatSeconds(step.doneAt - step.startedAt)}</span>
                    )}
                  </li>
                ))}
                {current && (
                  <li key={`${current.label}-${current.startedAt}`} className="flex items-center gap-1.5 text-[12.5px] font-medium animate-slide-up">
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-tp-primary" />
                    <span className="animate-orbit-shimmer truncate">{current.label}…</span>
                    {elapsed > SHOW_TIMER_AFTER_MS && (
                      <span className="ml-auto pl-3 tabular-nums text-[11px] font-normal text-tp-stone">{formatSeconds(elapsed)}</span>
                    )}
                  </li>
                )}
              </ul>
              {elapsed > REASSURE_AFTER_MS && (
                <p className="mt-1.5 text-[11px] text-tp-stone animate-fade-in">
                  Still on it. Files and larger plans take a little longer.
                </p>
              )}
              <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-tp-hairline-soft">
                <span className="block h-full w-2/5 animate-orbit-indeterminate rounded-full bg-tp-primary/70" />
              </span>
            </div>
          )}

          {writing && current && (
            <span className="mt-1 text-[10px] text-tp-stone tabular-nums">Writing · {formatSeconds(elapsed)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
