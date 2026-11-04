import type { ServiceDependency, ServiceKind } from '../../../../api/serviceTreeApi';

const DEPENDENCY_LABELS: Record<string, { short: string; title: string }> = {
  FUNCTIONAL: { short: 'func', title: "Dependent on the provider's functionality" },
  ACCOUNT: { short: 'acct', title: 'Dependent on an account with the provider' },
};

// The badge gives way before the service's name does: it shrinks and cuts its text first.
const pill = 'min-w-8 max-w-[10rem] shrink-[4] truncate rounded-full px-2 py-0.5 font-sans text-[11px] font-semibold';

/** The short form of what a service depends on: "func", "acct" or the text the organization wrote. */
const dependencyShort = (dependency: ServiceDependency) => DEPENDENCY_LABELS[dependency]?.short ?? dependency;

/**
 * "Aut" for an autonomous service; "Dep", with what it depends on, for a dependent one;
 * any other kind with its own name; nothing for one not classified yet.
 */
export default function ServiceKindBadge({ kind, dependency }: { kind: ServiceKind | null; dependency: ServiceDependency | null }) {
  if (kind === 'AUTONOMOUS') {
    return (
      <span title="Autonomous service: it can be contracted on its own" className={`${pill} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>
        Aut
      </span>
    );
  }
  if (kind === 'DEPENDENT') {
    return (
      <span
        title={(dependency && DEPENDENCY_LABELS[dependency]?.title) ?? (dependency ? `Dependent: ${dependency}` : 'Dependent service: it needs another service of the provider')}
        className={`${pill} bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400`}
      >
        Dep{dependency ? ` · ${dependencyShort(dependency)}` : ''}
      </span>
    );
  }
  if (!kind) return null;
  return (
    <span
      title={`${kind}${dependency ? `, depends on: ${dependency}` : ''}`}
      className={`${pill} border border-tp-hairline-strong bg-tp-surface text-tp-slate`}
    >
      {kind}
      {dependency ? ` · ${dependencyShort(dependency)}` : ''}
    </span>
  );
}
