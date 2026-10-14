import { useEffect, useSyncExternalStore } from 'react';
import {
  isAssistantPresent,
  registerAssistant,
  subscribeToAssistants,
  type AssistantPanel,
} from '../utils/assistant-panels';

/**
 * Marks `self` as shown on the page while `active`, and tells whether `other`
 * is shown too, so the floating assistants can stack instead of overlapping.
 */
export function useAssistantPresence(self: AssistantPanel, other: AssistantPanel, active = true): boolean {
  useEffect(() => (active ? registerAssistant(self) : undefined), [self, active]);
  return useSyncExternalStore(subscribeToAssistants, () => isAssistantPresent(other));
}
