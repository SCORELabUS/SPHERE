import type { ServiceNode } from '../../../../api/serviceTreeApi';

// The tree is a flat list: each node names its parent, and siblings keep the
// order they have in the list. Every edit returns a new list.

export function childrenOf(nodes: ServiceNode[], parentId: string | null): ServiceNode[] {
  return nodes.filter(node => node.parentId === parentId);
}

/** The ids of a node's descendants, not including itself. */
export function descendantIds(nodes: ServiceNode[], id: string): Set<string> {
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    for (const child of childrenOf(nodes, current)) {
      if (!found.has(child.id)) {
        found.add(child.id);
        pending.push(child.id);
      }
    }
  }
  return found;
}

export function newServiceId(): string {
  return `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The ancestors of a node, from the top level down to its parent. */
export function ancestorsOf(nodes: ServiceNode[], id: string): ServiceNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path: ServiceNode[] = [];
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId && byId.has(parentId) && path.length <= nodes.length) {
    const parent = byId.get(parentId)!;
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

/** Adds a service last under `parentId`, or right after the sibling `afterId`. */
export function addService(
  nodes: ServiceNode[],
  parentId: string | null,
  afterId?: string
): { nodes: ServiceNode[]; id: string } {
  const id = newServiceId();
  const node: ServiceNode = {
    id,
    parentId,
    name: 'New service',
    description: '',
    kind: parentId ? 'DEPENDENT' : 'AUTONOMOUS',
    dependency: null,
    pricingIds: [],
    attributes: {},
    interfaces: [],
  };
  const at = afterId ? nodes.findIndex(n => n.id === afterId) : -1;
  if (at < 0) return { nodes: [...nodes, node], id };
  return { nodes: [...nodes.slice(0, at + 1), node, ...nodes.slice(at + 1)], id };
}

export type DropPosition = 'before' | 'after' | 'inside';

/** Whether a service can be dropped there: never into itself or below itself. */
export function canDrop(nodes: ServiceNode[], id: string, targetId: string): boolean {
  return id !== targetId && !descendantIds(nodes, id).has(targetId);
}

/** Moves a service before or after another one (as its sibling), or inside it as its last child. */
export function moveService(
  nodes: ServiceNode[],
  id: string,
  targetId: string,
  position: DropPosition
): ServiceNode[] {
  const node = nodes.find(n => n.id === id);
  const target = nodes.find(n => n.id === targetId);
  if (!node || !target || !canDrop(nodes, id, targetId)) return nodes;
  if (position === 'inside') return reparentService(nodes, id, targetId);
  const rest = nodes.filter(n => n.id !== id);
  const at = rest.indexOf(target) + (position === 'after' ? 1 : 0);
  return [...rest.slice(0, at), { ...node, parentId: target.parentId }, ...rest.slice(at)];
}

export function updateService(
  nodes: ServiceNode[],
  id: string,
  changes: Partial<ServiceNode>
): ServiceNode[] {
  return nodes.map(node => {
    if (node.id !== id) return node;
    const next = { ...node, ...changes };
    // Making a service autonomous drops what it depended on; other kinds may keep it.
    if (changes.kind === 'AUTONOMOUS') next.dependency = null;
    return next;
  });
}

/** Removes a service with everything below it. */
export function removeService(nodes: ServiceNode[], id: string): ServiceNode[] {
  const gone = descendantIds(nodes, id);
  gone.add(id);
  return nodes.filter(node => !gone.has(node.id));
}

/** Swaps a service with its previous (-1) or next (1) sibling. */
export function moveAmongSiblings(
  nodes: ServiceNode[],
  id: string,
  direction: -1 | 1
): ServiceNode[] {
  const node = nodes.find(n => n.id === id);
  if (!node) return nodes;
  const siblings = childrenOf(nodes, node.parentId);
  const position = siblings.findIndex(n => n.id === id);
  const other = siblings[position + direction];
  if (!other) return nodes;
  const a = nodes.indexOf(node);
  const b = nodes.indexOf(other);
  const next = [...nodes];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Puts a service last under a new parent (null for the top level). */
export function reparentService(
  nodes: ServiceNode[],
  id: string,
  parentId: string | null
): ServiceNode[] {
  const node = nodes.find(n => n.id === id);
  if (!node || node.parentId === parentId) return nodes;
  if (parentId && (parentId === id || descendantIds(nodes, id).has(parentId))) return nodes;
  return [...nodes.filter(n => n.id !== id), { ...node, parentId }];
}

/** Moves a service into its previous sibling, as its last child. */
export function indentService(nodes: ServiceNode[], id: string): ServiceNode[] {
  const node = nodes.find(n => n.id === id);
  if (!node) return nodes;
  const siblings = childrenOf(nodes, node.parentId);
  const previous = siblings[siblings.findIndex(n => n.id === id) - 1];
  return previous ? reparentService(nodes, id, previous.id) : nodes;
}

/** Moves a service out of its parent, right after it. */
export function outdentService(nodes: ServiceNode[], id: string): ServiceNode[] {
  const node = nodes.find(n => n.id === id);
  const parent = node?.parentId ? nodes.find(n => n.id === node.parentId) : undefined;
  if (!node || !parent) return nodes;
  const rest = nodes.filter(n => n.id !== id);
  const at = rest.indexOf(parent) + 1;
  return [...rest.slice(0, at), { ...node, parentId: parent.parentId }, ...rest.slice(at)];
}

export function togglePricing(nodes: ServiceNode[], id: string, pricingId: string): ServiceNode[] {
  return nodes.map(node => {
    if (node.id !== id) return node;
    const linked = node.pricingIds.includes(pricingId);
    return {
      ...node,
      pricingIds: linked
        ? node.pricingIds.filter(p => p !== pricingId)
        : [...node.pricingIds, pricingId],
    };
  });
}

/** "Top level" and every service but the node and those below it, indented by depth. */
export function parentOptions(
  nodes: ServiceNode[],
  id: string
): { id: string | null; label: string }[] {
  const excluded = descendantIds(nodes, id);
  excluded.add(id);
  const options: { id: string | null; label: string }[] = [{ id: null, label: 'Top level' }];
  const walk = (parentId: string | null, depth: number) => {
    for (const child of childrenOf(nodes, parentId)) {
      if (excluded.has(child.id)) continue;
      options.push({ id: child.id, label: `${'  '.repeat(depth)}${child.name}` });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

export function sameTree(a: ServiceNode[], b: ServiceNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What an edit changed against the saved tree: new and changed services by id, and the services gone. */
export interface TreeChanges {
  added: Set<string>;
  changed: Set<string>;
  removed: ServiceNode[];
}

/** Compares two trees by service id. Reordering siblings alone is not a change of the service. */
export function diffTrees(before: ServiceNode[], after: ServiceNode[]): TreeChanges {
  const old = new Map(before.map(node => [node.id, node]));
  const now = new Set(after.map(node => node.id));
  const added = new Set<string>();
  const changed = new Set<string>();
  for (const node of after) {
    const previous = old.get(node.id);
    if (!previous) added.add(node.id);
    else if (!sameTree([previous], [node])) changed.add(node.id);
  }
  return { added, changed, removed: before.filter(node => !now.has(node.id)) };
}

/** The known kinds (or dependencies), then the others the tree already uses. */
export function labelsOf(
  nodes: ServiceNode[],
  pick: (node: ServiceNode) => string | null,
  known: string[]
): string[] {
  return [...new Set([...known, ...nodes.map(pick).filter((label): label is string => !!label)])];
}

/** A free attribute as text: lists joined with commas, anything else as JSON. */
export function attributeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    Array.isArray(value) &&
    value.every(item => ['string', 'number', 'boolean'].includes(typeof item))
  ) {
    return value.join(', ');
  }
  return JSON.stringify(value);
}
