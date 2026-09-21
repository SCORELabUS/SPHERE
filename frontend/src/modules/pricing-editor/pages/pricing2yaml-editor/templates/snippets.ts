import type { Pricing2YamlSnippet } from '../../../services/pricing2yaml/snippets';

import { TEMPLATE_PETCLINIC_PRICING } from './petclinic';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Skeleton of a valid pricing: the header plus one feature and one plan.
 *
 * The plan declares `features: null` because the parser requires the key to be
 * present even when the plan overrides nothing.
 */
function buildMinimalPricing(): string {
  return `saasName: \${1:Your SaaS}
syntaxVersion: "3.1"
version: "\${2:1.0.0}"
createdAt: "${today()}"
currency: \${3|EUR,USD,GBP|}
billing:
  monthly: 1
features:
  \${4:featureName}:
    description: \${5:What this feature unlocks}
    valueType: BOOLEAN
    defaultValue: true
    type: DOMAIN
plans:
  \${6:BASIC}:
    description: \${7:Free tier}
    price: 0.0
    unit: user/month
    features: null
`;
}

/**
 * The templates the editor offers, by typing their prefix or through the
 * templates menu.
 *
 * Every body is written so that the result lints clean out of the box: the
 * required fields are all there, and the conditional ones (a period for a
 * renewable limit, `integrationType` for an integration, ...) come with the
 * variant that needs them.
 */
export const PRICING2YAML_SNIPPETS: readonly Pricing2YamlSnippet[] = [
  {
    id: 'feature',
    label: 'Feature',
    prefix: 'feature',
    detail: 'Boolean feature toggled per plan',
    documentation: 'A feature the plans switch on or off. The name is mirrored into its expression.',
    kind: 'block',
    section: 'features',
    body: `\${1:featureName}:
  description: \${2:What this feature unlocks}
  valueType: BOOLEAN
  defaultValue: \${3|false,true|}
  type: \${4|DOMAIN,INFORMATION,MANAGEMENT,SUPPORT,GUARANTEE|}
  expression: pricingContext['features']['\${1:featureName}']`,
  },
  {
    id: 'feature-integration',
    label: 'Integration feature',
    prefix: 'featureIntegration',
    detail: 'Feature of type INTEGRATION',
    documentation:
      'An integration with an external system. `integrationType` is required whenever the type is INTEGRATION.',
    kind: 'block',
    section: 'features',
    body: `\${1:integrationName}:
  description: \${2:What this integration connects to}
  valueType: BOOLEAN
  defaultValue: false
  type: INTEGRATION
  integrationType: \${3|API,EXTENSION,IDENTITY_PROVIDER,WEB_SAAS,MARKETPLACE,EXTERNAL_DEVICE|}
  expression: pricingContext['features']['\${1:integrationName}']`,
  },
  {
    id: 'feature-automation',
    label: 'Automation feature',
    prefix: 'featureAutomation',
    detail: 'Feature of type AUTOMATION',
    documentation:
      'Work the SaaS performs on the user behalf. `automationType` is required whenever the type is AUTOMATION.',
    kind: 'block',
    section: 'features',
    body: `\${1:automationName}:
  description: \${2:What this automation does}
  valueType: BOOLEAN
  defaultValue: false
  type: AUTOMATION
  automationType: \${3|BOT,FILTERING,TRACKING,TASK_AUTOMATION|}
  expression: pricingContext['features']['\${1:automationName}']`,
  },
  {
    id: 'usage-limit',
    label: 'Usage limit (renewable)',
    prefix: 'usageLimit',
    detail: 'Limit that resets every period',
    documentation: 'A renewable limit, such as a monthly quota. Renewable limits must declare a period.',
    kind: 'block',
    section: 'usageLimits',
    body: `\${1:maxItemsPerMonth}:
  description: \${2:What this limit caps}
  valueType: NUMERIC
  defaultValue: \${3:10}
  unit: \${4:item/month}
  type: RENEWABLE
  period:
    value: 1
    unit: \${5|MONTH,DAY,YEAR,HOUR,MIN,SEC|}
  linkedFeatures:
    - \${6:featureName}`,
  },
  {
    id: 'usage-limit-non-renewable',
    label: 'Usage limit (non renewable)',
    prefix: 'usageLimitOnce',
    detail: 'Limit consumed once',
    documentation:
      'A non renewable limit, such as a total number of seats. Non renewable limits must declare whether they are trackable.',
    kind: 'block',
    section: 'usageLimits',
    body: `\${1:maxItems}:
  description: \${2:What this limit caps}
  valueType: NUMERIC
  defaultValue: \${3:5}
  unit: \${4:item}
  type: NON_RENEWABLE
  trackable: true
  linkedFeatures:
    - \${5:featureName}`,
  },
  {
    id: 'plan',
    label: 'Plan',
    prefix: 'plan',
    detail: 'Plan with feature and limit overrides',
    documentation: 'A subscription tier. Only the features and limits that differ from their default need overriding.',
    kind: 'block',
    section: 'plans',
    body: `\${1:PLAN_NAME}:
  description: \${2:What this plan is for}
  price: \${3:0.0}
  unit: \${4:user/month}
  features:
    \${5:featureName}:
      value: \${6|true,false|}
  usageLimits:
    \${7:usageLimitName}:
      value: \${8:10}`,
  },
  {
    id: 'addon',
    label: 'Add-on',
    prefix: 'addOn',
    detail: 'Add-on that unlocks features',
    documentation:
      'An extra sold on top of a plan. An add-on must contribute at least one feature, usage limit or usage limit extension.',
    kind: 'block',
    section: 'addOns',
    body: `\${1:addOnName}:
  description: \${2:What this add-on unlocks}
  price: \${3:5.0}
  unit: \${4:user/month}
  availableFor:
    - \${5:PLAN_NAME}
  features:
    \${6:featureName}:
      value: true`,
  },
  {
    id: 'addon-scalable',
    label: 'Scalable add-on',
    prefix: 'addOnScalable',
    detail: 'Add-on bought in quantities',
    documentation:
      'An add-on that extends a usage limit and can be subscribed to several times. `subscriptionConstraints` only applies to this shape.',
    kind: 'block',
    section: 'addOns',
    body: `\${1:extraItems}:
  description: \${2:What this add-on extends}
  price: \${3:2.95}
  unit: \${4:item/month}
  usageLimitsExtensions:
    \${5:usageLimitName}:
      value: \${6:1}
  subscriptionConstraints:
    minQuantity: 1
    maxQuantity: \${7:20}
    quantityStep: 1`,
  },
  {
    id: 'pricing-minimal',
    label: 'Minimal pricing',
    prefix: 'pricingMinimal',
    detail: 'Replaces the document with a bare pricing',
    documentation:
      'The smallest valid Pricing2Yaml document: header, one feature and one plan. Replaces the whole editor contents.',
    kind: 'document',
    body: buildMinimalPricing,
  },
  {
    id: 'pricing-example',
    label: 'Example pricing (PetClinic)',
    prefix: 'pricingExample',
    detail: 'Replaces the document with a full example',
    documentation:
      'A complete pricing exercising features, usage limits, plans and add-ons. Replaces the whole editor contents.',
    kind: 'document',
    body: TEMPLATE_PETCLINIC_PRICING,
  },
];
