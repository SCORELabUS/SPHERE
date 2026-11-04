import type { ReactNode } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { ServiceNode } from '../../../../api/serviceTreeApi';
import ChannelTag from './ChannelTag';
import ServiceKindBadge from './ServiceKindBadge';
import { interfaceCounts } from './interfaces';
import { linkLabel } from './links';
import { rowButtonClass } from './rowStyles';
import { childrenOf, type TreeChanges } from './tree';

export interface LinkedPricing {
  name: string;
  version?: string;
  private: boolean;
  href: string;
  /** Plans and add-ons of the version linked, when known. */
  plans?: number | null;
  addOns?: number | null;
}

/** The tabs of a service's details, also opened from the rows below it in the tree. */
export type DetailTab = 'classification' | 'interfaces' | 'pricings' | 'links';

/** The row that stands for the organization itself. */
export const ROOT_TARGET = '__root__';

/** What every row of the read-only tree shares (edit mode uses ServiceOutline). */
export interface TreeContext {
  nodes: ServiceNode[];
  selected: string | null;
  /** The interface picked in the tree, by its place in the selected service's list. */
  selectedInterface: number | null;
  /** The link picked in the tree, by its place in the selected service's list. */
  selectedLink: number | null;
  /** `item` is the place of the interface or link picked, in the tab's list. */
  onSelect: (id: string | null, tab?: DetailTab, item?: number) => void;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  /** The groups (pricings, interfaces, links) unfolded under each service, as `<group>:<id>`. */
  openGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  linkedPricing: (pricingId: string) => LinkedPricing | null;
  /** While searching: the services that match, and those shown because something below them does. */
  matches: Set<string> | null;
  shown: Set<string> | null;
  /** Next to the JSON in edit mode, what differs from the saved tree, to mark it. */
  changes: TreeChanges | null;
}

export function Chevron({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink"
    >
      <Iconify
        icon="mdi:menu-right"
        width={18}
        className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      />
    </button>
  );
}

const Spacer = () => <span className="h-6 w-6 shrink-0" aria-hidden="true" />;

/** The branch below a row: the line on its left joins it to its parent. */
export function Branch({ children }: { children: ReactNode }) {
  return <div className="ml-3 border-l border-tp-hairline pl-1.5">{children}</div>;
}

const groupLabel = 'text-[13px] font-semibold text-tp-slate';
const groupCount = 'font-mono text-xs font-normal text-tp-steel';

