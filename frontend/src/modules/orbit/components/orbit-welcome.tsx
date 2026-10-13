import { MdAccountTree, MdAttachFile, MdGroupAdd, MdLink, MdSearch } from 'react-icons/md';
import OrbitAvatar from './orbit-avatar';

const SUGGESTIONS = [
  {
    icon: MdAccountTree,
    label: 'Create an organization tree',
    prompt: 'Create an organization called ACME with three sub-organizations: Sales, Marketing and IT.',
  },
  {
    icon: MdSearch,
    label: 'Review my organizations',
    prompt: 'Which organizations do I belong to, and what is my role in each one?',
  },
  {
    icon: MdGroupAdd,
    label: 'Add members in bulk',
    prompt: 'I want to add several people to one of my organizations. Which ones can I manage?',
  },
  {
    icon: MdLink,
    label: 'Create an invitation link',
    prompt: 'Create an invitation link for one of my organizations that expires in 7 days.',
  },
];

interface Props {
  onPick: (prompt: string) => void;
  onImport: () => void;
  disabled: boolean;
  /** The widget has less room: one column and a shorter introduction. */
  compact?: boolean;
}

export default function OrbitWelcome({ onPick, onImport, disabled, compact = false }: Props) {
  return (
    <div className={`mx-auto flex max-w-2xl flex-col items-center text-center ${compact ? 'py-2' : 'py-6'}`}>
      <OrbitAvatar size={compact ? 'md' : 'lg'} />
      <h2 className={`mt-3 font-display text-tp-ink ${compact ? 'text-lg' : 'text-2xl'}`}>Hi, I'm ORBIT</h2>
      <p className="mt-1.5 max-w-[32rem] text-[13px] leading-relaxed text-tp-steel">
        {compact
          ? 'Tell me what you need in SPHERE. I prepare a plan and nothing changes until you confirm it.'
          : 'Tell me what you need in SPHERE and I will prepare a plan. Nothing changes until you review it and confirm it, and I can only do what you could do yourself.'}
      </p>

      <div className={`mt-5 grid w-full gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {SUGGESTIONS.map((suggestion, index) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => onPick(suggestion.prompt)}
            disabled={disabled}
            style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
            className="group flex cursor-pointer items-center gap-2.5 rounded-xl border border-tp-hairline bg-tp-surface px-3.5 py-2.5 text-left transition-all animate-slide-up hover:-translate-y-px hover:border-tp-primary/30 hover:bg-tp-cream/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-tp-cream text-tp-primary transition-colors group-hover:bg-tp-primary group-hover:text-tp-on-primary">
              <suggestion.icon size={16} />
            </span>
            <span className="text-[13px] font-medium text-tp-slate group-hover:text-tp-ink">{suggestion.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onImport}
          disabled={disabled}
          style={{ animationDelay: `${SUGGESTIONS.length * 50}ms`, animationFillMode: 'both' }}
          className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-tp-hairline-strong bg-tp-canvas px-3.5 py-2.5 text-left transition-all animate-slide-up hover:-translate-y-px hover:border-tp-primary/40 hover:bg-tp-cream/40 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? '' : 'sm:col-span-2'}`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-tp-cream text-tp-primary transition-colors group-hover:bg-tp-primary group-hover:text-tp-on-primary">
            <MdAttachFile size={16} />
          </span>
          <span className="text-left">
            <span className="block text-[13px] font-medium text-tp-slate group-hover:text-tp-ink">Import from a file</span>
            <span className="block text-[11px] text-tp-stone">
              A CSV, TSV or text file with your organizations and people, in whatever layout you have
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
