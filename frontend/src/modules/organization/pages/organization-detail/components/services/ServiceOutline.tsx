import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Iconify from '../../../../../core/components/iconify';
import RouterLink from '../../../../../core/components/router-link';
import type { OrgPricing } from '../../../../api/organizationsApi';
import type { ServiceNode } from '../../../../api/serviceTreeApi';
import { KindPicker, PricingPicker, ServiceDetailsForm } from './ServiceNodePanels';
import type { LinkedPricing } from './ServiceTreeNode';
import {
  ancestorsOf,
  canDrop,
  childrenOf,
  parentOptions,
  type DropPosition,
  type TreeChanges,
} from './tree';
import { useDismiss } from './useDismiss';

/** The changes the outline makes; adding returns the new service's id. */
export interface OutlineActions {
  add: (parentId: string | null, afterId?: string) => string;
  update: (id: string, changes: Partial<ServiceNode>, field: string) => void;
  /** Moves a service before, after or inside another one, or to the top level when `targetId` is null. */
  moveTo: (id: string, targetId: string | null, position: DropPosition) => void;
  move: (id: string, direction: -1 | 1) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  remove: (id: string) => void;
  togglePricing: (id: string, pricingId: string) => void;
}

interface Props {
  orgName: string;
  nodes: ServiceNode[];
  changes: TreeChanges | null;
  linkedPricing: (pricingId: string) => LinkedPricing | null;
  orgPricings: OrgPricing[] | null;
  orgPricingsError: string | null;
  actions: OutlineActions;
  /** A service whose name should get the focus (one just added or moved), handled once. */
  focusId: string | null;
  onFocused: () => void;
}

type Panel = { id: string; kind: 'details' | 'pricings' } | null;
type Drag = { id: string; over: string | null; position: DropPosition } | null;
const TOP = '__top__';

interface OutlineContext extends Props {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  drag: Drag;
  setDrag: (drag: Drag) => void;
  onNameKeyDown: (event: KeyboardEvent<HTMLInputElement>, node: ServiceNode) => void;
}

const iconButton =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink';

const nameInputs = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLInputElement>('input[data-name-input]') ?? []);

