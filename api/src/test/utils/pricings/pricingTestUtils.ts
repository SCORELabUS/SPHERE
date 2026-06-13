import { writeFile, mkdir } from 'fs/promises';
import { faker } from '@faker-js/faker';
import { TestFeature, TestUsageLimit, TestPlan, TestAddOn, TestPricing } from '../../types/Pricing';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { biasedRandomInt } from '../random';
import testContainer from '../config/testContainer';
import { BASE_PATH } from '../config/variables';
import { promises as fs, existsSync } from 'fs';
import request from 'supertest';
import os from 'os';
import { randomSuffix } from '../helpers';

export const createValidPricingYaml = async (requestedName?: string, explicitVersion?: string) => {
  const templatePath = path.resolve(
    process.cwd(),
    'public',
    'static',
    'pricings',
    'templates',
    'petclinic.yml'
  );

  const rawTemplate = await fs.readFile(templatePath, 'utf8');
  const saasName = requestedName ?? `IntegrationPricing_${randomSuffix()}`;
  const version = explicitVersion ?? `${Date.now()}.0.0`;
  const today = new Date().toISOString().slice(0, 10);

  const content = rawTemplate
    .replace(/^saasName:\s*.*$/m, `saasName: ${saasName}`)
    .replace(/^version:\s*.*$/m, `version: "${version}"`)
    .replace(/^createdAt:\s*.*$/m, `createdAt: "${today}"`);

  const filePath = path.join(os.tmpdir(), `pricing_${randomSuffix()}.yml`);
  await fs.writeFile(filePath, content, 'utf8');
  testContainer.resolve('generatedFilesToDelete').add(filePath);

  return { filePath, saasName, version };
};

export const createAndTrackPricingYaml = async (serviceName?: string, version?: string) => {
  const filePath = await generatePricingFile(serviceName, version);
  testContainer.resolve('generatedFilesToDelete').add(filePath);
  return filePath;
};

export const createPricingForOrganization = async (params: {
  organizationId: string;
  serviceName?: string;
  version?: string;
  isPrivate?: boolean;
}): Promise<{ response: any; serviceName: string; version: string; id: string }> => {
  const requestedName = params.serviceName ?? `pricing_${randomSuffix()}`;
  const requestedVersion = params.version;
  const fixture = await createValidPricingYaml(requestedName, requestedVersion);
  const serviceName = fixture.saasName;
  const version = fixture.version;

  const response = await request(testContainer.resolve('app'))
    .post(`${BASE_PATH}/pricings/${params.organizationId}`)
    .set('Authorization', `Bearer ${testContainer.resolve('adminUser').token}`)
    .field('private', String(params.isPrivate ?? false))
    .field('saasName', serviceName)
    .field('version', version)
    .attach('yaml', fixture.filePath);

  if (response.status !== 200) {
    throw new Error(
      `Pricing creation failed with status ${response.status}: ${JSON.stringify(response.body)}`
    );
  }

  testContainer.resolve('pricingsToDelete').add(response.body.id);

  return { response, serviceName, version, id: response.body.id };
};

