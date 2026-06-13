import type { PricingDraft, DraftPlan, DraftFeature, DraftUsageLimit, DraftAddOn } from './types';

function q(s: string): string {
  if (/[:{}[\],&*?|>!%@`#\-\s]/.test(s) || s === '' || s === 'null' || /^['"]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => l.length > 0 ? pad + l : l).join('\n');
}

function serVal(v: unknown, n: number): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v);
  if (typeof v === 'string') return q(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map(i => `${' '.repeat(n)}- ${serVal(i, n + 2)}`).join('\n');
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return '\n' + entries.map(([k, val]) => `${' '.repeat(n)}${q(k)}: ${serVal(val, n + 2)}`).join('\n');
  }
  return String(v);
}

function serMap(m: Record<string, unknown> | undefined | null, n: number, forceNull = false): string {
  if (m === null) return 'null';
  if (m === undefined) return '';
  const entries = Object.entries(m);
  if (entries.length === 0 && !forceNull) return 'null';
  if (entries.length === 0) return 'null';
  return '\n' + entries.map(([k, v]) => {
    const key = q(k);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (Object.keys(obj).length === 1 && 'value' in obj) {
        return `${' '.repeat(n)}${key}:\n${' '.repeat(n + 2)}value: ${serVal(obj.value, n + 4)}`;
      }
      return `${' '.repeat(n)}${key}:${indent(serVal(v, n + 2), n)}`;
    }
    return `${' '.repeat(n)}${key}: ${serVal(v, n + 2)}`;
  }).join('\n');
}

function serFeatureBlock(f: DraftFeature, n: number): string {
  const lines: string[] = [];
  if (f.description !== undefined) lines.push(`${' '.repeat(n)}description: ${serVal(f.description, n + 2)}`);
  if (f.tag !== undefined) lines.push(`${' '.repeat(n)}tag: ${serVal(f.tag, n + 2)}`);
  lines.push(`${' '.repeat(n)}valueType: ${f.valueType}`);
  lines.push(`${' '.repeat(n)}defaultValue: ${serVal(f.defaultValue, n + 2)}`);
  if (f.expression !== undefined) lines.push(`${' '.repeat(n)}expression: ${serVal(f.expression, n + 2)}`);
  if (f.serverExpression !== undefined) lines.push(`${' '.repeat(n)}serverExpression: ${serVal(f.serverExpression, n + 2)}`);
  lines.push(`${' '.repeat(n)}type: ${f.type}`);
  if (f.integrationType !== undefined) lines.push(`${' '.repeat(n)}integrationType: ${f.integrationType}`);
  if (f.automationType !== undefined) lines.push(`${' '.repeat(n)}automationType: ${f.automationType}`);
  if (f.docUrl !== undefined) lines.push(`${' '.repeat(n)}docUrl: ${serVal(f.docUrl, n + 2)}`);
  if (f.pricingUrls !== undefined && f.pricingUrls.length > 0) {
    lines.push(`${' '.repeat(n)}pricingUrls:`);
    f.pricingUrls.forEach(u => lines.push(`${' '.repeat(n + 2)}- ${serVal(u, n + 4)}`));
  }
  if (f.render !== undefined) lines.push(`${' '.repeat(n)}render: ${f.render}`);
  return lines.join('\n');
}

function serUsageLimitBlock(u: DraftUsageLimit, n: number): string {
  const lines: string[] = [];
  if (u.description !== undefined) lines.push(`${' '.repeat(n)}description: ${serVal(u.description, n + 2)}`);
  lines.push(`${' '.repeat(n)}valueType: ${u.valueType}`);
  lines.push(`${' '.repeat(n)}defaultValue: ${serVal(u.defaultValue, n + 2)}`);
  lines.push(`${' '.repeat(n)}unit: ${serVal(u.unit, n + 2)}`);
  lines.push(`${' '.repeat(n)}type: ${u.type}`);
  if (u.trackable !== undefined) lines.push(`${' '.repeat(n)}trackable: ${u.trackable ? 'true' : 'false'}`);
  if (u.period !== undefined) {
    lines.push(`${' '.repeat(n)}period:`);
    lines.push(`${' '.repeat(n + 2)}value: ${u.period.value}`);
    lines.push(`${' '.repeat(n + 2)}unit: ${u.period.unit}`);
  }
  if (u.linkedFeatures !== undefined && u.linkedFeatures.length > 0) {
    lines.push(`${' '.repeat(n)}linkedFeatures:`);
    u.linkedFeatures.forEach(f => lines.push(`${' '.repeat(n + 2)}- ${serVal(f, n + 4)}`));
  }
  if (u.render !== undefined) lines.push(`${' '.repeat(n)}render: ${u.render}`);
  return lines.join('\n');
}

function serPlanBlock(p: DraftPlan, n: number): string {
  const lines: string[] = [];
  if (p.description !== undefined) lines.push(`${' '.repeat(n)}description: ${serVal(p.description, n + 2)}`);
  lines.push(`${' '.repeat(n)}price: ${serVal(p.price, n + 2)}`);
  if (p.unit !== undefined) lines.push(`${' '.repeat(n)}unit: ${serVal(p.unit, n + 2)}`);
  if (p.private !== undefined) lines.push(`${' '.repeat(n)}private: ${p.private ? 'true' : 'false'}`);
  if (p.features !== undefined && p.features !== null) {
    const entries = Object.entries(p.features);
    if (entries.length === 0) {
      lines.push(`${' '.repeat(n)}features: null`);
    } else {
      lines.push(`${' '.repeat(n)}features:`);
      entries.forEach(([k, v]) => {
        lines.push(`${' '.repeat(n + 2)}${q(k)}:`);
        lines.push(`${' '.repeat(n + 4)}value: ${serVal(v.value, n + 6)}`);
      });
    }
  } else {
    lines.push(`${' '.repeat(n)}features: null`);
  }
  if (p.usageLimits !== undefined && p.usageLimits !== null) {
    const entries = Object.entries(p.usageLimits);
    if (entries.length === 0) {
      lines.push(`${' '.repeat(n)}usageLimits: null`);
    } else {
      lines.push(`${' '.repeat(n)}usageLimits:`);
      entries.forEach(([k, v]) => {
        lines.push(`${' '.repeat(n + 2)}${q(k)}:`);
        lines.push(`${' '.repeat(n + 4)}value: ${serVal(v.value, n + 6)}`);
      });
    }
  } else {
    lines.push(`${' '.repeat(n)}usageLimits: null`);
  }
  return lines.join('\n');
}

function serAddOnBlock(a: DraftAddOn, n: number): string {
  const lines: string[] = [];
  if (a.description !== undefined) lines.push(`${' '.repeat(n)}description: ${serVal(a.description, n + 2)}`);
  if (a.availableFor !== undefined && a.availableFor.length > 0) {
    lines.push(`${' '.repeat(n)}availableFor:`);
    a.availableFor.forEach(p => lines.push(`${' '.repeat(n + 2)}- ${serVal(p, n + 4)}`));
  }
  if (a.dependsOn !== undefined && a.dependsOn.length > 0) {
    lines.push(`${' '.repeat(n)}dependsOn:`);
    a.dependsOn.forEach(d => lines.push(`${' '.repeat(n + 2)}- ${serVal(d, n + 4)}`));
  }
  if (a.excludes !== undefined && a.excludes.length > 0) {
    lines.push(`${' '.repeat(n)}excludes:`);
    a.excludes.forEach(e => lines.push(`${' '.repeat(n + 2)}- ${serVal(e, n + 4)}`));
  }
  if (a.private !== undefined) lines.push(`${' '.repeat(n)}private: ${a.private ? 'true' : 'false'}`);
  lines.push(`${' '.repeat(n)}price: ${serVal(a.price, n + 2)}`);
  if (a.unit !== undefined) lines.push(`${' '.repeat(n)}unit: ${serVal(a.unit, n + 2)}`);
  if (a.subscriptionConstraints !== undefined) {
    const sc = a.subscriptionConstraints;
    lines.push(`${' '.repeat(n)}subscriptionConstraints:`);
    lines.push(`${' '.repeat(n + 2)}min: ${sc.min}`);
    lines.push(`${' '.repeat(n + 2)}max: ${sc.max}`);
    lines.push(`${' '.repeat(n + 2)}step: ${sc.step}`);
  }
  if (a.features !== undefined && Object.keys(a.features).length > 0) {
    lines.push(`${' '.repeat(n)}features:`);
    Object.entries(a.features).forEach(([k, v]) => {
      lines.push(`${' '.repeat(n + 2)}${q(k)}:`);
      lines.push(`${' '.repeat(n + 4)}value: ${serVal(v.value, n + 6)}`);
    });
  }
  if (a.usageLimits !== undefined && Object.keys(a.usageLimits).length > 0) {
    lines.push(`${' '.repeat(n)}usageLimits:`);
    Object.entries(a.usageLimits).forEach(([k, v]) => {
      lines.push(`${' '.repeat(n + 2)}${q(k)}:`);
      lines.push(`${' '.repeat(n + 4)}value: ${serVal(v.value, n + 6)}`);
    });
  }
  if (a.usageLimitsExtensions !== undefined && Object.keys(a.usageLimitsExtensions).length > 0) {
    lines.push(`${' '.repeat(n)}usageLimitsExtensions:`);
    Object.entries(a.usageLimitsExtensions).forEach(([k, v]) => {
      lines.push(`${' '.repeat(n + 2)}${q(k)}:`);
      lines.push(`${' '.repeat(n + 4)}value: ${serVal(v.value, n + 6)}`);
    });
  }
  return lines.join('\n');
}

export function serializeDraftToYaml(d: PricingDraft): string {
  const lines: string[] = [];
  const n = 2;

  lines.push(`saasName: ${q(d.saasName)}`);
  lines.push(`syntaxVersion: "${d.syntaxVersion}"`);
  if (d.version !== undefined) lines.push(`version: ${q(d.version)}`);
  if (d.createdAt !== undefined) lines.push(`createdAt: ${q(d.createdAt)}`);
  if (d.url !== undefined) lines.push(`url: ${q(d.url)}`);
  if (d.tags !== undefined && d.tags.length > 0) {
    lines.push('tags:');
    d.tags.forEach(t => lines.push(`${' '.repeat(n)}- ${q(t)}`));
  }
  if (d.currency !== undefined) lines.push(`currency: ${d.currency}`);
  if (d.billing !== undefined && Object.keys(d.billing).length > 0) {
    lines.push('billing:');
    Object.entries(d.billing).forEach(([k, v]) => lines.push(`${' '.repeat(n)}${k}: ${v}`));
  }
  if (d.variables !== undefined && Object.keys(d.variables).length > 0) {
    lines.push('variables:');
    Object.entries(d.variables).forEach(([k, v]) => lines.push(`${' '.repeat(n)}${q(k)}: ${serVal(v, n + 2)}`));
  }

  const featureKeys = Object.keys(d.features);
  if (featureKeys.length > 0) {
    lines.push('features:');
    featureKeys.forEach(k => {
      lines.push(`${' '.repeat(n)}${q(k)}:`);
      lines.push(serFeatureBlock(d.features[k], n + 2));
    });
  } else {
    lines.push('features: null');
  }

  if (d.usageLimits !== null && d.usageLimits !== undefined) {
    const ulKeys = Object.keys(d.usageLimits);
    if (ulKeys.length > 0) {
      lines.push('usageLimits:');
      ulKeys.forEach(k => {
        lines.push(`${' '.repeat(n)}${q(k)}:`);
        lines.push(serUsageLimitBlock(d.usageLimits![k], n + 2));
      });
    } else {
      lines.push('usageLimits: null');
    }
  } else {
    lines.push('usageLimits: null');
  }

  const planKeys = Object.keys(d.plans);
  if (planKeys.length > 0) {
    lines.push('plans:');
    planKeys.forEach(k => {
      lines.push(`${' '.repeat(n)}${q(k)}:`);
      lines.push(serPlanBlock(d.plans[k], n + 2));
    });
  } else {
    lines.push('plans: null');
  }

  if (d.addOns !== null && d.addOns !== undefined) {
    const aoKeys = Object.keys(d.addOns);
    if (aoKeys.length > 0) {
      lines.push('addOns:');
      aoKeys.forEach(k => {
        lines.push(`${' '.repeat(n)}${q(k)}:`);
        lines.push(serAddOnBlock(d.addOns![k], n + 2));
      });
    } else {
      lines.push('addOns: null');
    }
  } else {
    lines.push('addOns: null');
  }

  if (d.custom !== undefined && Object.keys(d.custom).length > 0) {
    lines.push(`custom:${serMap(d.custom, n)}`);
  }

  return lines.join('\n') + '\n';
}
