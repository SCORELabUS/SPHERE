import { describe, expect, it } from 'vitest';
import { up } from '../../main/migrations/mongo/20260614204900-collection-slug';

describe('collection slug migration', () => {
  it('preserves an existing organization reference from imported collections', async () => {
    const organizationId = '63f74bf8eeed64058364b601';
    const collection = {
      _id: '6787d0facaeb2b25748bc12a',
      name: 'IEEE TSC 2025',
      _organizationId: organizationId,
    };
    let update: any;

    const db = {
      collection(name: string) {
        if (name === 'organizations') {
          return { find: () => ({ toArray: async () => [{ _id: organizationId, name: 'demo-org' }] }) };
        }
        return {
          find: () => ({
            sort: () => ({ toArray: async () => [collection] }),
          }),
          updateOne: async (_filter: unknown, value: unknown) => { update = value; },
        };
      },
    };

    await up(db as any);

    expect(update.$set._organizationId).toBe(organizationId);
    expect(update.$set.slug).toBe('ieee-tsc-2025');
  });
});
