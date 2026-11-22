import { useEffect, useState } from 'react';
import type { Pricing } from 'pricing4ts';
import { FiAlertTriangle, FiCheck, FiCode } from 'react-icons/fi';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import type { MergeResolver } from '../../hooks/useMergeResolver';
import { parsePricingForRender, withVariables } from '../../utils/pricing-render';
import { ConflictCard } from './conflict-list';

type Rendered = { text: string; pricing?: Pricing; error?: string };

/**
 * The result drawn as the pricing's Overview draws it (`PricingRenderer`),
 * read-only. Its conflicts are listed above it: picking one shows its values
 * and its two choices, and the drawing follows every choice. The variables
 * simulator only changes what is drawn, never the result.
 */
export default function VisualResult({
  resolver,
  currentLabel,
  onShowYaml,
}: {
  resolver: MergeResolver;
  currentLabel: string;
  onShowYaml: () => void;
}) {
  const { state, resultYaml } = resolver;
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const text = variables ? withVariables(resultYaml, variables) : resultYaml;
  // The last drawing is kept while the next one is read, so a choice does not blank the view.
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const firstOpen = state.conflicts.find(conflict => !state.choices[conflict.id]);
  const [selectedId, setSelectedId] = useState<string | null>(firstOpen?.id ?? null);
  const selected = state.conflicts.find(conflict => conflict.id === selectedId);

  useEffect(() => {
    let active = true;
    parsePricingForRender(text)
      .then(pricing => {
        if (active) setRendered({ text, pricing });
      })
      .catch((caught: unknown) => {
        if (active) setRendered({ text, error: caught instanceof Error ? caught.message : String(caught) });
      });
    return () => {
      active = false;
    };
  }, [text]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-tp-steel">
        The result as the pricing&apos;s Overview shows it, read-only.
        {state.conflicts.length > 0 && ' Pick a conflict to choose a side: the pricing below follows your choices.'}
      </p>

      {state.conflicts.length > 0 && (
        <div className="space-y-3">
          <ul aria-label="Conflicts" className="flex flex-wrap gap-1.5">
            {state.conflicts.map(conflict => {
              const resolved = Boolean(state.choices[conflict.id]);
              const isSelected = conflict.id === selectedId;
              return (
                <li key={conflict.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${conflict.label}: ${resolved ? 'resolved' : 'unresolved'}`}
                    onClick={() => {
                      setSelectedId(isSelected ? null : conflict.id);
                      resolver.focus(conflict.id);
                    }}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-tp-ink transition-colors ${
                      resolved
                        ? 'border-tp-severity-success-border bg-tp-severity-success-bg hover:border-tp-severity-success'
                        : 'border-tp-severity-warning-border bg-tp-severity-warning-bg hover:border-tp-severity-warning'
                    } ${isSelected ? 'ring-2 ring-tp-primary/50' : ''}`}
                  >
                    {resolved ? (
                      <FiCheck aria-hidden="true" className="h-3 w-3 text-tp-severity-success" />
                    ) : (
                      <FiAlertTriangle aria-hidden="true" className="h-3 w-3 text-tp-severity-warning" />
                    )}
                    <span className="break-all font-mono">{conflict.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <ConflictCard conflict={selected} resolver={resolver} currentLabel={currentLabel} />}
        </div>
      )}

      <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-4">
        {rendered?.pricing ? (
          <div aria-busy={rendered.text !== text}>
            <PricingRenderer pricing={rendered.pricing} errors={[]} onApplyVariables={setVariables} />
          </div>
        ) : rendered?.error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-tp-ink">
            <p>The result cannot be drawn: {rendered.error}</p>
            <button
              type="button"
              onClick={onShowYaml}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
            >
              <FiCode aria-hidden="true" className="h-3.5 w-3.5" />
              See its YAML
            </button>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
