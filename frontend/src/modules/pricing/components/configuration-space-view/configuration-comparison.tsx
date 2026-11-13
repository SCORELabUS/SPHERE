import { useMemo } from 'react';
import { compareSelections } from 'pricing-renderer';
import type { MessageCatalog, NormalizedPricing, PricingSelection } from 'pricing-renderer';
import type { ReviewSectionName } from 'pricing-renderer/element';
import {
  PricingChangeReview,
  type PricingChangeReviewElement,
  type PricingChangeReviewProps,
} from 'pricing-renderer/react';

/**
 * `hideSections` is a reactive property of `<pricing-change-review>` and `@lit/react` assigns it
 * like any other, but it is not yet in the React prop type. One assertion here keeps the rest of
 * the file honestly typed.
 */
const ChangeReview = PricingChangeReview as React.ForwardRefExoticComponent<
  PricingChangeReviewProps & { hideSections?: readonly ReviewSectionName[] } & React.RefAttributes<
      PricingChangeReviewElement
    >
>;

/**
 * - `actions` — a comparison has nothing to confirm or go back from.
 * - `relation` — the Upgrade / Downgrade badge is decided by the declaration order of
 *   `pricing.plans`. Inside a subscription that order is the ladder and the badge is true. Between
 *   two configurations a reader picked there is no such ladder, so the badge would assert a
 *   direction that does not exist.
 * - `title` — the panel below carries its own heading.
 */
const HIDDEN_REVIEW_SECTIONS: readonly ReviewSectionName[] = ['actions', 'relation', 'title'];

/**
 * The element's copy is written for someone changing their own subscription. Every label it shows
 * is a message key, so the same diff reads as a neutral A/B comparison without touching the
 * component. Only the keys that carry the subscription framing are overridden; the structural ones
 * ("Plan", "Features", "{before} → {after}") already read correctly.
 */
const COMPARISON_MESSAGES: MessageCatalog = {
  'pricing.reviewPriceBefore': 'Price of A',
  'pricing.reviewPriceAfter': 'Price of B',
  'pricing.reviewPriceDifference': 'Difference (B − A)',
  'pricing.reviewFeatureGained': 'Only in B',
  'pricing.reviewFeatureLost': 'Only in A',
  'pricing.reviewFeatureChanged': 'Different',
  'pricing.reviewAddOnAdded': 'Only in B',
  'pricing.reviewAddOnRemoved': 'Only in A',
  'pricing.reviewNoChanges': 'A and B are the same configuration.',
  'pricing.reviewUnchangedSummary': '{features} features and {limits} usage limits match.',
  'pricing.reviewRelationCurrent': 'Identical',
  'pricing.reviewRemovedNotInVersion': 'Not offered in B',
};

export interface ConfigurationComparisonProps {
  /** One normalized pricing, used for both sides. */
  pricing: NormalizedPricing;
  /** The configuration captured as A. */
  a: PricingSelection;
  /** The configuration captured as B. */
  b: PricingSelection;
}

/**
 * What differs between two configurations of one pricing.
 *
 * `compareSelections` takes a `pricing` and a `selection` on each side independently — the doc
 * comments call them the contract and the edit, but nothing requires that, so the same pricing on
 * both sides with two selections is a plain A/B diff and the component's own engine does the work.
 *
 * No `currentUsage` is passed: there is no subscription here, and supplying one would produce
 * "your current usage is above the new limit" warnings about a contract that does not exist.
 */
export default function ConfigurationComparison({ pricing, a, b }: ConfigurationComparisonProps) {
  const comparison = useMemo(
    () =>
      compareSelections({
        before: { pricing, selection: a },
        after: { pricing, selection: b },
      }),
    [pricing, a, b]
  );

  return (
    <ChangeReview
      comparison={comparison}
      hideSections={HIDDEN_REVIEW_SECTIONS}
      notices={[]}
      messages={COMPARISON_MESSAGES}
      locale="en-US"
    />
  );
}