/** Where a drop on a row would land, from how far down the row the pointer is. */
function dropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = (event.clientY - rect.top) / rect.height;
  return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside';
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-tp-severity-error hover:bg-tp-severity-error-bg'
          : 'text-tp-ink hover:bg-tp-surface'
      }`}
    >
      <Iconify icon={icon} width={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** The "..." menu of a row: everything a row can do, with the keys that do it too. */
function RowMenu({ node, ctx }: { node: ServiceNode; ctx: OutlineContext }) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setMoving(false);
  }, []);
  useDismiss(ref, open, close);
  const siblings = childrenOf(ctx.nodes, node.parentId);
  const position = siblings.findIndex(sibling => sibling.id === node.id);
  const parent = node.parentId ? ctx.nodes.find(n => n.id === node.parentId) : undefined;
  const run = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-label={`More for ${node.name || 'the service'}`}
        aria-expanded={open}
        className={iconButton}
      >
        <Iconify icon="mdi:dots-horizontal" width={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-tp-hairline bg-tp-canvas p-1 shadow-elevation-2"
        >
          {moving ? (
            <>
              <p className="px-2.5 py-1.5 text-xs font-medium text-tp-slate">
                Move “{node.name || 'Unnamed'}” inside…
              </p>
              <div className="max-h-60 overflow-y-auto">
                {parentOptions(ctx.nodes, node.id).map(option => (
                  <MenuItem
                    key={option.id ?? 'top'}
                    icon={option.id ? 'mdi:subdirectory-arrow-right' : 'mdi:file-tree-outline'}
                    disabled={option.id === node.parentId}
                    onClick={run(() =>
                      option.id
                        ? ctx.actions.moveTo(node.id, option.id, 'inside')
                        : ctx.actions.moveTo(node.id, null, 'inside')
                    )}
                  >
                    <span className="whitespace-pre">
                      {option.id ? option.label : `${ctx.orgName} (top level)`}
                    </span>
                  </MenuItem>
                ))}
              </div>
            </>
          ) : (
            <>
              <MenuItem
                icon="mdi:plus"
                onClick={run(() => ctx.actions.add(node.parentId, node.id))}
              >
                Add a service below <kbd className="float-right text-tp-stone">Enter</kbd>
              </MenuItem>
              <MenuItem
                icon="mdi:subdirectory-arrow-right"
                onClick={run(() => ctx.actions.add(node.id))}
              >
                Add a service inside
              </MenuItem>
              <div className="my-1 border-t border-tp-hairline" />
              <MenuItem
                icon="mdi:arrow-up"
                disabled={position <= 0}
                onClick={run(() => ctx.actions.move(node.id, -1))}
              >
                Move up <kbd className="float-right text-tp-stone">Alt ↑</kbd>
              </MenuItem>
              <MenuItem
                icon="mdi:arrow-down"
                disabled={position >= siblings.length - 1}
                onClick={run(() => ctx.actions.move(node.id, 1))}
              >
                Move down <kbd className="float-right text-tp-stone">Alt ↓</kbd>
              </MenuItem>
              <MenuItem
                icon="mdi:format-indent-increase"
                disabled={position <= 0}
                onClick={run(() => ctx.actions.indent(node.id))}
              >
                Put inside “{siblings[position - 1]?.name || 'the one above'}”{' '}
                <kbd className="float-right text-tp-stone">Tab</kbd>
              </MenuItem>
              <MenuItem
                icon="mdi:format-indent-decrease"
                disabled={!parent}
                onClick={run(() => ctx.actions.outdent(node.id))}
              >
                Take out of “{parent?.name || 'its parent'}”{' '}
                <kbd className="float-right text-tp-stone">⇧ Tab</kbd>
              </MenuItem>
              <MenuItem icon="mdi:file-tree-outline" onClick={() => setMoving(true)}>
                Move to…
              </MenuItem>
              <div className="my-1 border-t border-tp-hairline" />
              <MenuItem
                icon="mdi:trash-can-outline"
                danger
                onClick={run(() => ctx.actions.remove(node.id))}
              >
                Delete
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The panel under a row: its details, or the pricings linked to it. */
function RowPanel({
  node,
  kind,
  ctx,
}: {
  node: ServiceNode;
  kind: 'details' | 'pricings';
  ctx: OutlineContext;
}) {
  const visible = node.pricingIds
    .map(id => ({ id, pricing: ctx.linkedPricing(id) }))
    .filter(entry => entry.pricing);
  const hidden = node.pricingIds.length - visible.length;

  return (
    <div className="my-1 ml-2 mr-1 grid gap-3 sm:ml-14 rounded-xl border border-tp-hairline bg-tp-surface p-3">
      <div className="flex items-center gap-1">
        {(['details', 'pricings'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => ctx.setPanel({ id: node.id, kind: option })}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              kind === option
                ? 'bg-tp-canvas text-tp-ink shadow-elevation-1'
                : 'text-tp-steel hover:text-tp-ink'
            }`}
          >
            {option === 'details' ? 'Details' : `Pricings ${node.pricingIds.length}`}
          </button>
        ))}
        <button
          type="button"
          onClick={() => ctx.setPanel(null)}
          aria-label="Close"
          className={`${iconButton} ml-auto`}
        >
          <Iconify icon="mdi:close" width={16} />
        </button>
      </div>

      {kind === 'details' ? (
        <ServiceDetailsForm
          node={node}
          nodes={ctx.nodes}
          onChange={(changes, field) => ctx.actions.update(node.id, changes, field)}
          onMove={parentId => ctx.actions.moveTo(node.id, parentId, 'inside')}
        />
      ) : (
        <div className="grid gap-2">
          {visible.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visible.map(({ id, pricing }) => (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded-full border border-tp-hairline bg-tp-canvas py-0.5 pl-2.5 pr-1 text-xs text-tp-ink"
                >
                  <RouterLink
                    href={pricing!.href}
                    className="cursor-pointer hover:text-tp-primary hover:underline"
                  >
                    {pricing!.name}
                  </RouterLink>
                  {pricing!.private && (
                    <Iconify icon="mdi:lock-outline" width={12} className="text-tp-steel" />
                  )}
                  <button
                    type="button"
                    onClick={() => ctx.actions.togglePricing(node.id, id)}
                    aria-label={`Unlink ${pricing!.name}`}
                    className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-tp-steel hover:bg-tp-severity-error-bg hover:text-tp-severity-error"
                  >
                    <Iconify icon="mdi:close" width={12} />
                  </button>
                </span>
              ))}
              {hidden > 0 && (
                <span className="self-center text-xs text-tp-steel">+{hidden} you cannot see</span>
              )}
            </div>
          )}
          <PricingPicker
            node={node}
            pricings={ctx.orgPricings}
            error={ctx.orgPricingsError}
            onToggle={pricingId => ctx.actions.togglePricing(node.id, pricingId)}
          />
        </div>
      )}
    </div>
  );
}