export async function generatePricingFile(serviceName?: string, version?: string): Promise<string> {
  if (!version) {
    version = uuidv4();
  }

  let pricing: TestPricing & { saasName?: string; syntaxVersion?: string } =
    generatePricing(version);
  if (serviceName) {
    pricing = {
      saasName: serviceName,
      ...pricing,
    };
  }
  pricing = {
    syntaxVersion: '3.0',
    ...pricing,
  };
  const yamlStr = yaml.dump(pricing, {
    noRefs: true, // avoid alias (&/<<)
    skipInvalid: true, // ignore functions or symbols not serializable
    lineWidth: -1, // do not cut lines
  });

  const filePath = path.resolve(__dirname, `../../data/generated/${version}.yaml`);

  if (!existsSync(path.dirname(filePath))) {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  await writeFile(filePath, yamlStr, 'utf8');

  return filePath;
}

function generatePricing(version?: string): TestPricing {
  const featureCount = faker.number.int({ min: 5, max: 20 });
  const usageLimitCount = faker.number.int({ min: 3, max: 15 });
  const planCount = faker.number.int({ min: 1, max: 5 });
  const addOnCount = faker.number.int({ min: 0, max: 5 });

  const features: Record<string, TestFeature> = {};
  const usageLimits: Record<string, TestUsageLimit> = {};
  const plans: Record<string, TestPlan> = {};
  const addOns: Record<string, TestAddOn> = {};

  const featureKeys = Array.from({ length: featureCount }, () =>
    faker.word.noun({ length: { min: 4, max: 20 } })
  );
  const usageLimitKeys = Array.from({ length: usageLimitCount }, () =>
    faker.word.noun({ length: { min: 4, max: 20 } })
  );

  featureKeys.forEach(key => (features[key] = generateFeature(key)));
  usageLimitKeys.forEach(
    key =>
      (usageLimits[key] = generateUsageLimit(
        key,
        faker.datatype.boolean({ probability: 0.95 })
          ? [faker.helpers.arrayElement(featureKeys)]
          : undefined
      ))
  );

  _generateExpressionsForFeatures(features, usageLimits);

  for (let i = 0; i < planCount; i++) {
    const planName = faker.word.noun({ length: { min: 4, max: 20 } }).toUpperCase();
    plans[planName] = generatePlan(features, usageLimits);
  }

  const planKeys = Object.keys(plans);

  for (let i = 0; i < addOnCount; i++) {
    const addOnName = faker.word.noun({ length: { min: 4, max: 20 } }).toLowerCase();
    let randomAddType = faker.number.int({ min: 0, max: 2 });

    if (usageLimitKeys.length === 0) {
      randomAddType = 0;
    }

    switch (randomAddType) {
      case 0:
        const randomFeatureKeys = faker.helpers.arrayElements(
          featureKeys,
          biasedRandomInt(1, featureKeys.length)
        );
        addOns[addOnName] = generateAddOn(
          Object.values(features).filter(feature => randomFeatureKeys.includes(feature.name)),
          [],
          [],
          planKeys,
          Object.keys(addOns)
        );
        break;
      case 1:
        const randomUsageLimitKeys = faker.helpers.arrayElements(
          usageLimitKeys,
          biasedRandomInt(1, usageLimitKeys.length)
        );
        addOns[addOnName] = generateAddOn(
          [],
          Object.values(usageLimits).filter(usageLimit =>
            randomUsageLimitKeys.includes(usageLimit.name)
          ),
          [],
          planKeys,
          Object.keys(addOns)
        );
        break;
      case 2:
        const randomUsageLimitKeysExtensions = faker.helpers.arrayElements(
          usageLimitKeys,
          biasedRandomInt(1, usageLimitKeys.length)
        );

        const usageLimitExtensions = Object.values(usageLimits)
          .filter(usageLimit => randomUsageLimitKeysExtensions.includes(usageLimit.name))
          .filter(usageLimit => usageLimit.valueType === 'NUMERIC');

        if (usageLimitExtensions.length > 0) {
          addOns[addOnName] = generateAddOn(
            [],
            [],
            usageLimitExtensions,
            planKeys,
            Object.keys(addOns)
          );
        }
        break;
      default:
        throw new Error(`Unsupported add-on type: ${randomAddType}`);
    }
  }

  return {
    version: version ?? uuidv4(),
    currency: 'USD',
    createdAt: new Date().toISOString().split('T')[0],
    features,
    usageLimits,
    plans,
    addOns,
  };
}

function generateFeature(name?: string): TestFeature {
  const featureName = name ?? faker.word.words(1);
  const featureValueType = faker.datatype.boolean({ probability: 0.8 }) ? 'BOOLEAN' : 'TEXT';
  const featureType = faker.helpers.arrayElement([
    'INFORMATION',
    'INTEGRATION',
    'DOMAIN',
    'AUTOMATION',
    'MANAGEMENT',
    'GUARANTEE',
    'SUPPORT',
    // 'PAYMENT', - Given the complexity of handling payment types, we'll keep them out from automatic generation.
  ]);

  let defaultValue: boolean | string;
  let value: boolean | string | undefined;

  switch (featureValueType) {
    case 'BOOLEAN':
      [defaultValue, value] = _generateDefaultValueAndValueBoolean();
      break;
    case 'TEXT':
      defaultValue = faker.lorem.word();
      value = faker.datatype.boolean() ? undefined : faker.lorem.word();
      break;
    default:
      throw new Error(`Unsupported feature type: ${featureType}`);
  }

  return {
    name: featureName,
    description: faker.lorem.sentence(),
    valueType: featureValueType,
    defaultValue: defaultValue,
    value: value,
    type: featureType,
    integrationType:
      featureType === 'INTEGRATION'
        ? faker.helpers.arrayElement([
            'API',
            'EXTENSION',
            'IDENTITY_PROVIDER',
            'WEB_SAAS',
            'MARKETPLACE',
            'EXTERNAL_DEVICE',
          ])
        : undefined,
    pricingUrls: undefined,
    automationType:
      featureType === 'AUTOMATION'
        ? faker.helpers.arrayElement(['BOT', 'FILTERING', 'TRACKING', 'TASK_AUTOMATION'])
        : undefined,
    docUrl: undefined,
    expression:
      featureValueType === 'BOOLEAN' ? `pricingContext['features']['${featureName}']` : undefined,
    serverExpression: undefined,
    render: faker.helpers.arrayElement(['auto', 'enabled', 'disabled']),
    tag: undefined,
  };
}

function generateUsageLimit(name?: string, linkedFeatures?: string[]): TestUsageLimit {
  const usageLimitValueType = faker.helpers.arrayElement(['BOOLEAN', 'NUMERIC']);
  const usageLimitType = faker.helpers.arrayElement(['RENEWABLE', 'NON_RENEWABLE']);

  let defaultValue: boolean | string | number;
  let value: boolean | string | number | undefined;

  switch (usageLimitValueType) {
    case 'BOOLEAN':
      [defaultValue, value] = _generateDefaultValueAndValueBoolean();
      break;
    case 'NUMERIC':
      [defaultValue, value] = _generateDefaultValueAndValueNumeric();
      break;
    default:
      throw new Error(`Unsupported usage limit type: ${usageLimitType}`);
  }

  return {
    name: name ?? faker.word.words(1),
    description: faker.lorem.sentence(),
    valueType: usageLimitValueType,
    defaultValue: defaultValue,
    value: value,
    type: usageLimitType,
    trackable: usageLimitType === 'NON_RENEWABLE' ? faker.datatype.boolean() : undefined,
    period:
      usageLimitType === 'RENEWABLE'
        ? {
            value: faker.number.int({ min: 1, max: 12 }),
            unit: faker.helpers.arrayElement(['SEC', 'MIN', 'HOUR', 'DAY', 'MONTH', 'YEAR']),
          }
        : undefined,
    linkedFeatures: linkedFeatures ?? [],
  };
}

function generatePlan(
  features: { [key: string]: TestFeature },
  usageLimitKeys: { [key: string]: TestUsageLimit }
): TestPlan {
  return {
    description: faker.lorem.sentence(),
    price: faker.number.float({ min: 0, max: 100, multipleOf: 0.1 }),
    private: faker.datatype.boolean({ probability: 0.1 }),
    features: Object.fromEntries(
      Object.keys(features)
        .filter(key => {
          const feature = features[key];
          return feature.value !== undefined && feature.value !== null;
        })
        .map(key => {
          const feature = features[key];
          return [key, feature.value!];
        })
    ),
    usageLimits: Object.fromEntries(
      Object.keys(usageLimitKeys)
        .filter(key => {
          const usageLimit = usageLimitKeys[key];
          return usageLimit.value !== undefined && usageLimit.value !== null;
        })
        .map(key => {
          const usageLimit = usageLimitKeys[key];
          return [key, usageLimit.value!];
        })
    ),
  };
}

function generateAddOn(
  features: TestFeature[],
  usageLimits: TestUsageLimit[],
  usageLimitsExtensions: TestUsageLimit[],
  plans: string[],
  preCreatedAddons: string[]
): TestAddOn {
  const isScalableAddon =
    features.length === 0 && usageLimits.length === 0 && usageLimitsExtensions.length > 0;

  const minQuantity: number | undefined = isScalableAddon
    ? faker.number.int({ min: 1, max: 10 })
    : 1;
  const maxQuantity: number | undefined = isScalableAddon
    ? faker.number.int({ min: minQuantity, max: 10 })
    : 1;

  return {
    description: faker.lorem.sentence(),
    private: faker.datatype.boolean({ probability: 0.1 }),
    price: faker.number.float({ min: 0, max: 100, multipleOf: 0.1 }),
    availableFor: faker.datatype.boolean({ probability: 0.3 })
      ? faker.helpers.arrayElements(plans, faker.number.int({ min: 1, max: plans.length }))
      : plans,
    dependsOn: faker.datatype.boolean({ probability: 0.2 })
      ? faker.helpers.arrayElements(preCreatedAddons, biasedRandomInt(1, 3))
      : [],
    excludes: faker.datatype.boolean({ probability: 0.2 })
      ? faker.helpers.arrayElements(preCreatedAddons, biasedRandomInt(1, 3))
      : [],
    features:
      features.length > 0
        ? Object.fromEntries(
            features.map(feature => {
              const featureValueType = feature.valueType;
              const featureValue =
                featureValueType === 'BOOLEAN' ? faker.datatype.boolean() : faker.word.noun();

              return [feature.name, { value: featureValue }];
            })
          )
        : {},
    usageLimits:
      usageLimits.length > 0
        ? Object.fromEntries(
            usageLimits.map(usageLimit => {
              const usageLimitValueType = usageLimit.valueType;
              const usageLimitValue =
                usageLimitValueType === 'BOOLEAN'
                  ? faker.datatype.boolean()
                  : faker.number.int({ min: 0, max: 100, multipleOf: 10 });

              return [usageLimit.name, { value: usageLimitValue }];
            })
          )
        : {},
    usageLimitsExtensions:
      usageLimitsExtensions.length > 0
        ? Object.fromEntries(
            usageLimitsExtensions.map(usageLimit => {
              return [usageLimit.name, { value: faker.number.int({ min: 1, max: 10 }) }];
            })
          )
        : {},
    subscriptionConstraints: {
      minQuantity: minQuantity,
      maxQuantity: maxQuantity,
      quantityStep: 1,
    },
  };
}

function _generateDefaultValueAndValueBoolean(): [boolean, boolean | undefined] {
  const defaultValue = faker.datatype.boolean();
  const value = defaultValue ? undefined : faker.datatype.boolean() ? true : undefined;
  return [defaultValue, value];
}

function _generateDefaultValueAndValueNumeric(): [number, number | undefined] {
  const defaultValue = faker.datatype.boolean() ? 0 : faker.number.int({ min: 1, max: 100 });
  const value = faker.datatype.boolean()
    ? faker.number.int({ min: defaultValue, max: 100 })
    : undefined;
  return [defaultValue, value];
}

function _generateExpressionsForFeatures(
  features: Record<string, TestFeature>,
  usageLimits: Record<string, TestUsageLimit>
): void {
  Object.keys(features).forEach(key => {
    const feature = features[key];

    if (feature.valueType === 'BOOLEAN') {
      const linkedUsageLimitKeys = Object.entries(usageLimits)
        .filter(
          ([_, usageLimit]) =>
            usageLimit.linkedFeatures?.includes(key) && usageLimit.valueType === 'NUMERIC'
        )
        .map(([limitKey]) => limitKey);

      if (linkedUsageLimitKeys.length === 0) {
        feature.expression = `pricingContext['features']['${key}']`;
        feature.serverExpression = undefined;
      } else {
        const createExpression = (operator: '<' | '<=') => {
          const conditions = linkedUsageLimitKeys
            .map(
              limitKey =>
                `subscriptionContext['${limitKey}'] ${operator} pricingContext['usageLimits']['${limitKey}']`
            )
            .join(' && ');

          return `pricingContext['features']['${key}'] && (${conditions})`;
        };

        feature.expression = createExpression('<');
        feature.serverExpression = createExpression('<=');
      }
    }

    if (feature.valueType === 'TEXT') {
      feature.expression = `pricingContext['features']['${key}'] === pricingContext['features']['${key}']`;
      feature.serverExpression = undefined;
    }
  });
}
