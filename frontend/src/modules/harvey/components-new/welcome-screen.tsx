import type { PromptPreset } from '../types/types';

interface Props {
  presets: PromptPreset[];
  onSelect: (preset: PromptPreset) => void;
}

export default function WelcomeScreen({ presets, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-tp-cream">
          <span className="text-3xl">💬</span>
        </div>
        <h2 className="font-display text-3xl font-normal text-tp-ink">
          H.A.R.V.E.Y.
        </h2>
        <p className="mt-2 max-w-112 text-sm text-tp-steel">
          Holistic Agent for Reasoning on Value and Economic analYsis. Ask about optimal
          subscriptions and pricing insights.
        </p>
      </div>

      {presets.length > 0 && (
        <div className="grid w-full max-w-160 gap-3 sm:grid-cols-2">
          {presets.map((preset, i) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset)}
              className="animate-[fadeSlideIn_0.15s_ease-out_both] group cursor-pointer rounded-xl border border-tp-hairline bg-tp-canvas p-4 text-left transition-all hover:border-tp-primary/30 hover:shadow-elevation-2"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <p className="text-sm font-medium text-tp-ink group-hover:text-tp-primary">
                {preset.label}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-tp-steel">
                {preset.description}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
