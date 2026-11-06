import type { ServiceDependency, ServiceKind } from '../../../../api/serviceTreeApi';
import { BADGE_SHAPE, BADGE_TONES } from './badgeTones';

const DEPENDENCY_LABELS: Record<string, { short: string; title: string }> = {
  FUNCTIONAL: { short: 'func', title: "Dependent on the provider's functionality" },
  ACCOUNT: { short: 'acct', title: 'Dependent on an account with the provider' },
};

// The badge gives way before the service's name does: it shrinks and cuts its text first.
const pill = `${BADGE_SHAPE} min-w-8 max-w-[10rem] shrink-[4] truncate`;

/** The short form of what a service depends on: "func", "acct" or the text the organization wrote. */
const dependencyShort = (dependency: ServiceDependency) =>
  DEPENDENCY_LABELS[dependency]?.short ?? dependency;

/**
 * "Aut" for an autonomous service; "Dep", with what it depends on, for a dependent one;
 * any other kind with its own name; nothing for one not classified yet.
 */
export default function ServiceKindBadge({
  kind,
  dependency,
}: {
  kind: ServiceKind | null;
  dependency: ServiceDependency | null;
}) {
  if (kind === 'AUTONOMOUS') {
    return (
      <span
        title="Autonomous service: it can be contracted on its own"
        className={`${pill} ${BADGE_TONES.emerald}`}
      >
        Aut
      </span>
    );
  }
  if (kind === 'DEPENDENT') {
    return (
      <span
        title={
          (dependency && DEPENDENCY_LABELS[dependency]?.title) ??
          (dependency
            ? `Dependent: ${dependency}`
            : 'Dependent service: it needs another service of the provider')
        }
        className={`${pill} ${BADGE_TONES.sky}`}
      >
        Dep{dependency ? ` · ${dependencyShort(dependency)}` : ''}
      </span>
    );
  }
  if (!kind) return null;
  return (
    <span
      title={`${kind}${dependency ? `, depends on: ${dependency}` : ''}`}
      className={`${pill} ${BADGE_TONES.neutral}`}
    >
      {kind}
      {dependency ? ` · ${dependencyShort(dependency)}` : ''}
    </span>
  );
}
