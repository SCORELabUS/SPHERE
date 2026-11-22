import { describe, expect, it } from 'vitest';
import { MAX_MERGE_LABEL_LENGTH, suggestMergeLabel } from '../../main/utils/pull-request-label';

describe('The label a merge suggests', () => {
  it('Is the proposal\'s own while the pull request starts from the latest version.', () => {
    expect(suggestMergeLabel('1.0.0', '2.0.0', 7, false)).toBe('1.0.0');
    expect(suggestMergeLabel('', '2.0.0', 7, false)).toBe('');
  });

  it('Follows the latest version when one was published after the base and the proposal\'s label reads as older.', () => {
    expect(suggestMergeLabel('2024-07-pr7', '2024-08', 7, true)).toBe('2024-08-pr7');
    expect(suggestMergeLabel('2.9.0', '2.10.0', 12, true)).toBe('2.10.0-pr12');
    expect(suggestMergeLabel('v9', 'V10', 3, true)).toBe('V10-pr3');
    expect(suggestMergeLabel('', '3.0', 4, true)).toBe('3.0-pr4');
  });

  it('Keeps the proposal\'s label when it reads as newer, or is the latest one (which the maintainer is told is taken).', () => {
    expect(suggestMergeLabel('2024-09', '2024-08', 7, true)).toBe('2024-09');
    expect(suggestMergeLabel('2.10.0', '2.9.0', 7, true)).toBe('2.10.0');
    expect(suggestMergeLabel('Spring launch', '2024-08', 7, true)).toBe('Spring launch');
    expect(suggestMergeLabel('2024-08', '2024-08', 7, true)).toBe('2024-08');
  });

  it('Treats a label that only differs from the latest one in case or accents as older, since it is not taken.', () => {
    expect(suggestMergeLabel('v1', 'V1', 7, true)).toBe('V1-pr7');
    expect(suggestMergeLabel('resume', 'résumé', 7, true)).toBe('résumé-pr7');
  });

  it('Does not stack the suffix of an earlier merge when this number still follows it.', () => {
    expect(suggestMergeLabel('3.0', '3.0-pr5', 6, true)).toBe('3.0-pr6');
    // "2024-08-pr6" would read as older than "2024-08-pr7": the suffix is added instead.
    expect(suggestMergeLabel('2024-07-pr3', '2024-08-pr7', 6, true)).toBe('2024-08-pr7-pr6');
  });

  it('Never suggests a label longer than a merge may publish.', () => {
    const latest = '9'.repeat(MAX_MERGE_LABEL_LENGTH - 2);
    expect(suggestMergeLabel('1', latest, 7, true)).toBe('1');
    expect(suggestMergeLabel('1', '9'.repeat(MAX_MERGE_LABEL_LENGTH - 4), 7, true)).toHaveLength(MAX_MERGE_LABEL_LENGTH);
  });
});
