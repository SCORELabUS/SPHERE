import type { ReactNode } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { ServiceNode } from '../../../../api/serviceTreeApi';
import ServiceKindBadge from './ServiceKindBadge';
import { rowButtonClass } from './rowStyles';
import { childrenOf, type TreeChanges } from './tree';

export interface LinkedPricing {
  name: string;
  version?: string;
  private: boolean;
  href: string;
}

export type DetailTab = 'details' | 'pricings';

/** The row that stands for the organization itself. */
export const ROOT_TARGET = '__root__';

/** What every row of the read-only tree shares (edit mode uses ServiceOutline). */
export interface TreeContext {
  nodes: ServiceNode[];
  selected: string | null;
  onSelect: (id: string | null, tab?: DetailTab) => void;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  openPricings: Set<string>;
  onTogglePricings: (id: string) => void;
  linkedPricing: (pricingId: string) => LinkedPricing | null;
  /** While searching: the services that match, and those shown because something below them does. */
  matches: Set<string> | null;
  shown: Set<string> | null;
  /** Next to the JSON in edit mode, what differs from the saved tree, to mark it. */
  changes: TreeChanges | null;
}

export function Chevron({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink"
    >
      <Iconify icon="mdi:menu-right" width={18} className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

const Spacer = () => <span className="h-6 w-6 shrink-0" aria-hidden="true" />;

/** The branch below a row: the line on its left joins it to its parent. */
export function Branch({ children }: { children: ReactNode }) {
  return <div className="ml-3 border-l border-tp-hairline pl-1.5">{children}</div>;
}

function PricingGroup({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  const open = ctx.openPricings.has(node.id);
  const visible = node.pricingIds.map(id => ({ id, pricing: ctx.linkedPricing(id) })).filter(entry => entry.pricing);
  const hidden = node.pricingIds.length - visible.length;

  return (
    <>
      <div className="flex items-center">
        <Chevron open={open} onClick={() => ctx.onTogglePricings(node.id)} label={open ? 'Hide pricings' : 'Show pricings'} />
        <button
          type="button"
          data-tree-row={node.id}
          onClick={() => {
            if (!open) ctx.onTogglePricings(node.id);
            ctx.onSelect(node.id, 'pricings');
          }}
          className={`${rowButtonClass(false)} text-[13px] font-medium !text-tp-steel`}
        >
          Pricings
          <span className="font-mono text-xs text-tp-stone">{node.pricingIds.length}</span>
        </button>
      </div>
      {open && (
        <Branch>
          {visible.map(({ id, pricing }) => (
            <div key={id} className="flex items-center">
              <Spacer />
              <button
                type="button"
                data-tree-row={node.id}
                onClick={() => ctx.onSelect(node.id, 'pricings')}
                title={pricing!.name}
                className={`${rowButtonClass(false)} text-[13px]`}
              >
                <Iconify icon="mdi:tag-outline" width={14} className="shrink-0 text-tp-steel" />
                <span className="truncate">{pricing!.name}</span>
                {pricing!.private && <Iconify icon="mdi:lock-outline" width={12} className="shrink-0 text-tp-steel" />}
              </button>
            </div>
          ))}
          {hidden > 0 && (
            <div className="flex items-center">
              <Spacer />
              <span className="px-2 py-1 text-xs italic text-tp-steel">{hidden} restricted</span>
            </div>
          )}
        </Branch>
      )}
    </>
  );
}

/** One service of the tree on the left, with its pricings and the services inside it. */
export default function ServiceTreeNode({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  if (ctx.shown && !ctx.shown.has(node.id)) return null;
  const children = childrenOf(ctx.nodes, node.id);
  const hasContent = children.length > 0 || node.pricingIds.length > 0;
  // While searching everything that is shown is open, so the matches can be seen.
  const open = ctx.shown !== null || !ctx.collapsed.has(node.id);
  const on = ctx.selected === node.id;
  const hit = ctx.matches?.has(node.id) ?? false;

  return (
    <div>
      <div className="flex items-center rounded-md">
        {hasContent ? (
          <Chevron open={open} onClick={() => ctx.onToggleCollapsed(node.id)} label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} />
        ) : (
          <Spacer />
        )}
        <button
          type="button"
          data-tree-row={node.id}
          aria-current={on}
          onClick={() => ctx.onSelect(node.id)}
          className={`${rowButtonClass(on)} text-sm`}
        >
          <span
            className={`min-w-[4.5rem] truncate ${node.name.trim() ? '' : 'italic text-tp-stone'} ${hit ? 'underline decoration-tp-primary underline-offset-4' : ''}`}
          >
            {node.name.trim() || 'Unnamed service'}
          </span>
          <ServiceKindBadge kind={node.kind} dependency={node.dependency} />
          {ctx.changes?.added.has(node.id) ? (
            <span title="Added since the last save" className="shrink-0 rounded-full border border-emerald-300 px-1.5 text-[10px] font-semibold uppercase text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
              New
            </span>
          ) : (
            ctx.changes?.changed.has(node.id) && (
              <span title="Changed since the last save" aria-label="Changed" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            )
          )}
        </button>
      </div>

      {hasContent && open && (
        <Branch>
          {node.pricingIds.length > 0 && <PricingGroup node={node} ctx={ctx} />}
          {children.map(child => (
            <ServiceTreeNode key={child.id} node={child} ctx={ctx} />
          ))}
        </Branch>
      )}
    </div>
  );
}
