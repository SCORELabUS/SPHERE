import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/config/container', () => ({
  // Every collaborator the tests need is replaced on the service itself.
  default: { resolve: vi.fn(() => ({})) },
}));
vi.mock('pricing4ts/server', async importOriginal => {
  const actual = await importOriginal<typeof import('pricing4ts/server')>();
  // Counted: parsing a large pricing is what a pull request costs most.
  return { ...actual, retrievePricingFromText: vi.fn(actual.retrievePricingFromText) };
});
vi.mock('../../main/utils/pricing-syntax', async importOriginal => {
  const actual = await importOriginal<typeof import('../../main/utils/pricing-syntax')>();
  // Counted where other modules load a text (stamping, the service), not inside pricing-syntax itself.
  return {
    ...actual,
    loadPricingDoc: vi.fn(actual.loadPricingDoc),
    normalizeProposalText: vi.fn(actual.normalizeProposalText),
  };
});

import { retrievePricingFromText } from 'pricing4ts/server';
import PricingPullRequestService from '../../main/services/PricingPullRequestService';
import { LeanUser } from '../../main/types/models/User';
import {
  dumpPricingDoc,
  loadPricingDoc,
  normalizeProposalText,
  STORED_PRICING_MAX_BYTES,
  upgradeToLatestSyntax,
} from '../../main/utils/pricing-syntax';

const NAME = 'Petclinic parses';
/** A pricing in an older syntax (3.0). */
const TEMPLATE_TEXT = fs.readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8');
const TEMPLATE = upgradeToLatestSyntax(loadPricingDoc(TEMPLATE_TEXT, STORED_PRICING_MAX_BYTES)).doc;

function pricingText(name: string, version: string, goldPrice?: number) {
  const doc: any = structuredClone(TEMPLATE);
  doc.saasName = name;
  doc.version = version;
  doc.createdAt = '2024-01-01';
  if (goldPrice !== undefined) doc.plans.GOLD.price = goldPrice;
  return dumpPricingDoc(doc);
}

const parses = vi.mocked(retrievePricingFromText);
const stampLoads = vi.mocked(loadPricingDoc);
const normalizes = vi.mocked(normalizeProposalText);

/**
 * The service with its repositories and permission checks replaced: P has v1 and
 * v2, both public. `newService` gives another instance (empty caches) on the same data.
 */
function scene(v1Text = pricingText(NAME, '1.0')) {
  const v1 = { id: 'v1', version: '1.0', private: false, yaml: 'v1.yml' };
  const v2 = { id: 'v2', version: '2.0', private: false, yaml: 'v2.yml' };
  const files: Record<string, string> = { v1: v1Text, v2: pricingText(NAME, '2.0', 30) };
  const pricing = { pricingId: 'p1', name: NAME, slug: 'petclinic-parses', organizationId: 'o1', latest: v1, latestPublic: v1 };
  const user = { id: 'author', username: 'author', role: 'USER' } as unknown as LeanUser;
  const viewer = { user, reader: true, readsPrivate: true, maintainer: true };
  let stored: any;
  const newService = () => {
    const service: any = new PricingPullRequestService();
    return Object.assign(service, {
      findPricing: async () => pricing,
      viewerOf: async () => viewer,
      limitReached: async () => false,
      announce: async () => undefined,
      authorsOf: async () => new Map(),
      readStored: async (version: { id: string }) => ({ raw: files[version.id], ...service.loadStored(files[version.id]) }),
      loadPullRequest: async () => ({ pullRequest: stored, pricing, viewer }),
      pricingRepository: {
        findVersionOf: async (_pricingId: string, id: string) => [v1, v2].find(version => version.id === id) ?? null,
        hasVersionLabel: async () => false,
      },
      pricingPullRequestRepository: {
        create: async (data: any) =>
          (stored = { id: 'pr1', number: 1, status: 'open', proposalRevision: 1, createdAt: new Date(), updatedAt: new Date(), ...data }),
        updateOpen: async (_id: string, _revision: number, changes: any) =>
          (stored = { ...stored, ...changes, proposalRevision: stored.proposalRevision + 1 }),
      },
    });
  };
  const service = newService();
  const open = (proposedYaml: string) =>
    service.create(user, { title: 'Gold up', source: { kind: 'text', pricingId: 'p1', baseVersionId: 'v1', proposedYaml } });
  /** P moves on to v2, leaving the pull request behind. */
  const publishV2 = () => Object.assign(pricing, { latest: v2, latestPublic: v2 });
  return { service, newService, user, open, publishV2, stored: () => stored };
}

