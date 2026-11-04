import type { ReactNode } from 'react';
import Iconify from '../../../../../core/components/iconify';
import RouterLink from '../../../../../core/components/router-link';
import type { ServiceNode } from '../../../../api/serviceTreeApi';
import ServiceKindBadge from './ServiceKindBadge';
import type { DetailTab, LinkedPricing } from './ServiceTreeNode';
import { ancestorsOf, attributeText, childrenOf } from './tree';

interface Props {
  orgName: string;
  nodes: ServiceNode[];
  node: ServiceNode | null;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onSelect: (id: string | null) => void;
  linkedPricing: (pricingId: string) => LinkedPricing | null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-tp-hairline py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-tp-steel">{label}</dt>
      <dd className="min-w-0 text-sm text-tp-ink">{children}</dd>
    </div>
  );
}

const linkClass = 'cursor-pointer text-tp-primary underline-offset-2 hover:underline';

function kindSentence(node: ServiceNode, parent: ServiceNode | undefined): string {
  const base = parent ? parent.name : 'another service';
  const needs =
    node.dependency === 'FUNCTIONAL'
      ? `its main function works on the objects of ${base}`
      : node.dependency === 'ACCOUNT'
        ? `it only needs the account or plan of ${base}`
        : node.dependency
          ? `it depends on: ${node.dependency}`
          : '';
  if (node.kind === 'AUTONOMOUS') return 'Autonomous: it has a purpose of its own and is contracted on its own.';
  if (node.kind === 'DEPENDENT') return needs ? `Dependent: ${needs}.` : `Dependent on ${base}.`;
  if (!node.kind) return needs ? `Not classified yet; ${needs}.` : 'Not classified yet.';
  return needs ? `${node.kind}: ${needs}.` : node.kind;
}

/** The organization's summary, shown while no service is picked. */
function Overview({ orgName, nodes, onSelect }: Pick<Props, 'orgName' | 'nodes' | 'onSelect'>) {
  const count = (test: (node: ServiceNode) => boolean) => nodes.filter(test).length;
  // Kinds the organization made up, each counted like the known ones.
  const otherKinds = [
    ...nodes
      .filter(node => node.kind && node.kind !== 'AUTONOMOUS' && node.kind !== 'DEPENDENT')
      .reduce((totals, node) => totals.set(node.kind!, (totals.get(node.kind!) ?? 0) + 1), new Map<string, number>()),
  ];
  const linked = new Set(nodes.flatMap(node => node.pricingIds)).size;
  const roots = childrenOf(nodes, null);

  return (
    <div className="grid gap-4">
      <h3 className="font-display text-xl text-tp-ink">{orgName}</h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-tp-steel">
        <span>
          <b className="text-tp-ink">{nodes.length}</b> services
        </span>
        <span>
          <b className="text-tp-ink">{count(n => n.kind === 'AUTONOMOUS')}</b> autonomous
        </span>
        <span>
          <b className="text-tp-ink">{count(n => n.kind === 'DEPENDENT')}</b> dependent
        </span>
        {otherKinds.map(([kind, total]) => (
          <span key={kind}>
            <b className="text-tp-ink">{total}</b> {kind}
          </span>
        ))}
        {count(n => !n.kind) > 0 && (
          <span>
            <b className="text-tp-ink">{count(n => !n.kind)}</b> not classified
          </span>
        )}
        <span>
          <b className="text-tp-ink">{linked}</b> linked pricings
        </span>
      </div>
      {roots.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roots.map(root => (
            <button
              key={root.id}
              type="button"
              onClick={() => onSelect(root.id)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-tp-hairline px-3 py-1 text-sm text-tp-ink transition-colors hover:border-tp-primary/40"
            >
              {root.name || 'Unnamed service'}
              <ServiceKindBadge kind={root.kind} dependency={root.dependency} />
            </button>
          ))}
        </div>
      )}
      <p className="text-sm text-tp-steel">Pick a service in the tree to see what it is and its pricings.</p>
    </div>
  );
}

