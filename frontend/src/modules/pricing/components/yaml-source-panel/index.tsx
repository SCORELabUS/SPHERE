import { useState } from 'react';

interface YamlSourcePanelProps {
  yamlText: string;
}

export default function YamlSourcePanel({ yamlText }: YamlSourcePanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="flex w-full cursor-pointer items-center justify-between"
      >
        <h3 className="text-xs font-medium text-tp-ink">YAML source</h3>
        <svg
          className={`h-4 w-4 shrink-0 text-tp-steel transition-transform md:hidden ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div className={`${expanded ? 'block' : 'hidden'} mt-3 md:block`}>
        <pre className="max-h-125 overflow-auto rounded-lg bg-tp-surface-code p-3 text-[11px] leading-relaxed text-tp-on-dark">{yamlText}</pre>
      </div>
    </div>
  );
}
