/**
 * The visibility of a pricing as people choose it: Public (listed), Unlisted
 * (anyone with the link, left out of search and its organization's page) or
 * Private. The API keeps it in two fields: `private` on every version and
 * `unlisted` on the pricing. Pure, so node:test can check it.
 */
export type PricingVisibilityChoice = 'Public' | 'Unlisted' | 'Private';
/** What a pricing is: one of the choices, or Mixed when only some of its versions are private. */
export type PricingVisibility = PricingVisibilityChoice | 'Mixed';

export const PRICING_VISIBILITY_CHOICES: PricingVisibilityChoice[] = ['Public', 'Unlisted', 'Private'];

export const PRICING_VISIBILITY_DESCRIPTIONS: Record<PricingVisibilityChoice, string> = {
  Public: 'Anyone can see it, and it shows in search and on its organization\'s page.',
  Unlisted:
    'Anyone with the link can see it. It does not show in search, on its organization\'s page or in its collections, ' +
    'except to its owners, admins and members who can view it. The link is not a secret: to share it without ' +
    'showing who published it, use Get pricing → Anonymous link.',
  Private: 'Only its owners, admins and members who can view it.',
};

interface VersionVisibility {
  private?: boolean;
}

/** Private wins over the rest: all versions private is Private, some is Mixed, none is Public or Unlisted. */
export function pricingVisibility(versions: VersionVisibility[], unlisted: boolean): PricingVisibility {
  const privateCount = versions.filter(version => version.private === true).length;
  if (privateCount === 0) return unlisted ? 'Unlisted' : 'Public';
  return privateCount === versions.length ? 'Private' : 'Mixed';
}

/**
 * The body of `PUT /pricings/{org}/{slug}` that sets a choice. Private keeps
 * whether the pricing is listed, so publishing a version later does not list
 * a pricing that was unlisted before.
 */
export function visibilityChangeBody(target: PricingVisibilityChoice): { private: boolean; unlisted?: boolean } {
  if (target === 'Private') return { private: true };
  return { private: false, unlisted: target === 'Unlisted' };
}

/** The form fields of an upload that creates a pricing with this choice. */
export function visibilityFormFields(choice: PricingVisibilityChoice): { private: 'true' | 'false'; unlisted: 'true' | 'false' } {
  return { private: choice === 'Private' ? 'true' : 'false', unlisted: choice === 'Unlisted' ? 'true' : 'false' };
}

/** Listed with something anyone can read: search shows it next to the organization that published it. */
export function isListedWithPublicVersion(versions: VersionVisibility[], unlisted: boolean): boolean {
  return !unlisted && versions.some(version => version.private !== true);
}

export type AnonymousLinkStep = 'private-version' | 'listed-warning' | 'ready';

/**
 * What the anonymous link dialog asks first: a private version is never
 * shared this way; a listed pricing gets a warning, as it can be found next to
 * who published it; anything else can be shared right away.
 */
export function anonymousLinkStep(selected: VersionVisibility | null | undefined, versions: VersionVisibility[], unlisted: boolean): AnonymousLinkStep {
  if (selected?.private === true) return 'private-version';
  if (isListedWithPublicVersion(versions, unlisted)) return 'listed-warning';
  return 'ready';
}

/** The confirmation shown before listing an unlisted pricing that has active anonymous links. */
export function makePublicConfirmation(activeLinks: number): string {
  const links = activeLinks === 1 ? '1 active anonymous link' : `${activeLinks} active anonymous links`;
  return `This pricing has ${links}. Making it public lists it in SPHERE's search and on its organization's page, ` +
    'next to the organization that published it, so whoever opens those links could find out who published it.';
}
