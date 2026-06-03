import jsYaml from 'js-yaml';
import type { PricingDraft, DraftFeature, DraftUsageLimit, DraftPlan, DraftAddOn } from './types';
import { serializeDraftToYaml } from './serializer';
import {
  updateField,
  addPlan,
  removePlan,
  renamePlan,
  toggleFeatureValue,
  setCellValue,
  updatePlanProps,
  updateRenderMode,
  addFeature,
  removeFeature,
  addUsageLimit,
  removeUsageLimit,
} from './mutations';

export type { PricingDraft, DraftFeature, DraftUsageLimit, DraftPlan, DraftAddOn };
export { serializeDraftToYaml };
export {
  updateField,
  addPlan,
  removePlan,
  renamePlan,
  toggleFeatureValue,
  setCellValue,
  updatePlanProps,
  updateRenderMode,
  addFeature,
  removeFeature,
  addUsageLimit,
  removeUsageLimit,
};

export function ensureSyntaxVersion31(yamlStr: string): string {
  const versionRegex = /^syntaxVersion:\s*['"]?([^'"\n\r]+)['"]?$/m;
  const match = yamlStr.match(versionRegex);
  if (!match) return yamlStr.replace(/^(saasName:.*)$/m, '$1\nsyntaxVersion: "3.1"');
  if (match[1] === '3.1') return yamlStr;
  return yamlStr.replace(versionRegex, 'syntaxVersion: "3.1"');
}

export function parseDraftFromYaml(yamlStr: string): PricingDraft {
  const raw = jsYaml.load(yamlStr) as Record<string, unknown>;
  return rawToDraft(raw);
}

