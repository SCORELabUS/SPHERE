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
  // Counted where other modules load a text (stamping), not inside pricing-syntax itself.
  return { ...actual, loadPricingDoc: vi.fn(actual.loadPricingDoc) };
});

import { retrievePricingFromText } from 'pricing4ts/server';
import PricingPullRequestService from '../../main/services/PricingPullRequestService';
import { LeanUser } from '../../main/types/models/User';
import { dumpPricingDoc, loadPricingDoc, STORED_PRICING_MAX_BYTES, upgradeToLatestSyntax } from '../../main/utils/pricing-syntax';

const NAME = 'Petclinic parses';
const TEMPLATE = upgradeToLatestSyntax(
  loadPricingDoc(
    fs.readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8'),
    STORED_PRICING_MAX_BYTES
  )
).doc;

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

/** The service with its repositories and permission checks replaced: P has v1 and v2, both public. */
function scene() {
  const v1 = { id: 'v1', version: '1.0', private: false, yaml: 'v1.yml' };
  const v2 = { id: 'v2', version: '2.0', private: false, yaml: 'v2.yml' };
  const files: Record<string, string> = { v1: pricingText(NAME, '1.0'), v2: pricingText(NAME, '2.0', 30) };
  const pricing = { pricingId: 'p1', name: NAME, slug: 'petclinic-parses', organizationId: 'o1', latest: v1, latestPublic: v1 };
  const user = { id: 'author', username: 'author', role: 'USER' } as unknown as LeanUser;
  const viewer = { user, reader: true, readsPrivate: true, maintainer: true };
  const service: any = new PricingPullRequestService();
  let stored: any;
  Object.assign(service, {
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
  const open = (proposedYaml: string) =>
    service.create(user, { title: 'Gold up', source: { kind: 'text', pricingId: 'p1', baseVersionId: 'v1', proposedYaml } });
  /** P moves on to v2, leaving the pull request behind. */
  const publishV2 = () => Object.assign(pricing, { latest: v2, latestPublic: v2 });
  return { service, user, open, publishV2, stored: () => stored };
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

  it('parses a proposal with another name again once it carries the name of the pricing', async () => {
    const { open, stored } = scene();

    await open(pricingText('Somebody else', '1.1', 25));

    // The text as sent and the text as stored: they are different documents.
    expect(parses).toHaveBeenCalledTimes(2);
    expect(loadPricingDoc(stored().proposed.yaml, STORED_PRICING_MAX_BYTES).saasName).toBe(NAME);
    expect(stored().proposed.suggestedVersion).toBe('1.1');
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
});
