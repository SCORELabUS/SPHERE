import { Types } from 'mongoose';

export interface LeanPricing {
  name: string;
  slug?: string;
  _organizationId?: Types.ObjectId | string;
  _collectionId?: Types.ObjectId | string;

  version: string;
  createdAt: Date;

  url?: string;
  currency: string;
  yaml: string;

  private: boolean;

  analytics?: PricingAnalytics;

  // Virtual (when populate is used)
  collection?: PricingCollection | string | null;
  organization?: PricingOrganization | null;
}

export interface PricingAnalytics {
  numberOfFeatures?: number;
  numberOfInformationFeatures?: number;
  numberOfIntegrationFeatures?: number;
  numberOfIntegrationApiFeatures?: number;
  numberOfIntegrationExtensionFeatures?: number;
  numberOfIntegrationIdentityProviderFeatures?: number;
  numberOfIntegrationWebSaaSFeatures?: number;
  numberOfIntegrationMarketplaceFeatures?: number;
  numberOfIntegrationExternalDeviceFeatures?: number;
  numberOfDomainFeatures?: number;
  numberOfAutomationFeatures?: number;
  numberOfBotAutomationFeatures?: number;
  numberOfFilteringAutomationFeatures?: number;
  numberOfTrackingAutomationFeatures?: number;
  numberOfTaskAutomationFeatures?: number;
  numberOfManagementFeatures?: number;
  numberOfGuaranteeFeatures?: number;
  numberOfSupportFeatures?: number;
  numberOfPaymentFeatures?: number;
  numberOfUsageLimits?: number;
  numberOfRenewableUsageLimits?: number;
  numberOfNonRenewableUsageLimits?: number;
  numberOfResponseDrivenUsageLimits?: number;
  numberOfTimeDrivenUsageLimits?: number;
  numberOfPlans?: number;
  numberOfFreePlans?: number;
  numberOfPaidPlans?: number;
  numberOfAddOns?: number;
  numberOfReplacementAddons?: number;
  numberOfExtensionAddons?: number;
  configurationSpaceSize?: number;
  minSubscriptionPrice?: number;
  maxSubscriptionPrice?: number;
}

export interface PricingCollection {
  _id: Types.ObjectId | string;
  name?: string;
  slug?: string;
}

export interface PricingOrganization {
  _id: Types.ObjectId | string;
  name: string;
  displayName: string;
  avatar: string;
}