function rawToDraft(raw: Record<string, unknown>): PricingDraft {
  const features: Record<string, DraftFeature> = {};
  if (raw.features && typeof raw.features === 'object') {
    for (const [k, v] of Object.entries(raw.features as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const f = v as Record<string, unknown>;
        features[k] = {
          description: f.description as string | undefined,
          tag: f.tag as string | undefined,
          valueType: (f.valueType as string) as DraftFeature['valueType'],
          defaultValue: f.defaultValue as string | number | boolean,
          type: f.type as string,
          expression: f.expression as string | undefined,
          serverExpression: f.serverExpression as string | undefined,
          integrationType: f.integrationType as string | undefined,
          automationType: f.automationType as string | undefined,
          docUrl: f.docUrl as string | undefined,
          pricingUrls: f.pricingUrls as string[] | undefined,
          render: f.render as string | undefined,
        };
      }
    }
  }

  let usageLimits: Record<string, DraftUsageLimit> | null = null;
  if (raw.usageLimits && typeof raw.usageLimits === 'object') {
    usageLimits = {};
    for (const [k, v] of Object.entries(raw.usageLimits as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const u = v as Record<string, unknown>;
        usageLimits[k] = {
          description: u.description as string | undefined,
          valueType: (u.valueType as string) as DraftUsageLimit['valueType'],
          defaultValue: u.defaultValue as string | number | boolean,
          unit: u.unit as string,
          type: (u.type as string) as DraftUsageLimit['type'],
          trackable: u.trackable as boolean | undefined,
          period: u.period as { value: number; unit: string } | undefined,
          linkedFeatures: u.linkedFeatures as string[] | undefined,
          render: u.render as string | undefined,
        };
      }
    }
  }

  const plans: Record<string, DraftPlan> = {};
  if (raw.plans && typeof raw.plans === 'object') {
    for (const [k, v] of Object.entries(raw.plans as Record<string, unknown>)) {
      if (v === null || v === undefined) {
        plans[k] = { price: 0 };
      } else if (typeof v === 'object') {
        const p = v as Record<string, unknown>;
        let features: Record<string, { value: string | number | boolean }> | null = null;
        if (p.features !== null && p.features !== undefined && typeof p.features === 'object') {
          features = {};
          for (const [fk, fv] of Object.entries(p.features as Record<string, unknown>)) {
            if (fv && typeof fv === 'object') {
              const fObj = fv as Record<string, unknown>;
              features[fk] = { value: fObj.value as string | number | boolean };
            } else if (fv !== null && fv !== undefined) {
              features[fk] = { value: fv as string | number | boolean };
            }
          }
        }
        let usageLimitsOverrides: Record<string, { value: string | number | boolean }> | null = null;
        if (p.usageLimits !== null && p.usageLimits !== undefined && typeof p.usageLimits === 'object') {
          usageLimitsOverrides = {};
          for (const [uk, uv] of Object.entries(p.usageLimits as Record<string, unknown>)) {
            if (uv && typeof uv === 'object') {
              const uObj = uv as Record<string, unknown>;
              usageLimitsOverrides[uk] = { value: uObj.value as string | number | boolean };
            } else if (uv !== null && uv !== undefined) {
              usageLimitsOverrides[uk] = { value: uv as string | number | boolean };
            }
          }
        }
        plans[k] = {
          description: p.description as string | undefined,
          price: p.price as number | string,
          unit: p.unit as string | undefined,
          private: p.private as boolean | undefined,
          features,
          usageLimits: usageLimitsOverrides,
        };
      }
    }
  }

  let addOns: Record<string, DraftAddOn> | null = null;
  if (raw.addOns && typeof raw.addOns === 'object') {
    addOns = {};
    for (const [k, v] of Object.entries(raw.addOns as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const a = v as Record<string, unknown>;
        let features: Record<string, { value: string | number | boolean }> | undefined;
        if (a.features && typeof a.features === 'object') {
          features = {};
          for (const [fk, fv] of Object.entries(a.features as Record<string, unknown>)) {
            if (fv && typeof fv === 'object') {
              features[fk] = { value: (fv as Record<string, unknown>).value as string | number | boolean };
            } else if (fv !== null && fv !== undefined) {
              features[fk] = { value: fv as string | number | boolean };
            }
          }
        }
        let usageLimits: Record<string, { value: string | number | boolean }> | undefined;
        if (a.usageLimits && typeof a.usageLimits === 'object') {
          usageLimits = {};
          for (const [uk, uv] of Object.entries(a.usageLimits as Record<string, unknown>)) {
            if (uv && typeof uv === 'object') {
              usageLimits[uk] = { value: (uv as Record<string, unknown>).value as string | number | boolean };
            } else if (uv !== null && uv !== undefined) {
              usageLimits[uk] = { value: uv as string | number | boolean };
            }
          }
        }
        let usageLimitsExtensions: Record<string, { value: string | number | boolean }> | undefined;
        if (a.usageLimitsExtensions && typeof a.usageLimitsExtensions === 'object') {
          usageLimitsExtensions = {};
          for (const [uk, uv] of Object.entries(a.usageLimitsExtensions as Record<string, unknown>)) {
            if (uv && typeof uv === 'object') {
              usageLimitsExtensions[uk] = { value: (uv as Record<string, unknown>).value as string | number | boolean };
            } else if (uv !== null && uv !== undefined) {
              usageLimitsExtensions[uk] = { value: uv as string | number | boolean };
            }
          }
        }
        addOns[k] = {
          description: a.description as string | undefined,
          price: a.price as number | string,
          unit: a.unit as string | undefined,
          availableFor: a.availableFor as string[] | undefined,
          dependsOn: a.dependsOn as string[] | undefined,
          excludes: a.excludes as string[] | undefined,
          private: a.private as boolean | undefined,
          subscriptionConstraints: a.subscriptionConstraints as { min: number; max: number; step: number } | undefined,
          features,
          usageLimits,
          usageLimitsExtensions,
        };
      }
    }
  }

  return {
    saasName: (raw.saasName as string) ?? 'Untitled',
    syntaxVersion: '3.1',
    version: raw.version as string | undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : raw.createdAt instanceof Date ? raw.createdAt.toISOString().split('T')[0] : undefined,
    url: raw.url as string | undefined,
    tags: raw.tags as string[] | undefined,
    currency: raw.currency as string | undefined,
    billing: raw.billing as Record<string, number> | undefined,
    variables: raw.variables as Record<string, unknown> | undefined,
    features,
    usageLimits,
    plans,
    addOns,
    custom: raw.custom as Record<string, unknown> | undefined,
  };
}