function OutlineRow({ node, ctx }: { node: ServiceNode; ctx: OutlineContext }) {
  const children = childrenOf(ctx.nodes, node.id);
  const open = !ctx.collapsed.has(node.id);
  const drag = ctx.drag;
  const over = drag?.over === node.id ? drag.position : null;
  const panel = ctx.panel?.id === node.id ? ctx.panel.kind : null;
  const added = ctx.changes?.added.has(node.id);
  const changed = ctx.changes?.changed.has(node.id);
  const rowRef = useRef<HTMLDivElement>(null);
  const togglePanel = (kind: 'details' | 'pricings') =>
    ctx.setPanel(panel === kind ? null : { id: node.id, kind });
  const dropLabel =
    over === 'inside'
      ? `Inside ${node.name || 'it'}`
      : over === 'before'
        ? `Before ${node.name || 'it'}`
        : `After ${node.name || 'it'}`;

  return (
    <div className={drag?.id === node.id ? 'opacity-40' : ''}>
      <div
        ref={rowRef}
        onDragOver={event => {
          if (!drag || !canDrop(ctx.nodes, drag.id, node.id)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const position = dropPosition(event);
          if (drag.over !== node.id || drag.position !== position)
            ctx.setDrag({ ...drag, over: node.id, position });
        }}
        onDragLeave={() => drag?.over === node.id && ctx.setDrag({ ...drag, over: null })}
        onDrop={event => {
          event.preventDefault();
          if (drag?.over === node.id) ctx.actions.moveTo(drag.id, node.id, drag.position);
          ctx.setDrag(null);
        }}
        className={`group relative flex flex-wrap items-center gap-1 rounded-lg sm:flex-nowrap py-0.5 pl-0.5 pr-1 transition-colors hover:bg-tp-surface focus-within:bg-tp-surface ${
          over === 'inside' ? 'bg-tp-primary/5 ring-2 ring-tp-primary/50' : ''
        }`}
      >
        {over && over !== 'inside' && (
          <span
            className={`pointer-events-none absolute left-8 right-0 h-0.5 rounded bg-tp-primary ${over === 'before' ? '-top-px' : '-bottom-px'}`}
          />
        )}
        {over && (
          <span className="pointer-events-none absolute -top-2.5 right-2 z-10 rounded-full bg-tp-primary px-2 py-0.5 text-[10px] font-semibold text-tp-on-primary">
            {dropLabel}
          </span>
        )}

        <span
          draggable
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', node.name);
            if (rowRef.current) event.dataTransfer.setDragImage(rowRef.current, 16, 16);
            ctx.setPanel(null);
            ctx.setDrag({ id: node.id, over: null, position: 'inside' });
          }}
          onDragEnd={() => ctx.setDrag(null)}
          title="Drag to move"
          className="hidden h-7 w-5 shrink-0 cursor-grab items-center justify-center text-tp-stone opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100 sm:flex"
        >
          <Iconify icon="mdi:drag-vertical" width={16} />
        </span>

        {children.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => ctx.toggle(node.id)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-tp-steel hover:bg-tp-hairline-soft hover:text-tp-ink"
          >
            <Iconify
              icon="mdi:menu-right"
              width={18}
              className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-tp-hairline-strong" />
          </span>
        )}

        <input
          data-name-input={node.id}
          value={node.name}
          maxLength={120}
          placeholder="Name the service"
          aria-label="Service name"
          aria-invalid={!node.name.trim()}
          onChange={event => ctx.actions.update(node.id, { name: event.target.value }, 'name')}
          onKeyDown={event => ctx.onNameKeyDown(event, node)}
          className={`min-w-[6rem] flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm text-tp-ink outline-none placeholder:text-tp-stone focus:bg-tp-canvas focus:ring-1 ${
            node.name.trim() ? 'focus:ring-tp-primary/40' : 'ring-1 ring-tp-severity-error/60'
          }`}
        />

        {/* On a phone the controls go on a second line under the name. */}
        <div className="flex w-full items-center justify-end gap-1 pl-7 sm:w-auto sm:pl-0">
          {added ? (
            <span
              title="Added since the last save"
              className="shrink-0 rounded-full border border-emerald-300 px-1.5 text-[10px] font-semibold uppercase text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
            >
              New
            </span>
          ) : (
            changed && (
              <span
                title="Changed since the last save"
                aria-label="Changed"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
              />
            )
          )}

          <KindPicker
            node={node}
            nodes={ctx.nodes}
            onChange={changes => ctx.actions.update(node.id, changes, 'kind')}
          />

          <button
            type="button"
            onClick={() => togglePanel('pricings')}
            title="Pricings of the service"
            aria-pressed={panel === 'pricings'}
            className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-tp-hairline-soft ${
              panel === 'pricings'
                ? 'text-tp-primary'
                : node.pricingIds.length
                  ? 'text-tp-slate'
                  : 'text-tp-stone'
            }`}
          >
            <Iconify icon="mdi:tag-outline" width={14} />
            {node.pricingIds.length}
          </button>
          <button
            type="button"
            onClick={() => togglePanel('details')}
            aria-label="Details"
            title="Description, where it hangs and other fields"
            aria-pressed={panel === 'details'}
            className={`${iconButton} ${panel === 'details' ? '!text-tp-primary' : ''}`}
          >
            <Iconify icon="mdi:pencil-outline" width={15} />
          </button>
          <button
            type="button"
            onClick={() => ctx.actions.add(node.id)}
            aria-label={`Add a service inside ${node.name || 'this one'}`}
            title="Add a service inside"
            className={`${iconButton} sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`}
          >
            <Iconify icon="mdi:subdirectory-arrow-right" width={16} />
          </button>
          <RowMenu node={node} ctx={ctx} />
        </div>
      </div>

      {panel && <RowPanel node={node} kind={panel} ctx={ctx} />}

      {children.length > 0 && open && (
        <div className="ml-[1.1rem] border-l border-tp-hairline pl-1.5 sm:ml-[2.35rem]">
          {children.map(child => (
            <OutlineRow key={child.id} node={child} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The tree in edit mode, as an outline: each service is a row whose name is
 * typed in place, with its type, pricings and details a click away. Services
 * nest with Tab and Shift+Tab, the buttons of each row, its menu or by dragging.
 */
export default function ServiceOutline(props: Props) {
  const { nodes, changes, actions, focusId, onFocused } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const roots = childrenOf(nodes, null);

  // The service asked for gets the focus once its row is shown, opening what hides it.
  useEffect(() => {
    if (!focusId) return;
    const hidden = ancestorsOf(nodes, focusId).filter(ancestor => collapsed.has(ancestor.id));
    if (hidden.length) {
      setCollapsed(
        current => new Set([...current].filter(id => !hidden.some(ancestor => ancestor.id === id)))
      );
      return;
    }
    const input = rootRef.current?.querySelector<HTMLInputElement>(
      `input[data-name-input="${focusId}"]`
    );
    if (!input) return;
    input.focus();
    if (input.value === 'New service') input.select();
    onFocused();
  }, [focusId, nodes, collapsed, onFocused]);

  const toggle = useCallback((id: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /** Typing keys, as in a list: Enter adds, Tab nests, arrows move between rows. */
  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>, node: ServiceNode) => {
    const inputs = nameInputs(rootRef.current);
    const at = inputs.indexOf(event.currentTarget);
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.add(node.parentId, node.id);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) actions.outdent(node.id);
      else actions.indent(node.id);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      actions.move(node.id, event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      inputs[at + (event.key === 'ArrowUp' ? -1 : 1)]?.focus();
    } else if (
      event.key === 'Backspace' &&
      node.name === '' &&
      !childrenOf(nodes, node.id).length &&
      !node.pricingIds.length
    ) {
      // An empty row goes away like an empty line, and the cursor goes up.
      event.preventDefault();
      const previous = inputs[at - 1];
      actions.remove(node.id);
      previous?.focus();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  const ctx: OutlineContext = {
    ...props,
    collapsed,
    toggle,
    panel,
    setPanel,
    drag,
    setDrag,
    onNameKeyDown,
  };
  const removed = useMemo(() => changes?.removed ?? [], [changes]);

  return (
    <div ref={rootRef} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <span className="font-display text-lg text-tp-ink">{props.orgName}</span>
        <span className="font-mono text-xs text-tp-steel">{nodes.length} services</span>
        {nodes.length > 0 && (
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => setCollapsed(new Set())}
              className="cursor-pointer rounded-md px-2 py-1 text-xs text-tp-steel hover:bg-tp-surface hover:text-tp-ink"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(new Set(nodes.map(node => node.id)))}
              className="cursor-pointer rounded-md px-2 py-1 text-xs text-tp-steel hover:bg-tp-surface hover:text-tp-ink"
            >
              Collapse all
            </button>
          </span>
        )}
      </div>

      <div className="rounded-xl border border-tp-hairline p-1.5 sm:p-2">
        {roots.map(node => (
          <OutlineRow key={node.id} node={node} ctx={ctx} />
        ))}

        {drag ? (
          <div
            onDragOver={event => {
              event.preventDefault();
              if (drag.over !== TOP) setDrag({ ...drag, over: TOP });
            }}
            onDragLeave={() => drag.over === TOP && setDrag({ ...drag, over: null })}
            onDrop={event => {
              event.preventDefault();
              actions.moveTo(drag.id, null, 'inside');
              setDrag(null);
            }}
            className={`mt-1 rounded-lg border-2 border-dashed px-3 py-2.5 text-center text-xs transition-colors ${
              drag.over === TOP
                ? 'border-tp-primary bg-tp-primary/5 text-tp-primary'
                : 'border-tp-hairline text-tp-steel'
            }`}
          >
            Drop here to make it a top-level service
          </div>
        ) : (
          <button
            type="button"
            onClick={() => actions.add(null)}
            className="mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            <Iconify icon="mdi:plus" width={16} />
            {roots.length ? 'Add a service' : 'Add the first service'}
          </button>
        )}
      </div>

      {removed.length > 0 && (
        <p className="px-1 text-xs text-tp-steel">
          Removed since the last save:{' '}
          {removed.map((node, index) => (
            <span key={node.id}>
              {index > 0 && ', '}
              <span className="line-through">{node.name || 'Unnamed service'}</span>
            </span>
          ))}
          . Undo brings them back.
        </p>
      )}

      <p className="hidden px-1 text-xs leading-5 text-tp-steel sm:block">
        <b className="font-medium text-tp-slate">Enter</b> adds a service below ·{' '}
        <b className="font-medium text-tp-slate">Tab</b> puts it inside the one above ·{' '}
        <b className="font-medium text-tp-slate">Shift+Tab</b> takes it out ·{' '}
        <b className="font-medium text-tp-slate">Alt+↑↓</b> reorders · drag{' '}
        <Iconify icon="mdi:drag-vertical" width={13} className="inline align-[-2px]" /> to move it
        anywhere
      </p>
    </div>
  );
}