describe('Pull request proposals are parsed once', () => {
  beforeEach(() => {
    parses.mockClear();
    stampLoads.mockClear();
  });

  it('parses a proposal that carries the name of the pricing once, and stores it as written', async () => {
    const { open, stored } = scene();
    const proposal = `# Gold goes up\n${pricingText(NAME, '1.1', 25)}`;

    const created = await open(proposal);

    expect(parses).toHaveBeenCalledTimes(1);
    // Stamping loads only the stamped text: the proposal was loaded already.
    expect(stampLoads).toHaveBeenCalledTimes(1);
    expect(created.warnings).toEqual([]);
    expect(stored().proposed).toEqual({ yaml: proposal.replace(`saasName: ${NAME}`, `saasName: "${NAME}"`), suggestedVersion: '1.1' });
  });

  it('parses a proposal with another name once, as it is stored: with the name of the pricing', async () => {
    const { open, stored } = scene();

    await open(pricingText('Somebody else', '1.1', 25));

    // Only the text as stored is parsed, not the text as sent.
    expect(parses).toHaveBeenCalledTimes(1);
    expect(loadPricingDoc(parses.mock.calls[0][0], STORED_PRICING_MAX_BYTES).saasName).toBe(NAME);
    expect(loadPricingDoc(stored().proposed.yaml, STORED_PRICING_MAX_BYTES).saasName).toBe(NAME);
    expect(stored().proposed.suggestedVersion).toBe('1.1');
  });

  it('accepts a proposal whose only fault is its own name, with the name of the pricing', async () => {
    const { open, stored } = scene();
    const nameless = pricingText(NAME, '1.1', 25).replace(`saasName: ${NAME}\n`, '');
    expect(() => retrievePricingFromText(nameless)).toThrow('The SaaS must have a name');
    parses.mockClear();

    await open(nameless);

    expect(parses).toHaveBeenCalledTimes(1);
    expect(stored().proposed.yaml).toBe(`saasName: "${NAME}"\n${nameless}`);
  });

  it('refuses a proposal the parser rejects with its message, parsing it once', async () => {
    const { open } = scene();
    const invalid = pricingText('Somebody else', '1.1', 25).replace('type: DOMAIN', 'type: NOT_A_TYPE');
    let expected = '';
    try {
      retrievePricingFromText(invalid);
    } catch (error) {
      expected = (error as Error).message;
    }
    expect(expected).not.toBe('');
    parses.mockClear();

    await expect(open(invalid)).rejects.toMatchObject({ status: 400, code: 'INVALID_PRICING', message: expected, details: {} });
    expect(parses).toHaveBeenCalledTimes(1);
  });

  it('refuses a proposal that is not YAML with its line, parsing nothing', async () => {
    const { open } = scene();
    const lines = pricingText('Somebody else', '1.1', 25).split('\n');
    lines.splice(4, 0, 'key: value: other');

    await expect(open(lines.join('\n'))).rejects.toMatchObject({ status: 400, code: 'INVALID_PRICING', line: 5 });
    expect(parses).not.toHaveBeenCalled();
  });

  it('shows a result the parser rejects as stamped, parsing it once', async () => {
    const { service, user } = scene();
    const invalid = `# Gold goes up\n${pricingText('Somebody else', '1.1', 25).replace('type: DOMAIN', 'type: NOT_A_TYPE')}`;

    const preview = await service.preview(user, { source: { kind: 'text', pricingId: 'p1', baseVersionId: 'v1', proposedYaml: invalid } });

    expect(parses).toHaveBeenCalledTimes(1);
    expect(preview.validation).toMatchObject({ ok: false });
    expect(preview.warnings).toEqual([]);
    // Written line by line, comment included, with the name of the pricing.
    expect(preview).toMatchObject({ regenerated: false });
    expect(preview.resultYaml).toBe(invalid.replace('saasName: Somebody else', `saasName: "${NAME}"`));
  });

  it('parses the result of a preview once', async () => {
    const { service, user } = scene();

    const preview = await service.preview(user, {
      source: { kind: 'text', pricingId: 'p1', baseVersionId: 'v1', proposedYaml: pricingText(NAME, '1.1', 25) },
    });

    expect(parses).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({ outcome: 'proposal-only', validation: { ok: true }, suggestedVersion: '1.1' });
  });

  it('parses a result typed by hand once, and a merge preview once', async () => {
    const { service, user, open, publishV2, stored } = scene();
    await open(pricingText(NAME, '1.1', 25));
    publishV2();

    parses.mockClear();
    const preview = await service.mergePreview(user, 'pr1', { purpose: 'update' });
    expect(parses).toHaveBeenCalledTimes(1);
    expect(preview.conflicts).toHaveLength(1);

    parses.mockClear();
    const manualYaml = pricingText(NAME, '2.1', 40);
    await service.update(user, 'pr1', { previewToken: preview.previewToken, manualYaml });
    expect(parses).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ base: { versionId: 'v2' }, proposed: { suggestedVersion: '2.1' } });
  });

  it('parses a result typed by hand with another name once, and refuses an invalid one parsing it once', async () => {
    const { service, user, open, publishV2, stored } = scene();
    await open(pricingText(NAME, '1.1', 25));
    publishV2();
    const preview = await service.mergePreview(user, 'pr1', { purpose: 'update' });
    const manualYaml = pricingText('Somebody else', '2.1', 40);

    parses.mockClear();
    await expect(
      service.update(user, 'pr1', { previewToken: preview.previewToken, manualYaml: manualYaml.replace('type: DOMAIN', 'type: NOT_A_TYPE') })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_PRICING', message: expect.stringContaining('NOT_A_TYPE') });
    expect(parses).toHaveBeenCalledTimes(1);

    parses.mockClear();
    await service.update(user, 'pr1', { previewToken: preview.previewToken, manualYaml });
    expect(parses).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ base: { versionId: 'v2' }, proposed: { suggestedVersion: '2.1' } });
    expect(loadPricingDoc(stored().proposed.yaml, STORED_PRICING_MAX_BYTES).saasName).toBe(NAME);
  });
});

