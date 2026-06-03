export interface VersionData {
  id: string;
  version: string;
  createdAt: string;
  yaml: string;
  private: boolean;
  collection: { id: string; name: string; slug: string } | null;
  analytics: Record<string, number> | null;
}

export type Tab = 'overview' | 'analytics' | 'config-space' | 'versions' | 'settings';

export interface TreeAnalytics {
  numberOfPlans: number; numberOfFeatures: number; numberOfAddOns: number; numberOfUsageLimits: number;
  numberOfFreePlans: number; numberOfPaidPlans: number;
  numberOfDomainFeatures: number; numberOfAutomationFeatures: number; numberOfIntegrationFeatures: number;
  numberOfInformationFeatures: number; numberOfManagementFeatures: number; numberOfGuaranteeFeatures: number;
  numberOfSupportFeatures: number; numberOfPaymentFeatures: number;
  numberOfIntegrationApiFeatures: number; numberOfIntegrationExtensionFeatures: number;
  numberOfIntegrationIdentityProviderFeatures: number; numberOfIntegrationWebSaaSFeatures: number;
  numberOfIntegrationMarketplaceFeatures: number; numberOfIntegrationExternalDeviceFeatures: number;
  numberOfRenewableUsageLimits: number; numberOfNonRenewableUsageLimits: number;
  numberOfResponseDrivenUsageLimits: number; numberOfTimeDrivenUsageLimits: number;
  numberOfReplacementAddons: number; numberOfExtensionAddons: number;
  numberOfBotAutomationFeatures: number; numberOfFilteringAutomationFeatures: number;
  numberOfTrackingAutomationFeatures: number; numberOfTaskAutomationFeatures: number;
}