/** The right side of the view mode: the organization, or the service picked in the tree. */
export default function ServiceDetail({ orgName, nodes, node, tab, onTab, onSelect, linkedPricing }: Props) {
  if (!node) return <Overview orgName={orgName} nodes={nodes} onSelect={onSelect} />;

  const ancestors = ancestorsOf(nodes, node.id);
  const parent = ancestors[ancestors.length - 1];
  const children = childrenOf(nodes, node.id);
  const visible = node.pricingIds.map(id => ({ id, pricing: linkedPricing(id) })).filter(entry => entry.pricing);
  const hidden = node.pricingIds.length - visible.length;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <nav aria-label="Path" className="flex flex-wrap items-center gap-x-1 text-xs text-tp-steel">
          <button type="button" onClick={() => onSelect(null)} className={linkClass}>
            {orgName}
          </button>
          {ancestors.map(ancestor => (
            <span key={ancestor.id} className="flex items-center gap-x-1">
              <span aria-hidden="true">›</span>
              <button type="button" onClick={() => onSelect(ancestor.id)} className={linkClass}>
                {ancestor.name || 'Unnamed service'}
              </button>
            </span>
          ))}
        </nav>
        <h3 className="flex flex-wrap items-center gap-2 font-display text-xl text-tp-ink">
          <span className="min-w-0 break-words">{node.name}</span>
          <ServiceKindBadge kind={node.kind} dependency={node.dependency} />
        </h3>
      </div>

      <div role="tablist" aria-label="Service" className="inline-flex justify-self-start overflow-hidden rounded-lg border border-tp-hairline">
        {(['details', 'pricings'] as DetailTab[]).map(option => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            onClick={() => onTab(option)}
            className={`flex cursor-pointer items-center gap-1.5 border-l border-tp-hairline px-3.5 py-1.5 text-xs font-medium transition-colors first:border-l-0 ${
              tab === option ? 'bg-tp-primary/10 text-tp-primary' : 'text-tp-steel hover:text-tp-ink'
            }`}
          >
            {option === 'details' ? 'Details' : 'Pricings'}
            {option === 'pricings' && <span className="font-mono text-[11px]">{node.pricingIds.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <dl>
          <Fact label="Description">{node.description || <span className="text-tp-steel">No description.</span>}</Fact>
          <Fact label="Type">{kindSentence(node, parent)}</Fact>
          <Fact label="Inside">
            {parent ? (
              <button type="button" onClick={() => onSelect(parent.id)} className={linkClass}>
                {parent.name}
              </button>
            ) : (
              'Top level'
            )}
          </Fact>
          {Object.entries(node.attributes).map(([key, value]) => (
            <Fact key={key} label={key}>
              <span className="break-words">{attributeText(value)}</span>
            </Fact>
          ))}
          <Fact label="Services inside">
            {children.length === 0 ? (
              <span className="text-tp-steel">None.</span>
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {children.map(child => (
                  <button key={child.id} type="button" onClick={() => onSelect(child.id)} className={linkClass}>
                    {child.name}
                  </button>
                ))}
              </span>
            )}
          </Fact>
        </dl>
      ) : node.pricingIds.length === 0 ? (
        <p className="text-sm text-tp-steel">No pricings are linked to this service.</p>
      ) : (
        <ul className="divide-y divide-tp-hairline rounded-xl border border-tp-hairline">
          {visible.map(({ id, pricing }) => (
            <li key={id} className="flex items-center gap-2 px-3 py-2">
              <Iconify icon="mdi:tag-outline" width={15} className="shrink-0 text-tp-steel" />
              <RouterLink
                href={pricing!.href}
                className="min-w-0 cursor-pointer truncate text-sm text-tp-ink underline-offset-2 hover:text-tp-primary hover:underline"
              >
                {pricing!.name}
              </RouterLink>
              {pricing!.version && <span className="shrink-0 font-mono text-[11px] text-tp-steel">{pricing!.version}</span>}
              {pricing!.private && <Iconify icon="mdi:lock-outline" width={13} className="shrink-0 text-tp-steel" aria-label="Private" />}
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-3 py-2 text-xs text-tp-steel">
              {hidden === 1 ? '1 pricing you cannot see' : `${hidden} pricings you cannot see`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
