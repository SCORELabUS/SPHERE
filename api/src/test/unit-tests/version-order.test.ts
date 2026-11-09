import { describe, it, expect } from 'vitest';
import { compareVersionsNewestFirst, VERSION_ITEM_ORDER, VERSION_ORDER } from '../../main/utils/version-order';

describe('compareVersionsNewestFirst', () => {
  const day = '2026-03-01T00:00:00.000Z';

  it('puts the later release date first even when SPHERE received it earlier', () => {
    const older = { createdAt: '2026-02-01T00:00:00.000Z', addedAt: '2026-11-06T12:00:00.000Z', id: 'b' };
    const newer = { createdAt: day, addedAt: '2026-11-01T12:00:00.000Z', id: 'a' };
    expect([older, newer].sort(compareVersionsNewestFirst)).toEqual([newer, older]);
  });

  it('compares release dates as instants: a time on a day comes after the day alone', () => {
    const dayOnly = { createdAt: new Date('2026-03-01'), addedAt: '2026-11-06T12:00:00.000Z', id: 'b' };
    const withTime = { createdAt: new Date('2026-03-01T10:00:00Z'), addedAt: '2026-11-01T12:00:00.000Z', id: 'a' };
    expect([dayOnly, withTime].sort(compareVersionsNewestFirst)).toEqual([withTime, dayOnly]);
  });

  it('reads release dates stored as text and as dates alike, and puts a missing one last', () => {
    const asText = { createdAt: '2024-07-02T00:00:00.000Z', addedAt: day, id: 'a' };
    const asDate = { createdAt: new Date('2022-01-01T00:00:00.000Z'), addedAt: day, id: 'b' };
    const missing = { addedAt: '2026-11-09T00:00:00.000Z', id: 'c' };
    expect([missing, asDate, asText].sort(compareVersionsNewestFirst)).toEqual([asText, asDate, missing]);
  });

  it('gives MongoDB the same keys in the same order', () => {
    expect(VERSION_ORDER).toEqual({ createdAt: -1, addedAt: -1, _id: -1 });
    expect(Object.keys(VERSION_ORDER)).toEqual(['createdAt', 'addedAt', '_id']);
    expect(Object.keys(VERSION_ITEM_ORDER)).toEqual(['createdAt', 'addedAt', 'id']);
    expect(Object.values(VERSION_ITEM_ORDER)).toEqual([-1, -1, -1]);
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
