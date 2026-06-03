import { check } from 'express-validator';

const create = [
  check('private')
    .exists({ checkNull: true, checkFalsy: true })
    .isBoolean()
    .withMessage('The private field is required and must be boolean'),
  check('collectionId')
    .optional()
    .isString()
    .withMessage('The collectionId field must be a string')
    .trim(),
  check('name')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
];

const update = [
  check('name')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
  check('private')
    .optional()
    .isBoolean()
    .withMessage('The private field must be boolean'),
  check('_collectionId')
    .optional()
    .isString()
    .withMessage('The _collectionId field must be a string')
    .trim(),
  check('createdAt')
    .optional()
    .isISO8601()
    .withMessage('The createdAt field must be a valid ISO8601 date')
    .toDate(),
  check('url')
    .optional()
    .isURL()
    .withMessage('The url field must be a valid URL')
    .trim(),
  check('yaml')
    .optional()
    .isString()
    .withMessage('The yaml field must be a string')
    .trim(),
  check('analytics')
    .optional()
    .isObject()
    .withMessage('analytics must be an object'),
  check('analytics.numberOfFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfFeatures must be a number'),
  check('analytics.numberOfInformationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfInformationFeatures must be a number'),
  check('analytics.numberOfIntegrationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationFeatures must be a number'),
  check('analytics.numberOfIntegrationApiFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationApiFeatures must be a number'),
  check('analytics.numberOfIntegrationExtensionFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationExtensionFeatures must be a number'),
  check('analytics.numberOfIntegrationIdentityProviderFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationIdentityProviderFeatures must be a number'),
  check('analytics.numberOfIntegrationWebSaaSFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationWebSaaSFeatures must be a number'),
  check('analytics.numberOfIntegrationMarketplaceFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationMarketplaceFeatures must be a number'),
  check('analytics.numberOfIntegrationExternalDeviceFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfIntegrationExternalDeviceFeatures must be a number'),
  check('analytics.numberOfDomainFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfDomainFeatures must be a number'),
  check('analytics.numberOfAutomationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfAutomationFeatures must be a number'),
  check('analytics.numberOfBotAutomationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfBotAutomationFeatures must be a number'),
  check('analytics.numberOfFilteringAutomationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfFilteringAutomationFeatures must be a number'),
  check('analytics.numberOfTrackingAutomationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfTrackingAutomationFeatures must be a number'),
  check('analytics.numberOfTaskAutomationFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfTaskAutomationFeatures must be a number'),
  check('analytics.numberOfManagementFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfManagementFeatures must be a number'),
  check('analytics.numberOfGuaranteeFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfGuaranteeFeatures must be a number'),
  check('analytics.numberOfSupportFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfSupportFeatures must be a number'),
  check('analytics.numberOfPaymentFeatures')
    .optional()
    .isNumeric()
    .withMessage('numberOfPaymentFeatures must be a number'),
  check('analytics.numberOfUsageLimits')
    .optional()
    .isNumeric()
    .withMessage('numberOfUsageLimits must be a number'),
  check('analytics.numberOfRenewableUsageLimits')
    .optional()
    .isNumeric()
    .withMessage('numberOfRenewableUsageLimits must be a number'),
  check('analytics.numberOfNonRenewableUsageLimits')
    .optional()
    .isNumeric()
    .withMessage('numberOfNonRenewableUsageLimits must be a number'),
  check('analytics.numberOfResponseDrivenUsageLimits')
    .optional()
    .isNumeric()
    .withMessage('numberOfResponseDrivenUsageLimits must be a number'),
  check('analytics.numberOfTimeDrivenUsageLimits')
    .optional()
    .isNumeric()
    .withMessage('numberOfTimeDrivenUsageLimits must be a number'),
  check('analytics.numberOfPlans')
    .optional()
    .isNumeric()
    .withMessage('numberOfPlans must be a number'),
  check('analytics.numberOfFreePlans')
    .optional()
    .isNumeric()
    .withMessage('numberOfFreePlans must be a number'),
  check('analytics.numberOfPaidPlans')
    .optional()
    .isNumeric()
    .withMessage('numberOfPaidPlans must be a number'),
  check('analytics.numberOfAddOns')
    .optional()
    .isNumeric()
    .withMessage('numberOfAddOns must be a number'),
  check('analytics.numberOfReplacementAddons')
    .optional()
    .isNumeric()
    .withMessage('numberOfReplacementAddons must be a number'),
  check('analytics.numberOfExtensionAddons')
    .optional()
    .isNumeric()
    .withMessage('numberOfExtensionAddons must be a number'),
  check('analytics.configurationSpaceSize')
    .optional()
    .isNumeric()
    .withMessage('configurationSpaceSize must be a number'),
  check('analytics.minSubscriptionPrice')
    .optional()
    .isNumeric()
    .withMessage('minSubscriptionPrice must be a number'),
  check('analytics.maxSubscriptionPrice')
    .optional()
    .isNumeric()
    .withMessage('maxSubscriptionPrice must be a number'),
];

export { create, update };
