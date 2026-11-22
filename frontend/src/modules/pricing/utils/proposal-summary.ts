import jsYaml from 'js-yaml';
import { diffPricings } from './pricing-diff';
import { summarizeChanges, type ChangeSummary, type SectionChanges } from './change-summary';

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a proposal changes against the version it is based on. SPHERE sets the
 * pricing's name when it merges, so a different `saasName` is not a change.
 * Null when either text is not a YAML mapping.
 */
export function summarizeProposal(baseYaml: string, proposedYaml: string): ChangeSummary | null {
  try {
    const before = jsYaml.load(baseYaml);
    const after = jsYaml.load(proposedYaml);
    if (!isMapping(before) || !isMapping(after)) return null;
    return summarizeChanges(diffPricings(before, after, { ignoreKeys: ['saasName'] }));
  } catch {
    return null;
  }
}

/** The sections a proposal removes entries from: plans, features, add-ons or usage limits. */
export function removalsOf(summary: ChangeSummary): SectionChanges[] {
  return summary.sections.filter(section => section.removed.length > 0);
}
