import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import ConfirmModal from '../../../../core/components/confirm-modal';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import BetaBadge from '../../../../beta/components/beta-badge';
import { Organization, OrgPricing, useOrganizationsApi } from '../../../api/organizationsApi';
import {
  ServiceNode,
  ServiceTreeConflictError,
  ServiceTreeView,
  useServiceTreeApi,
} from '../../../api/serviceTreeApi';
import ServiceTreeNode, {
  DetailTab,
  LinkedPricing,
  ROOT_TARGET,
  TreeContext,
} from './services/ServiceTreeNode';
import { rowButtonClass } from './services/rowStyles';
import ServiceDetail from './services/ServiceDetail';
import ServiceKindBadge from './services/ServiceKindBadge';
import ServiceJsonEditor from './services/ServiceJsonEditor';
import ServiceOutline, { OutlineActions } from './services/ServiceOutline';
import { parseTreeJson, treeToJson, type PricingResolver } from './services/treeJson';
import {
  addService,
  ancestorsOf,
  childrenOf,
  descendantIds,
  diffTrees,
  indentService,
  moveAmongSiblings,
  moveService,
  outdentService,
  removeService,
  reparentService,
  sameTree,
  togglePricing,
  updateService,
  type TreeChanges,
} from './services/tree';

type Mode = 'view' | 'edit';

/** How the tree is edited: as an outline, or as JSON text. */
type Shape = 'tree' | 'json';

type PendingConfirm = {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
} | null;

/** The draft being edited, with what undo and redo go back and forth through. */
interface Draft {
  nodes: ServiceNode[];
  past: ServiceNode[][];
  future: ServiceNode[][];
  /** The field the last change typed into: typing on in it does not add another undo step. */
  typing: string | null;
}

const HISTORY_LIMIT = 100;

const freshDraft = (nodes: ServiceNode[]): Draft => ({ nodes, past: [], future: [], typing: null });

/**
 * Whether undo should be left to the browser: in text fields, except the names
 * of the outline, whose typing is already in the tree's history.
 */
