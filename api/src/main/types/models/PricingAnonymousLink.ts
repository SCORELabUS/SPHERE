/**
 * Anonymous links: a random token that shows one version of a pricing without
 * anything that names who published it (organization, collection, author, ids,
 * origin of a fork). See PricingAnonymousLinkService.
 */

/** 24 random bytes: 192 bits, written as 32 base64url characters. */
export const ANONYMOUS_TOKEN_BYTES = 24;
export const ANONYMOUS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Links of one pricing, active or suspended; revoking one makes room. */
export const MAX_ANONYMOUS_LINKS_PER_PRICING = 20;

/** The largest pricing file an anonymous link serves, as the synchronization API. */
export const MAX_ANONYMOUS_YAML_BYTES = 5 * 1024 * 1024;

/** The only keys the public answer of a link has. */
export const ANONYMOUS_PRICING_KEYS = ['analytics', 'createdAt', 'version', 'yaml'] as const;

/** The only analytics it carries: counts and prices of the version, never a name or an id. */
export const ANONYMOUS_ANALYTICS_KEYS = [
  'numberOfFeatures',
  'numberOfInformationFeatures',
  'numberOfIntegrationFeatures',
  'numberOfIntegrationApiFeatures',
  'numberOfIntegrationExtensionFeatures',
  'numberOfIntegrationIdentityProviderFeatures',
  'numberOfIntegrationWebSaaSFeatures',
  'numberOfIntegrationMarketplaceFeatures',
  'numberOfIntegrationExternalDeviceFeatures',
  'numberOfDomainFeatures',
  'numberOfAutomationFeatures',
  'numberOfBotAutomationFeatures',
  'numberOfFilteringAutomationFeatures',
  'numberOfTrackingAutomationFeatures',
  'numberOfTaskAutomationFeatures',
  'numberOfManagementFeatures',
  'numberOfGuaranteeFeatures',
  'numberOfSupportFeatures',
  'numberOfPaymentFeatures',
  'numberOfUsageLimits',
  'numberOfRenewableUsageLimits',
  'numberOfNonRenewableUsageLimits',
  'numberOfResponseDrivenUsageLimits',
  'numberOfTimeDrivenUsageLimits',
  'numberOfPlans',
  'numberOfFreePlans',
  'numberOfPaidPlans',
  'numberOfAddOns',
  'numberOfReplacementAddons',
  'numberOfExtensionAddons',
  'configurationSpaceSize',
  'minSubscriptionPrice',
  'maxSubscriptionPrice',
] as const;

/** A link as its pricing's editors see it. */
export interface AnonymousLinkView {
  id: string;
  token: string;
  versionId: string;
  /** The label of the version it shows. */
  version: string;
  createdAt: Date;
  /** False while the version is private: the link answers like a missing one until it is not. */
  active: boolean;
}

/** What a link shows to anyone. */
export interface AnonymousPricing {
  version: string;
  createdAt: Date;
  analytics: Partial<Record<(typeof ANONYMOUS_ANALYTICS_KEYS)[number], number>>;
  yaml: string;
}
