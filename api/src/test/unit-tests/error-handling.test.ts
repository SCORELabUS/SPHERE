import { describe, expect, it } from 'vitest';
import { handleError } from '../../main/utils/users/helpers';

describe('pricing validation error handling', () => {
  it('returns 400 for dead features instead of an internal server error', () => {
    const result = handleError(new Error('There should not be dead features within the pricing. Found dead features: soundNotifications'));
    expect(result.status).toBe(400);
    expect(result.message).toContain('dead features');
  });

  it('keeps unexpected failures as 500', () => {
    expect(handleError(new Error('database unavailable')).status).toBe(500);
  });
});
