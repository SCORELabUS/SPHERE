import { useRouter } from '../../../core/hooks/useRouter';

interface Props {
  isPlayground?: boolean;
  onTogglePlayground?: () => void;
  onNewConversation?: () => void;
}

export default function HarveyHeader({ isPlayground, onTogglePlayground, onNewConversation }: Props) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center border-b border-tp-hairline-soft bg-tp-canvas px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="cursor-pointer text-xs font-semibold tracking-[0.22em] text-tp-steel transition-colors hover:text-tp-ink"
        >
          SPHERE
        </button>
        <span className="text-tp-hairline">/</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-tp-ink">H.A.R.V.E.Y.</span>
          <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tp-primary">
            AI
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {onTogglePlayground && (
          <button
            type="button"
            onClick={onTogglePlayground}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              isPlayground
                ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'border-tp-hairline-strong bg-tp-canvas text-tp-ink hover:bg-tp-surface'
            }`}
          >
            {isPlayground ? 'Playground On' : 'Playground Off'}
          </button>
        )}
        {onNewConversation && (
          <button
            type="button"
            onClick={onNewConversation}
            className="cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            New conversation
          </button>
        )}
      </div>
    </header>
  );
}
