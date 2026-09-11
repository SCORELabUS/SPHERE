/** Walks an organization tree without caring how its children are spelled. */
type ChildrenOf<T> = (node: T) => T[];

/** The node with the given id, searched depth-first across every root. */
export function findInTree<T extends { id: string }>(
  roots: T[],
  id: string,
  childrenOf: ChildrenOf<T>
): T | null {
  for (const root of roots) {
    if (root.id === id) {
      return root;
    }

    const found = findInTree(childrenOf(root), id, childrenOf);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * The ids of a node and everything below it.
 *
 * A branch cannot be dropped inside itself — that would detach it from the
 * tree — so these are the targets a drag has to refuse.
 */
export function collectBranchIds<T extends { id: string }>(
  node: T,
  childrenOf: ChildrenOf<T>
): Set<string> {
  const ids = new Set<string>();

  const walk = (current: T) => {
    ids.add(current.id);
    childrenOf(current).forEach(walk);
  };

  walk(node);

  return ids;
}