const keepsOwnUndo = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !target.hasAttribute('data-name-input') &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface Props {
  org: Organization;
  /** Tells the page whether there are unsaved changes, so leaving the tab can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The services an organization offers, as a tree with the pricings of each one
 * (beta). Everyone browses it in view mode: the tree on the left and the service
 * picked on the right. Owners and admins also get edit mode, where the tree is
 * edited as an outline or as JSON, with undo and redo, and saved in one go.
 */
export default function ServicesTab({ org, onDirtyChange }: Props) {
  const { getServiceTree, saveServiceTree } = useServiceTreeApi();
  const { getOrgPricings } = useOrganizationsApi();

  const [tree, setTree] = useState<ServiceTreeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Draft>(freshDraft([]));
  const [selected, setSelected] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('details');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openPricings, setOpenPricings] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [shape, setShape] = useState<Shape>('tree');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  // The nodes the JSON text was last written from or read into; other changes rewrite the text.
  const jsonSource = useRef<ServiceNode[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [orgPricings, setOrgPricings] = useState<OrgPricing[] | null>(null);
  const [orgPricingsError, setOrgPricingsError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getServiceTree(org.id);
      setTree(data);
      setDraft(freshDraft(data.nodes));
      return data;
    } catch (err) {
      setLoadError((err as Error).message);
      return null;
    }
  }, [getServiceTree, org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const editing = mode === 'edit' && tree?.canEdit === true;
  const nodes = useMemo(
    () => (editing ? draft.nodes : (tree?.nodes ?? [])),
    [editing, draft.nodes, tree]
  );
  const dirty = editing && tree !== null && !sameTree(draft.nodes, tree.nodes);
  const unnamed = draft.nodes.some(node => !node.name.trim());
  const selectedNode = nodes.find(node => node.id === selected) ?? null;
  // Kinds the organization made up, added to the legend.
  const customKinds = useMemo(
    () => [
      ...new Set(
        nodes
          .map(node => node.kind)
          .filter((kind): kind is string => !!kind && kind !== 'AUTONOMOUS' && kind !== 'DEPENDENT')
      ),
    ],
    [nodes]
  );
  const changes = useMemo(
    () => (editing && tree ? diffTrees(tree.nodes, draft.nodes) : null),
    [editing, tree, draft.nodes]
  );
  const changeCount = changes
    ? changes.added.size + changes.changed.size + changes.removed.length
    : 0;
  const jsonInvalid = editing && shape === 'json' && jsonErrors.length > 0;

  // The pricing picker lists the organization's pricings, loaded once edit mode is opened.
  useEffect(() => {
    if (!editing || orgPricings) return;
    getOrgPricings(org.id, { limit: '1000' })
      .then(data => setOrgPricings(data.pricings))
      .catch(err => setOrgPricingsError((err as Error).message));
  }, [editing, orgPricings, getOrgPricings, org.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const orgPricingsById = useMemo(
    () => new Map((orgPricings ?? []).filter(p => p.pricingId).map(p => [p.pricingId!, p])),
    [orgPricings]
  );

  const linkedPricing = useCallback(
    (pricingId: string): LinkedPricing | null => {
      const known = tree?.pricings[pricingId];
      const listed = orgPricingsById.get(pricingId);
      const source = known ?? listed;
      if (!source) return null;
      const collectionSlug = source.collection?.slug;
      const path = `/pricings/${org.id}/${source.slug}`;
      return {
        name: source.name,
        version: source.version,
        private: source.private,
        href: collectionSlug ? `${path}?collection=${encodeURIComponent(collectionSlug)}` : path,
      };
    },
    [tree, orgPricingsById, org.id]
  );

  // ─── JSON: pricings are written by slug when the slug names only one pricing ───
  const pricingRefs = useMemo(() => {
    const slugs = new Map<string, Set<string>>();
    const known = new Map<string, string>();
    const add = (pricingId: string, slug: string) => {
      known.set(pricingId, slug);
      slugs.set(slug, (slugs.get(slug) ?? new Set<string>()).add(pricingId));
    };
    Object.values(tree?.pricings ?? {}).forEach(pricing => add(pricing.pricingId, pricing.slug));
    orgPricingsById.forEach((pricing, pricingId) => add(pricingId, pricing.slug));
    return { slugs, known };
  }, [tree, orgPricingsById]);

  const pricingLabel = useCallback(
    (pricingId: string) => {
      const slug = pricingRefs.known.get(pricingId);
      return slug && pricingRefs.slugs.get(slug)?.size === 1 ? slug : pricingId;
    },
    [pricingRefs]
  );

  const resolvePricing: PricingResolver = useCallback(
    reference => {
      if (pricingRefs.known.has(reference)) return { pricingId: reference };
      const bySlug = pricingRefs.slugs.get(reference);
      if (bySlug?.size === 1) return { pricingId: [...bySlug][0] };
      if (bySlug)
        return {
          error: `"${reference}" names several pricings; use the pricingId of the one you mean`,
        };
      if (/^[0-9a-f]{24}$/i.test(reference)) return { pricingId: reference };
      return { error: `the organization has no pricing "${reference}"` };
    },
    [pricingRefs]
  );

  const pricingLabelRef = useRef(pricingLabel);
  useEffect(() => {
    pricingLabelRef.current = pricingLabel;
  }, [pricingLabel]);

  const showingJson = editing && shape === 'json';
  useEffect(() => {
    if (!showingJson || jsonSource.current === nodes) return;
    jsonSource.current = nodes;
    setJsonText(treeToJson(nodes, pricingLabelRef.current));
    setJsonErrors([]);
  }, [showingJson, nodes]);

  /** Forgets the JSON text, so it is written again from the tree. */
  const resetJson = () => {
    jsonSource.current = null;
    setJsonErrors([]);
  };

  // ─── Search (view mode): the matching services, and their ancestors so they can be reached ───
  const { matches, shown } = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return { matches: null, shown: null };
    const found = new Set(
      nodes
        .filter(node =>
          [node.name, node.description, node.kind, node.dependency].some(text =>
            text?.toLowerCase().includes(term)
          )
        )
        .map(node => node.id)
    );
    const visible = new Set(found);
    for (const id of found) ancestorsOf(nodes, id).forEach(ancestor => visible.add(ancestor.id));
    return { matches: found, shown: visible };
  }, [search, nodes]);

  // ─── Editing ───
  const edit = useCallback(
    (change: (current: ServiceNode[]) => ServiceNode[], typing: string | null = null) => {
      setDraft(current => {
        const next = change(current.nodes);
        if (next === current.nodes) return current;
        const sameField = typing !== null && typing === current.typing;
        return {
          nodes: next,
          past: sameField ? current.past : [...current.past, current.nodes].slice(-HISTORY_LIMIT),
          future: [],
          typing,
        };
      });
      setSavedAt(null);
    },
    []
  );

  const undo = useCallback(() => {
    setDraft(current =>
      current.past.length
        ? {
            nodes: current.past[current.past.length - 1],
            past: current.past.slice(0, -1),
            future: [current.nodes, ...current.future],
            typing: null,
          }
        : current
    );
  }, []);

  const redo = useCallback(() => {
    setDraft(current =>
      current.future.length
        ? {
            nodes: current.future[0],
            past: [...current.past, current.nodes],
            future: current.future.slice(1),
            typing: null,
          }
        : current
    );
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo and redo the tree; other text fields keep their own undo.
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || keepsOwnUndo(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, undo, redo]);

  const onJsonChange = (text: string) => {
    setJsonText(text);
    const result = parseTreeJson(text, resolvePricing);
    if ('errors' in result) return setJsonErrors(result.errors);
    setJsonErrors([]);
    if (sameTree(result.nodes, draft.nodes)) return;
    jsonSource.current = result.nodes;
    edit(() => result.nodes, 'json');
  };

  /** Goes to the outline or the JSON; JSON with errors is only left once confirmed. */
  const switchShape = (next: Shape, then?: () => void) => {
    const leave = () => {
      resetJson();
      setShape(next);
      then?.();
    };
    if (next === shape) return then?.();
    if (jsonInvalid) {
      setConfirm({
        message: 'The JSON has errors. Leave it and keep the tree as it was before them?',
        confirmLabel: 'Leave the JSON',
        danger: true,
        onConfirm: leave,
      });
      return;
    }
    leave();
  };

  const expand = useCallback((ids: string[]) => {
    setCollapsed(current => {
      if (!ids.some(id => current.has(id))) return current;
      const next = new Set(current);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, []);

  const select = useCallback(
    (id: string | null, tab?: DetailTab) => {
      setSelected(id);
      if (tab) setDetailTab(tab);
      if (id) expand(ancestorsOf(nodes, id).map(ancestor => ancestor.id));
    },
    [nodes, expand]
  );

  /** Picking from the tree on a phone takes the page to the details, which are below it. */
  const selectFromTree = (id: string | null, tab?: DetailTab) => {
    select(id, tab);
    if (window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    }
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'view' && dirty) {
      setConfirm({
        message: 'Discard the changes you have not saved?',
        confirmLabel: 'Discard',
        danger: true,
        onConfirm: () => {
          setDraft(freshDraft(tree?.nodes ?? []));
          resetJson();
          setMode('view');
          setSaveError(null);
        },
      });
      return;
    }
    if (next === 'edit') setDraft(freshDraft(tree?.nodes ?? []));
    resetJson();
    setSaveError(null);
    setMode(next);
  };

  const onFocused = useCallback(() => setFocusId(null), []);

  const handleDelete = (id: string) => {
    const node = draft.nodes.find(n => n.id === id);
    if (!node) return;
    const below = descendantIds(draft.nodes, id).size;
    const remove = () => edit(current => removeService(current, id));
    // A leaf without pricings goes at once (undo brings it back); anything else is confirmed first.
    if (below === 0 && node.pricingIds.length === 0) return remove();
    setConfirm({
      message:
        below > 0
          ? `Delete "${node.name}" and the ${below === 1 ? 'service' : `${below} services`} inside it? Their pricings stay in the organization, only the links go.`
          : `Delete "${node.name}"? Its pricings stay in the organization, only the links go.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: remove,
    });
  };

  // Every move keeps the focus on the service moved, so typing can go on.
  const outlineActions: OutlineActions = {
    add: (parentId, afterId) => {
      const { nodes: next, id } = addService(draft.nodes, parentId, afterId);
      edit(() => next);
      setFocusId(id);
      return id;
    },
    update: (id, changes, field) =>
      edit(
        current => updateService(current, id, changes),
        field === 'name' || field === 'description' ? `${id}:${field}` : null
      ),
    moveTo: (id, targetId, position) => {
      edit(current =>
        targetId ? moveService(current, id, targetId, position) : reparentService(current, id, null)
      );
      setFocusId(id);
    },
    move: (id, direction) => {
      edit(current => moveAmongSiblings(current, id, direction));
      setFocusId(id);
    },
    indent: id => {
      edit(current => indentService(current, id));
      setFocusId(id);
    },
    outdent: id => {
      edit(current => outdentService(current, id));
      setFocusId(id);
    },
    remove: handleDelete,
    togglePricing: (id, pricingId) => edit(current => togglePricing(current, id, pricingId)),
  };

  const handleSave = async () => {
    if (!tree) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveServiceTree(org.id, draft.nodes, tree.revision);
      setTree(saved);
      setDraft(freshDraft(saved.nodes));
      resetJson();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError({
        message: (err as Error).message,
        conflict: err instanceof ServiceTreeConflictError,
      });
    } finally {
      setSaving(false);
    }
  };

  const reloadAfterConflict = async () => {
    if (await load()) {
      setSaveError(null);
      resetJson();
    }
  };

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const togglePricings = useCallback((id: string) => {
    setOpenPricings(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /** Keys on the read-only tree: arrows move between rows, left and right fold a service. */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-tree-row]') ?? []
    );
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const focusedId = at >= 0 ? rows[at].dataset.treeRow : undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      rows[
        Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))
      ]?.focus();
    } else if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      focusedId &&
      focusedId !== ROOT_TARGET
    ) {
      event.preventDefault();
      if ((event.key === 'ArrowLeft') !== collapsed.has(focusedId)) toggleCollapsed(focusedId);
    }
  };

  const ctx: TreeContext = {
    nodes,
    selected: showingJson ? null : selected,
    // Next to the JSON, picking a service opens it in the outline.
    onSelect: showingJson ? id => id && switchShape('tree', () => setFocusId(id)) : selectFromTree,
    collapsed,
    onToggleCollapsed: toggleCollapsed,
    openPricings,
    onTogglePricings: togglePricings,
    linkedPricing,
    matches: showingJson ? null : matches,
    shown: showingJson ? null : shown,
    changes,
  };

  const roots = childrenOf(nodes, null);
  const smallButton =
    'cursor-pointer rounded-md px-2 py-1 text-xs text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink';

  const treePanel = (
    <div
      ref={treeRef}
      onKeyDown={onTreeKeyDown}
      aria-label="Services"
      className="max-h-[26rem] overflow-auto rounded-xl border border-tp-hairline p-2 md:max-h-[calc(100vh-17rem)]"
    >
      <div className="flex items-center rounded-md">
        <button
          type="button"
          data-tree-row={ROOT_TARGET}
          aria-current={!showingJson && selected === null}
          onClick={() => !showingJson && selectFromTree(null)}
          className={`${rowButtonClass(!showingJson && selected === null)} font-display text-base`}
        >
          <span className="truncate">{org.displayName}</span>
          <span className="font-mono text-xs text-tp-steel">{nodes.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className={smallButton}
          title="Expand all"
        >
          Expand
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(nodes.map(node => node.id)))}
          className={smallButton}
          title="Collapse all"
        >
          Collapse
        </button>
      </div>
      <div className="mt-0.5">
        {roots.map(node => (
          <ServiceTreeNode key={node.id} node={node} ctx={ctx} />
        ))}
        {shown?.size === 0 && (
          <p className="px-2 py-4 text-xs text-tp-steel">No service matches the search.</p>
        )}
        {roots.length === 0 && <p className="px-2 py-4 text-xs text-tp-steel">No services yet.</p>}
      </div>
    </div>
  );

  const startFirstService = () => {
    if (!tree) return;
    const { nodes: next, id } = addService(tree.nodes, null);
    setDraft({ ...freshDraft(tree.nodes), nodes: next, past: [tree.nodes] });
    resetJson();
    setShape('tree');
    setMode('edit');
    setFocusId(id);
  };

  return (
    <motion.div
      key="services"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg text-tp-ink">
              Services <BetaBadge />
            </h2>
            <p className="text-xs text-tp-steel">
              {editing
                ? 'Change the services as a list or as JSON. Nothing is saved until you press Save.'
                : 'What the organization offers, and the pricings of each service.'}
            </p>
          </div>

          {tree?.canEdit && (
            <div
              role="tablist"
              aria-label="Mode"
              className="flex shrink-0 gap-1 self-start rounded-lg border border-tp-hairline bg-tp-surface p-1 sm:self-auto"
            >
              {(['view', 'edit'] as Mode[]).map(option => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={mode === option}
                  onClick={() => switchMode(option)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === option
                      ? 'bg-tp-canvas text-tp-ink shadow-elevation-1'
                      : 'text-tp-steel hover:text-tp-ink'
                  }`}
                >
                  <Iconify
                    icon={option === 'view' ? 'mdi:eye-outline' : 'mdi:pencil-outline'}
                    width={14}
                  />
                  {option === 'view' ? 'View' : 'Edit'}
                </button>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <div className="sticky top-[7.25rem] z-20 flex flex-wrap items-center gap-2 border-b border-tp-hairline bg-tp-canvas/90 px-5 py-2.5 backdrop-blur md:top-[6.5rem]">
            <div
              role="tablist"
              aria-label="Edit as"
              className="inline-flex overflow-hidden rounded-lg border border-tp-hairline"
            >
              {(['tree', 'json'] as Shape[]).map(option => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={shape === option}
                  onClick={() => switchShape(option)}
                  className={`flex cursor-pointer items-center gap-1.5 border-l border-tp-hairline px-3 py-1.5 text-xs font-medium transition-colors first:border-l-0 ${
                    shape === option
                      ? 'bg-tp-primary/10 text-tp-primary'
                      : 'text-tp-steel hover:text-tp-ink'
                  }`}
                >
                  <Iconify
                    icon={option === 'tree' ? 'mdi:file-tree-outline' : 'mdi:code-braces'}
                    width={14}
                  />
                  {option === 'tree' ? 'Tree' : 'JSON'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={undo}
                disabled={!draft.past.length}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Iconify icon="mdi:undo" width={17} />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!draft.future.length}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Iconify icon="mdi:redo" width={17} />
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-tp-steel" aria-live="polite">
                {!dirty
                  ? savedAt
                    ? 'Saved'
                    : 'No changes'
                  : changeCount
                    ? changeSummary(changes!)
                    : 'Reordered'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraft(freshDraft(tree?.nodes ?? []));
                  resetJson();
                }}
                disabled={!dirty || saving}
                className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving || unnamed || jsonInvalid}
                title={
                  jsonInvalid
                    ? 'Fix the JSON first'
                    : unnamed
                      ? 'Every service needs a name'
                      : undefined
                }
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-1.5 text-xs font-medium text-tp-on-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving && <Iconify icon="mdi:loading" width={14} className="animate-spin" />}
                Save
              </button>
            </div>
            {saveError && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-tp-severity-error/30 bg-tp-severity-error-bg px-3 py-2 text-xs text-tp-severity-error">
                <span className="min-w-0 flex-1">{saveError.message}</span>
                {saveError.conflict && (
                  <button
                    type="button"
                    onClick={reloadAfterConflict}
                    className="cursor-pointer rounded-md border border-tp-severity-error/40 px-2 py-1 font-medium hover:bg-tp-canvas"
                  >
                    Reload and drop my changes
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="px-3 py-4 sm:px-5">
          {loadError ? (
            <div className="flex flex-col items-start gap-2 px-2 py-6 text-sm text-tp-severity-error">
              {loadError}
              <button
                type="button"
                onClick={load}
                className="cursor-pointer text-xs font-medium text-tp-primary hover:underline"
              >
                Try again
              </button>
            </div>
          ) : !tree ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-tp-steel">
              <Iconify icon="mdi:loading" width={16} className="animate-spin" /> Loading services...
            </div>
          ) : editing ? (
            shape === 'tree' ? (
              <ServiceOutline
                orgName={org.displayName}
                nodes={draft.nodes}
                changes={changes}
                linkedPricing={linkedPricing}
                orgPricings={orgPricings}
                orgPricingsError={orgPricingsError}
                actions={outlineActions}
                focusId={focusId}
                onFocused={onFocused}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)] md:items-start">
                <ServiceJsonEditor
                  text={jsonText}
                  errors={jsonErrors}
                  readOnly={false}
                  onChange={onJsonChange}
                />
                <div className="grid gap-1.5">
                  <p className="px-1 text-xs text-tp-steel">
                    The tree as the JSON leaves it. Pick a service to edit it in the tree.
                  </p>
                  {treePanel}
                </div>
              </div>
            )
          ) : roots.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Iconify icon="mdi:file-tree-outline" width={32} className="text-tp-stone" />
              <p className="text-sm font-medium text-tp-ink">No services yet</p>
              <p className="max-w-[24rem] text-xs text-tp-steel">
                {tree.canEdit
                  ? 'Describe what the organization offers as a tree of services, and link each one to its pricings.'
                  : 'The owners and admins of the organization have not described its services yet.'}
              </p>
              {tree.canEdit && (
                <button
                  type="button"
                  onClick={startFirstService}
                  className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-xs font-medium text-tp-on-primary"
                >
                  <Iconify icon="mdi:plus" width={15} />
                  Add the first service
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tp-steel">
                  <span className="flex items-center gap-1.5">
                    <ServiceKindBadge kind="AUTONOMOUS" dependency={null} /> autonomous
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ServiceKindBadge kind="DEPENDENT" dependency="FUNCTIONAL" /> works on another
                    service's objects
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ServiceKindBadge kind="DEPENDENT" dependency="ACCOUNT" /> only needs its
                    account
                  </span>
                  {customKinds.map(kind => (
                    <ServiceKindBadge key={kind} kind={kind} dependency={null} />
                  ))}
                </div>
                <div className="relative w-full sm:ml-auto sm:w-64">
                  <Iconify
                    icon="mdi:magnify"
                    width={16}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tp-steel"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search services..."
                    aria-label="Search services"
                    className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg py-1.5 pl-8 pr-3 text-sm text-tp-ink transition-colors focus:border-tp-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] md:items-start">
                {treePanel}
                <div
                  ref={detailRef}
                  className="min-w-0 scroll-mt-40 rounded-xl border border-tp-hairline p-4 sm:p-5"
                >
                  <ServiceDetail
                    orgName={org.displayName}
                    nodes={nodes}
                    node={selectedNode}
                    tab={detailTab}
                    onTab={setDetailTab}
                    onSelect={select}
                    linkedPricing={linkedPricing}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {confirm && (
          <ConfirmModal
            message={confirm.message}
            confirmLabel={confirm.confirmLabel}
            danger={confirm.danger}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              confirm.onConfirm();
              setConfirm(null);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** "2 added · 1 removed": what the edit changed, for the toolbar. */
function changeSummary(changes: TreeChanges): string {
  return [
    changes.added.size && `${changes.added.size} added`,
    changes.changed.size && `${changes.changed.size} changed`,
    changes.removed.length && `${changes.removed.length} removed`,
  ]
    .filter(Boolean)
    .join(' · ');
}
