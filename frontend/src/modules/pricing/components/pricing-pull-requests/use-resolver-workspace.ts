import { useEffect, useRef, useState } from 'react';
import type { ResolverView } from '../../../core/components/pricing-merge-resolver';
import type { MergeResolver } from '../../../core/hooks/useMergeResolver';

/**
 * Whether the resolver of a merge or an update is open over the window, and
 * the view it opens on: the conflicts while there are some, the comparison
 * otherwise. The button that opened it takes the focus back when it closes.
 */
export function useResolverWorkspace(resolver: MergeResolver, openAtStart: boolean) {
  const [isOpen, setIsOpen] = useState(openAtStart);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(isOpen);

  useEffect(() => {
    if (wasOpen.current && !isOpen) opener.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);

  const initialView: ResolverView =
    resolver.preview && resolver.state.conflicts.length === 0 ? 'compare' : 'conflicts';
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    opener,
    initialView,
  };
}