/** "3 plans · 9 add-ons", when the pricing's analytics are known. */
function planSummary(plans?: number | null, addOns?: number | null): string | null {
  if (plans == null && addOns == null) return null;
  return [
    plans != null && `${plans} ${plans === 1 ? 'plan' : 'plans'}`,
    addOns != null && `${addOns} add-ons`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The pricing row of a service, as in Helena: "Pricing 3 plans · 9 add-ons" when it
 * links one pricing; "Pricings N", unfolding to each of them, when it links more.
 */
function PricingRow({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  const key = `pricings:${node.id}`;
  const open = ctx.openGroups.has(key);
  const visible = node.pricingIds
    .map(id => ({ id, pricing: ctx.linkedPricing(id) }))
    .filter(entry => entry.pricing);
  const hidden = node.pricingIds.length - visible.length;
  const single = node.pricingIds.length === 1 && visible.length === 1 ? visible[0].pricing! : null;

  if (single) {
    return (
      <div className="flex items-center">
        <Spacer />
        <button
          type="button"
          data-tree-row={node.id}
          onClick={() => ctx.onSelect(node.id, 'pricings')}
          className={rowButtonClass(false)}
        >
          <span className={groupLabel}>Pricing</span>
          <span className={`${groupCount} truncate`}>
            {planSummary(single.plans, single.addOns) ?? single.name}
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center">
        <Chevron
          open={open}
          onClick={() => ctx.onToggleGroup(key)}
          label={open ? 'Hide pricings' : 'Show pricings'}
        />
        <button
          type="button"
          data-tree-row={node.id}
          onClick={() => {
            if (!open) ctx.onToggleGroup(key);
            ctx.onSelect(node.id, 'pricings');
          }}
          className={rowButtonClass(false)}
        >
          <span className={groupLabel}>Pricings</span>
          <span className={groupCount}>{node.pricingIds.length}</span>
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
                {pricing!.private && (
                  <Iconify icon="mdi:lock-outline" width={12} className="shrink-0 text-tp-steel" />
                )}
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

/** "Interfaces 16 +8 pending", unfolding to each interface with its channel's tag. */
function InterfaceGroup({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  const key = `interfaces:${node.id}`;
  const open = ctx.openGroups.has(key);
  const { confirmed, pending } = interfaceCounts(node.interfaces);

  return (
    <>
      <div className="flex items-center">
        <Chevron
          open={open}
          onClick={() => ctx.onToggleGroup(key)}
          label={open ? 'Hide interfaces' : 'Show interfaces'}
        />
        <button
          type="button"
          data-tree-row={node.id}
          onClick={() => {
            if (!open) ctx.onToggleGroup(key);
            ctx.onSelect(node.id, 'interfaces');
          }}
          className={rowButtonClass(false)}
        >
          <span className={groupLabel}>Interfaces</span>
          <span className={groupCount}>
            {confirmed}
            {pending > 0 && ` +${pending} pending`}
          </span>
        </button>
      </div>
      {open && (
        <Branch>
          {node.interfaces.map((item, index) => {
            const on = ctx.selected === node.id && ctx.selectedInterface === index;
            return (
              <button
                key={index}
                type="button"
                data-tree-row={node.id}
                onClick={() => ctx.onSelect(node.id, 'interfaces', index)}
                title={item.pending ? `${item.name} (pending)` : item.name}
                className={`${rowButtonClass(on)} w-full text-[13px] ${item.pending ? 'italic !text-tp-steel' : ''}`}
              >
                <ChannelTag channel={item.channel} />
                <span className="min-w-0 break-words">{item.name}</span>
              </button>
            );
          })}
        </Branch>
      )}
    </>
  );
}

/** "Links 3", unfolding to each link; picking one shows it in the Links tab. */
function LinkGroup({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  const key = `links:${node.id}`;
  const open = ctx.openGroups.has(key);

  return (
    <>
      <div className="flex items-center">
        <Chevron
          open={open}
          onClick={() => ctx.onToggleGroup(key)}
          label={open ? 'Hide links' : 'Show links'}
        />
        <button
          type="button"
          data-tree-row={node.id}
          onClick={() => {
            if (!open) ctx.onToggleGroup(key);
            ctx.onSelect(node.id, 'links');
          }}
          className={rowButtonClass(false)}
        >
          <span className={groupLabel}>Links</span>
          <span className={groupCount}>{node.links.length}</span>
        </button>
      </div>
      {open && (
        <Branch>
          {node.links.map((link, index) => {
            const on = ctx.selected === node.id && ctx.selectedLink === index;
            return (
              <button
                key={index}
                type="button"
                data-tree-row={node.id}
                onClick={() => ctx.onSelect(node.id, 'links', index)}
                title={link.topic ? `${linkLabel(link)} (${link.topic})` : linkLabel(link)}
                className={`${rowButtonClass(on)} w-full text-[13px]`}
              >
                <Iconify icon="mdi:link-variant" width={14} className="shrink-0 text-tp-steel" />
                <span className="min-w-0 break-words">{linkLabel(link)}</span>
              </button>
            );
          })}
        </Branch>
      )}
    </>
  );
}

/** One service of the tree on the left: its pricing, interfaces and links, then the services inside it. */
export default function ServiceTreeNode({ node, ctx }: { node: ServiceNode; ctx: TreeContext }) {
  if (ctx.shown && !ctx.shown.has(node.id)) return null;
  const children = childrenOf(ctx.nodes, node.id);
  const hasContent =
    children.length > 0 ||
    node.pricingIds.length > 0 ||
    node.interfaces.length > 0 ||
    node.links.length > 0;
  // While searching everything that is shown is open, so the matches can be seen.
  const open = ctx.shown !== null || !ctx.collapsed.has(node.id);
  const on =
    ctx.selected === node.id && ctx.selectedInterface === null && ctx.selectedLink === null;
  const hit = ctx.matches?.has(node.id) ?? false;

  return (
    <div>
      <div className="flex items-center rounded-md">
        {hasContent ? (
          <Chevron
            open={open}
            onClick={() => ctx.onToggleCollapsed(node.id)}
            label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          />
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
            <span
              title="Added since the last save"
              className="shrink-0 rounded-full border border-emerald-300 px-1.5 text-[10px] font-semibold uppercase text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
            >
              New
            </span>
          ) : (
            ctx.changes?.changed.has(node.id) && (
              <span
                title="Changed since the last save"
                aria-label="Changed"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
              />
            )
          )}
        </button>
      </div>

      {hasContent && open && (
        <Branch>
          {node.pricingIds.length > 0 && <PricingRow node={node} ctx={ctx} />}
          {node.interfaces.length > 0 && <InterfaceGroup node={node} ctx={ctx} />}
          {node.links.length > 0 && <LinkGroup node={node} ctx={ctx} />}
          {children.map(child => (
            <ServiceTreeNode key={child.id} node={child} ctx={ctx} />
          ))}
        </Branch>
      )}
    </div>
  );
}