describe('The detail of a pull request', () => {
  it('upgrades a base stored in an older syntax once, not on every request', async () => {
    const { newService, user, open, publishV2, stored } = scene(TEMPLATE_TEXT);
    await open(pricingText(NAME, '1.1', 25));
    const base = stored().base.yaml;
    expect(base).toBe(TEMPLATE_TEXT);
    const loadsOfBase = () => normalizes.mock.calls.filter(([text]) => text === base).length;

    // Another instance: nothing cached from opening it.
    const service = newService();
    normalizes.mockClear();
    const first = await service.show(user, 'pr1');
    // Once for its state and once for the detail.
    expect(loadsOfBase()).toBe(2);
    normalizes.mockClear();
    const second = await service.show(user, 'pr1');
    expect(normalizes).not.toHaveBeenCalled();
    expect(first.base.normalizedYaml).toBeDefined();
    expect(second.base).toEqual(first.base);

    // Brought up to v2, in the latest syntax: nothing to upgrade.
    publishV2();
    const preview = await service.mergePreview(user, 'pr1', { purpose: 'update' });
    const updated = await service.update(user, 'pr1', { previewToken: preview.previewToken, resolutions: { [preview.conflicts[0].id]: 'proposal' } });
    expect(updated.base.versionId).toBe('v2');
    expect(updated.base).not.toHaveProperty('normalizedYaml');
    expect((await service.show(user, 'pr1')).base).not.toHaveProperty('normalizedYaml');
  });
});
