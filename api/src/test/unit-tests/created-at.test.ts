import { describe, it, expect } from 'vitest';
import { formatCreatedAt, stampCreatedAt } from '../../main/utils/created-at';

describe('formatCreatedAt', () => {
  it('writes a plain date when the instant is exactly UTC midnight', () => {
    expect(formatCreatedAt(new Date('2025-05-25T00:00:00.000Z'))).toBe('2025-05-25');
  });

  it('writes the full UTC date-time when there is a time of day', () => {
    expect(formatCreatedAt(new Date('2025-05-25T14:30:15.250Z'))).toBe('2025-05-25T14:30:15.250Z');
  });
});

describe('stampCreatedAt', () => {
  const instant = new Date('2025-05-25T14:30:00.000Z');

  it('replaces the top-level createdAt and leaves the rest untouched', () => {
    const yaml = 'saasName: Demo\n# keep me\nversion: "1.0.0"\ncreatedAt: "2024-01-01"\ncurrency: USD\n';
    expect(stampCreatedAt(yaml, instant)).toBe(
      'saasName: Demo\n# keep me\nversion: "1.0.0"\ncreatedAt: "2025-05-25T14:30:00.000Z"\ncurrency: USD\n'
    );
  });

  it('does not touch nested keys that happen to be called createdAt', () => {
    const yaml = 'saasName: Demo\ncreatedAt: 2024-01-01\nfeatures:\n  x:\n    createdAt: nested\n';
    const stamped = stampCreatedAt(yaml, instant);
    expect(stamped).toContain('createdAt: "2025-05-25T14:30:00.000Z"');
    expect(stamped).toContain('    createdAt: nested');
  });

  it('inserts it after saasName when absent', () => {
    expect(stampCreatedAt('saasName: Demo\ncurrency: USD\n', instant)).toBe(
      'saasName: Demo\ncreatedAt: "2025-05-25T14:30:00.000Z"\ncurrency: USD\n'
    );
  });
});
