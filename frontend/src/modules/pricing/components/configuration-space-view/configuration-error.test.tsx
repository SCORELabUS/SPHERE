import { describe, expect, it } from 'vitest';
import { configurationErrorMessage } from './index';

describe('configuration space errors', () => {
  it('explains why dead features prevent calculation and how to fix them', () => {
    const message = configurationErrorMessage(new Error('DeadFeatureError: There should not be dead features'));
    expect(message).toContain('not included in any plan or add-on');
    expect(message).toContain('remove them from the pricing');
  });
  it('does not misdiagnose other failures as dead features', () => {
    expect(configurationErrorMessage(new Error('connection failed'))).not.toContain('not included');
  });
});
