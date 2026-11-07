import type { PricingSelection } from 'pricing-renderer';

/** Which of the two held configurations a capture fills. */
export type CompareSide = 'a' | 'b';

/** The two configurations held for comparison; either may be empty. */
export type CompareSlots = { a?: PricingSelection; b?: PricingSelection };

/**
 * The slot the next capture fills: the first empty one, else A, so a third capture replaces the
 * older side rather than doing nothing.
 */
export function nextSlot(slots: CompareSlots): CompareSide {
  if (!slots.a) return 'a';
  if (!slots.b) return 'b';
  return 'a';
}

/**
 * The label for a capture action, which names the act rather than the letter.
 *
 * "Set as A" means nothing until you already know a comparison exists further down the page. The
 * first capture is an offer to compare; once one side is held, the second says what it will be
 * compared against.
 */
export function captureLabel(slots: CompareSlots): string {
  if (!slots.a) return 'Compare this one';
  if (!slots.b) return 'Compare with A';
  return 'Replace A';
}
