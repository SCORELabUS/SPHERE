/** Labels compared as people read them: "2024-10" after "2024-9", "v10" after "v9", case and accents aside. */
const labels = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The longest label a merge may publish (`PricingPullRequestValidation`). */
export const MAX_MERGE_LABEL_LENGTH = 100;

/**
 * The label a merge suggests for the version it publishes, given the latest
 * public version (never a private one: its label would be published with the
 * result). It is the proposal's own, unless a public version was published
 * after the proposal's base (`behind`) and the proposal's label reads as older
 * than it ("2024-07-pr7" once "2024-08" is out): then it is the latest label
 * with the pull request's number ("2024-08-pr7"), which follows it. A label the
 * latest one already ends with ("3.0-pr5") gives way to this number when that
 * still follows it ("3.0-pr6"), so suffixes do not pile up. The latest label
 * itself stays, so the maintainer is told it is taken; one that only differs
 * from it in case or accents ("V1" after "v1") reads as older.
 */
export function suggestMergeLabel(proposal: string, latest: string, number: number, behind: boolean): string {
  if (!behind || proposal === latest || labels.compare(proposal, latest) > 0) return proposal;
  const root = latest.replace(/-pr\d+$/, '');
  const candidates = [`${root}-pr${number}`, `${latest}-pr${number}`];
  return (
    candidates.find(candidate => candidate.length <= MAX_MERGE_LABEL_LENGTH && labels.compare(candidate, latest) > 0) ?? proposal
  );
}
