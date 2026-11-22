import { useEffect, useRef } from 'react';
import { FiCheck } from 'react-icons/fi';
import PricingMergeResolver, {
  type ResolverPurpose,
  type ResolverView,
} from '../../../core/components/pricing-merge-resolver';
import FullWindowLayer from '../../../core/components/pricing-merge-resolver/full-window';
import type { MergeResolver } from '../../../core/hooks/useMergeResolver';
import type { PullRequestVersionRef } from '../../types/pull-requests';

/**
 * Where the conflicts of a merge or an update are resolved, and its result
 * reviewed: the resolver over the whole window. Done (or Escape) goes back to
 * the merge box with the choices made, where the merge or update is confirmed.
 */
export default function ResolverWorkspace({
  title,
  subtitle,
  resolver,
  loadLatestYaml,
  purpose,
  initialView,
  onDone,
}: {
  title: string;
  subtitle: string;
  resolver: MergeResolver;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  purpose: ResolverPurpose;
  initialView?: ResolverView;
  onDone: () => void;
}) {
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => done.current?.focus(), []);

  return (
    <FullWindowLayer label={title} onClose={onDone}>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-tp-hairline pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-tp-ink">{title}</h2>
            <p className="break-words text-xs text-tp-steel">{subtitle}</p>
          </div>
          <button
            ref={done}
            type="button"
            onClick={onDone}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
          >
            <FiCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Done
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <PricingMergeResolver
            resolver={resolver}
            loadLatestYaml={loadLatestYaml}
            purpose={purpose}
            initialView={initialView}
            fill
            expandable={false}
          />
        </div>
      </div>
    </FullWindowLayer>
  );
}
