import { describe, it, expect } from 'vitest';
import { compareVersionsNewestFirst } from '../../main/utils/version-order';

describe('compareVersionsNewestFirst', () => {
  const day = '2026-03-01T00:00:00.000Z';

  it('puts the later addedAt first even when its release date is older', () => {
    const older = { createdAt: '2026-02-01T00:00:00.000Z', addedAt: '2026-11-06T12:00:00.000Z', id: 'b' };
    const newer = { createdAt: day, addedAt: '2026-11-01T12:00:00.000Z', id: 'a' };
    expect([older, newer].sort(compareVersionsNewestFirst)).toEqual([older, newer]);
  });

  it('breaks a createdAt tie with the version added to SPHERE last', () => {
    const first = { createdAt: day, addedAt: '2026-11-06T10:00:00.000Z', id: 'z' };
    const second = { createdAt: day, addedAt: '2026-11-06T10:00:00.001Z', id: 'a' };
    expect([first, second].sort(compareVersionsNewestFirst)).toEqual([second, first]);
  });

  it('falls back to the id, and puts versions without addedAt behind those with one', () => {
    const legacy = { createdAt: day, id: 'f' };
    const sameInstantA = { createdAt: day, addedAt: day, _id: '6a0000000000000000000001' };
    const sameInstantB = { createdAt: day, addedAt: day, _id: '6a0000000000000000000002' };
    expect([legacy, sameInstantA, sameInstantB].sort(compareVersionsNewestFirst)).toEqual([
      sameInstantB,
      sameInstantA,
      legacy,
    ]);
  });
});
