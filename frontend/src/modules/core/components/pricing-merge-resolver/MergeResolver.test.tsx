import { act, create, type ReactTestInstance, type ReactTestRenderer, type TestRendererOptions } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MergePanel from '../../../pricing/components/pricing-pull-requests/merge-panel';
import UpdatePanel from '../../../pricing/components/pricing-pull-requests/update-panel';
import FileDiffView from '../../../pricing/components/pricing-version-diff/file-diff-view';
import { PullRequestApiError } from '../../../pricing/api/pricingPullRequestsApi';
import { DEFAULT_RETRY_SECONDS, OPEN_CONFLICTS_DEBOUNCE_MS, PREVIEW_DEBOUNCE_MS } from '../../hooks/useMergeResolver';
import { formatConflictPath } from '../../utils/pricing-merge-resolver';
import type {
  ConflictScope,
  ConflictSide,
  MergeConflict,
  PullRequestDetail,
  PullRequestPreview,
} from '../../../pricing/types/pull-requests';

const mocks = vi.hoisted(() => ({
  previewPullRequestMerge: vi.fn(),
  mergePullRequest: vi.fn(),
  updatePullRequestToLatest: vi.fn(),
  confirm: vi.fn(),
  loadLatestYaml: vi.fn(),
  onMerged: vi.fn(),
  onPricingChanged: vi.fn(),
  parsePricing: vi.fn(),
  renderPricing: vi.fn(),
  editor: {
    createDecorationsCollection: vi.fn(),
    revealLineInCenter: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
  },
}));
vi.mock('../../../pricing/api/pricingPullRequestsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../pricing/api/pricingPullRequestsApi')>()),
  usePricingPullRequestsApi: () => mocks,
}));
vi.mock('../../utils/custom-confirm', () => ({ default: mocks.confirm }));
// The test renderer has no portals: the expanded resolver renders where it is, as the window would show it.
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (node: unknown) => node,
}));
// The pricing is read and drawn as the Overview does it: both stand in here, so the tests see what they get.
vi.mock('../../utils/pricing-render', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/pricing-render')>()),
  parsePricingForRender: mocks.parsePricing,
}));
vi.mock('../../../pricing-editor/components/pricing-renderer', () => ({
  PricingRenderer: (props: unknown) => {
    mocks.renderPricing(props);
    return null;
  },
}));
// Monaco needs a browser: a text area stands in (read-only as the editor is), and it hands the tests a fake editor once mounted.
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  function MonacoEditor({
    value,
    onChange,
    onMount,
    options,
  }: {
    value: string;
    onChange?: (value: string) => void;
    onMount: (editor: unknown) => void;
    options?: { readOnly?: boolean };
  }) {
    React.useEffect(() => onMount(mocks.editor), [onMount]);
    return React.createElement('textarea', {
      value,
      readOnly: options?.readOnly ?? false,
      onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
    });
  }
  return { default: MonacoEditor };
});

const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';
const PULL_REQUEST = { id: PR_ID, number: 7, proposed: { suggestedVersion: '3.1', yaml: '' } } as PullRequestDetail;
const ETAG = '"6650f0c0c0c0c0c0c0c0c001.4"';
const LATEST_YAML = 'saasName: Demo\nversion: "3.0"\nplans:\n  PRO:\n    price: 15\n';
const RESULT = `saasName: Demo
syntaxVersion: "3.1"
version: "3.1"
currency: USD
url: javascript:alert(1)
tags:
  - a
billing:
  monthly: 1
features:
  sso:
    description: Single sign-on
    valueType: BOOLEAN
    defaultValue: false
    type: DOMAIN
usageLimits:
  seats:
    valueType: NUMERIC
    defaultValue: 1
    unit: user
    type: NON_RENEWABLE
plans:
  BASIC:
    price: 0
  PRO:
    price: 15
    features:
      sso:
        value: true
addOns:
  extra:
    price: 5
    availableFor:
      - PRO
`;

/** What the renderer draws, as `parsePricingForRender` would read `RESULT`. */
const PRICING = { saasName: 'Demo', plans: { PRO: { price: 15 } } };

const SECTIONS = new Set(['plans', 'features', 'addOns', 'usageLimits']);
const side = (yaml?: string): ConflictSide => (yaml === undefined ? { present: false } : { present: true, yaml });

function conflict(
  path: string[],
  values: { base?: string; current?: string; proposal?: string } = { base: '10\n', current: '15\n', proposal: '12\n' },
  scope: ConflictScope = 'value'
): MergeConflict {
  const section = SECTIONS.has(path[0]) ? (path[0] as MergeConflict['section']) : 'general';
  return {
    id: JSON.stringify(path),
    path,
    label: formatConflictPath(path),
    section,
    ...(section !== 'general' && path.length > 1 ? { entry: path[1] } : {}),
    scope,
    base: side(values.base),
    current: side(values.current),
    proposal: side(values.proposal),
  };
}

const PRICE = conflict(['plans', 'PRO', 'price']);
const SSO = conflict(['plans', 'PRO', 'features', 'sso', 'value'], { base: 'false\n', current: 'false\n', proposal: 'true\n' });

/** Conflicts of every section, of fields the pricing does not draw and of an entry the result leaves out. */
const EVERYWHERE = [
  PRICE,
  SSO,
  conflict(['features', 'sso', 'description'], { current: 'SSO\n', proposal: 'Single sign-on\n' }),
  conflict(['plans'], { base: '- BASIC\n- PRO\n', current: '- PRO\n- BASIC\n', proposal: '- BASIC\n- PRO\n- TEAM\n' }, 'order'),
  conflict(['addOns', 'extra', 'price'], { base: '4\n', current: '5\n', proposal: '6\n' }),
  conflict(['billing'], { current: 'monthly: 1\n', proposal: 'monthly: 1\nannual: 0.8\n' }),
  conflict(['url'], { current: 'javascript:alert(1)\n', proposal: 'https://demo.example\n' }),
  conflict(['tags'], { base: '- a\n', current: '- a\n', proposal: '- b\n' }, 'list'),
  conflict(['custom', 'x'], { current: '1\n', proposal: '2\n' }),
  conflict(['plans', 'GONE', 'price'], { base: '1\n', proposal: '2\n' }),
];

function preview(overrides: Partial<PullRequestPreview> = {}): PullRequestPreview {
  return {
    base: { id: 'v2', version: '2.0' },
    target: { id: 'v3', version: '3.0', private: false },
    outcome: 'conflicts',
    conflicts: [PRICE, SSO],
    resultYaml: RESULT,
    regenerated: true,
    validation: { ok: true },
    warnings: [{ code: 'FORMAT_REGENERATED' }],
    previewToken: 'token-1',
    suggestedVersion: '3.1',
    versionTaken: false,
    defaults: { private: false },
    ...overrides,
  };
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

describe('Merge resolver', () => {
  let view: ReactTestRenderer;
  const text = () => textOf(view.root);
  const buttons = (root: ReactTestInstance = view.root) => root.findAllByType('button');
  const button = (label: string, root: ReactTestInstance = view.root) =>
    buttons(root).find(item => textOf(item).trim() === label)!;
  const card = (target: MergeConflict) =>
    view.root.find(node => node.type === 'article' && node.props['data-conflict-id'] === target.id);
  const mergeButton = () => button('Confirm merge');
  /** The merge box's way into the resolver, which shows it over the whole window. */
  const openWorkspace = async () => {
    const opener = ['Resolve conflicts', 'Review the result', 'Review your choices']
      .map(label => button(label))
      .find(Boolean);
    if (opener) await act(async () => opener.props.onClick());
  };
  const workspace = () => view.root.findAll(node => node.type === 'div' && node.props.role === 'dialog');
  const blockReason = () => textOf(view.root.findByProps({ id: 'merge-block-reason' }));
  const settle = (ms = PREVIEW_DEBOUNCE_MS) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const showView = (label: string) => act(async () => button(label).props.onClick());
  const choose = async (target: MergeConflict, label: 'Keep current' | 'Use proposal') => {
    await act(async () => button(label, card(target)).props.onClick());
  };

  /** The merge step of the merge box, with its resolver open over the whole window unless `open` is false. */
  async function renderMerge(
    options?: TestRendererOptions,
    pullRequest: PullRequestDetail = PULL_REQUEST,
    { open = true }: { open?: boolean } = {}
  ) {
    await act(async () => {
      view = create(
        <MergePanel
          pullRequest={pullRequest}
          etag={ETAG}
          loadLatestYaml={mocks.loadLatestYaml}
          onMerged={mocks.onMerged}
          onPricingChanged={mocks.onPricingChanged}
          onCancel={() => {}}
        />,
        options
      );
    });
    await settle(0);
    if (open) await openWorkspace();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // The resolver's full window keeps the page behind from scrolling: a body stands in for the browser's.
    vi.stubGlobal('document', { body: { style: { overflow: '' } } });
    mocks.previewPullRequestMerge.mockResolvedValue(preview());
    mocks.loadLatestYaml.mockResolvedValue(LATEST_YAML);
    mocks.onPricingChanged.mockReturnValue(false);
    mocks.editor.createDecorationsCollection.mockReturnValue({ clear: () => {} });
    mocks.parsePricing.mockResolvedValue(PRICING);
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists each conflict with its label, its three values and how many are unresolved (CA-24)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ conflicts: [PRICE, conflict(['plans', 'PRO', 'unit'], { base: undefined, current: 'null\n', proposal: '/month\n' })] })
    );
    await renderMerge();
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'merge', {});
    expect(text()).toContain('2 conflicts · 2 unresolved');

    const price = textOf(card(PRICE));
    expect(price).toContain('plans.PRO.price');
    expect(price).toContain('Base10');
    expect(price).toContain('Current · 3.015');
    expect(price).toContain('Proposal12');
    // Absent and null are told apart.
    const unit = textOf(card(conflict(['plans', 'PRO', 'unit'])));
    expect(unit).toContain('BaseAbsent');
    expect(unit).toContain('Current · 3.0null');

    await choose(PRICE, 'Keep current');
    expect(text()).toContain('2 conflicts · 1 unresolved');
    expect(button('Keep current', card(PRICE)).props['aria-pressed']).toBe(true);
    expect(textOf(card(PRICE))).toContain('Keeping current');
    // The preview is asked again once the choices settle, with them (later while a conflict is still open).
    await settle(OPEN_CONFLICTS_DEBOUNCE_MS - 1);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', { [PRICE.id]: 'current' });
  });

  it('keeps merging disabled, with the reason in words, while conflicts are open or the result is invalid (CA-27)', async () => {
    await renderMerge();
    expect(mergeButton().props.disabled).toBe(true);
    expect(blockReason()).toBe('2 unresolved conflicts: choose a side for each.');

    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ validation: { ok: false, error: 'Feature sso is not defined', line: 27 } })
    );
    await choose(PRICE, 'Keep current');
    expect(blockReason()).toBe('Updating the preview…');
    await choose(SSO, 'Use proposal');
    await settle();
    expect(mergeButton().props.disabled).toBe(true);
    expect(blockReason()).toBe('The result is not a valid pricing (line 27): Feature sso is not defined');

    mocks.previewPullRequestMerge.mockResolvedValue(preview({ previewToken: 'token-2' }));
    await choose(SSO, 'Keep current');
    await settle();
    expect(mergeButton().props.disabled).toBe(false);
    expect(view.root.findAllByProps({ id: 'merge-block-reason' })).toHaveLength(0);

    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest).toHaveBeenCalledWith(
      PR_ID,
      { resolutions: { [PRICE.id]: 'current', [SSO.id]: 'current' }, previewToken: 'token-2', version: '3.1', private: false },
      ETAG
    );
    expect(mocks.onMerged).toHaveBeenCalledWith(expect.objectContaining({ version: { id: 'v4', version: '3.1', private: false } }));
  });

  it('computes the preview again after a stale refusal and keeps only the choices whose values did not change (CA-14)', async () => {
    await renderMerge();
    await choose(PRICE, 'Use proposal');
    await choose(SSO, 'Use proposal');
    await settle();
    mocks.mergePullRequest.mockRejectedValue(new PullRequestApiError(409, { error: 'stale', code: 'PREVIEW_STALE' }));
    // A newer version changed the current side of one conflict only.
    const moved = { ...SSO, current: side('true\n') };
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [PRICE, moved], previewToken: 'token-3' }));

    await act(async () => mergeButton().props.onClick());
    expect(view.root.findByProps({ role: 'alert' }).children.map(textOf).join('')).toBe(
      'Something changed since the preview was computed. Review the new preview and try again.'
    );
    await settle();
    // Dropping the changed choice leaves a conflict open, so the next preview waits longer.
    await settle(OPEN_CONFLICTS_DEBOUNCE_MS);
    expect(textOf(card(PRICE))).toContain('Using proposal');
    expect(textOf(card(SSO))).toContain('Changed since your choice');
    expect(button('Use proposal', card(SSO)).props['aria-pressed']).toBe(false);
    expect(text()).toContain('2 conflicts · 1 unresolved');
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', { [PRICE.id]: 'proposal' });
  });

  it('drops a preview answered after the choices changed, even when it arrives last', async () => {
    await renderMerge();
    const pending: Array<(value: PullRequestPreview) => void> = [];
    mocks.previewPullRequestMerge.mockImplementation(() => new Promise<PullRequestPreview>(resolve => pending.push(resolve)));
    await choose(PRICE, 'Use proposal');
    await choose(SSO, 'Use proposal');
    await settle();
    await choose(SSO, 'Keep current');
    await settle();
    expect(pending).toHaveLength(2);
    // The answer to the latest choices comes first; the one to the earlier choices, after it.
    await act(async () => pending[1](preview({ previewToken: 'latest-choices', resultYaml: RESULT })));
    await act(async () => pending[0](preview({ previewToken: 'earlier-choices', resultYaml: 'saasName: Stale\n' })));
    await showView('YAML');
    expect(view.root.findByType('textarea').props.value).toBe(RESULT);

    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest.mock.lastCall![1]).toMatchObject({
      resolutions: { [PRICE.id]: 'proposal', [SSO.id]: 'current' },
      previewToken: 'latest-choices',
    });
  });

  it('computes the preview again when a version was published while merging', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged' }));
    await renderMerge();
    mocks.mergePullRequest.mockRejectedValue(
      new PullRequestApiError(409, { error: 'changed', code: 'PRICING_CHANGED_DURING_MERGE' })
    );
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ conflicts: [], outcome: 'merged', target: { id: 'v4', version: '4.0', private: false }, previewToken: 'token-4' })
    );
    await act(async () => mergeButton().props.onClick());
    expect(textOf(view.root.findByProps({ role: 'alert' }))).toBe('The pricing changed while merging. Review the merge again.');
    await settle(0);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Merging into version 4.0');

    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v5', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest.mock.lastCall![1]).toMatchObject({ previewToken: 'token-4' });
  });

  it('asks for the preview once a run of choices settles, and sooner when no conflict is left open', async () => {
    const three = [PRICE, SSO, conflict(['addOns', 'extra', 'price'], { base: '4\n', current: '5\n', proposal: '6\n' })];
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: three }));
    await renderMerge();
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(1);
    // Choices a second apart while conflicts are still open ask nothing until they stop.
    await choose(three[0], 'Keep current');
    await settle(1000);
    await choose(three[1], 'Use proposal');
    await settle(1000);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(1);
    // The last one asks soon, once, with all of them.
    await choose(three[2], 'Keep current');
    await settle(PREVIEW_DEBOUNCE_MS);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(2);
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', {
      [three[0].id]: 'current',
      [three[1].id]: 'proposal',
      [three[2].id]: 'current',
    });
  });

  it('after too many requests says when it asks again, and asks by itself with the same choices (429)', async () => {
    await renderMerge();
    await choose(PRICE, 'Use proposal');
    mocks.previewPullRequestMerge.mockRejectedValueOnce(
      new PullRequestApiError(429, { error: 'TOO MANY REQUESTS: Rate limit exceeded. Try again in 3 seconds.' }, 3)
    );
    await choose(SSO, 'Use proposal');
    await settle();
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(2);
    expect(mergeButton().props.disabled).toBe(true);
    const alert = () => view.root.findByProps({ role: 'alert' });
    expect(textOf(alert())).toContain('Too many requests in a short time. The preview is asked again in 3 seconds.');
    expect(button('Try again now', alert()).props.className).toContain('cursor-pointer');
    // Said once, in the alert: the reason next to the disabled button only points at it.
    expect(blockReason()).toBe('Waiting to ask for the preview again.');
    expect(text().split('Too many requests').length - 1).toBe(1);

    await settle(1000);
    expect(textOf(alert())).toContain('asked again in 2 seconds.');
    await settle(1000);
    expect(textOf(alert())).toContain('asked again in 1 second.');
    expect(text().split('Too many requests').length - 1).toBe(1);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(2);
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ previewToken: 'token-2' }));
    await settle(1000);
    await settle(0);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(3);
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', { [PRICE.id]: 'proposal', [SSO.id]: 'proposal' });
    expect(mergeButton().props.disabled).toBe(false);
    expect(view.root.findAll(node => node.props.role === 'alert')).toHaveLength(0);
  });

  it('can be asked again at once, and waits a default time when a 429 does not say how long', async () => {
    await renderMerge();
    mocks.previewPullRequestMerge.mockRejectedValueOnce(new PullRequestApiError(429, { error: 'Slow down' }));
    await choose(PRICE, 'Use proposal');
    await choose(SSO, 'Use proposal');
    await settle();
    expect(textOf(view.root.findByProps({ role: 'alert' }))).toContain(
      `Too many requests in a short time. The preview is asked again in ${DEFAULT_RETRY_SECONDS} seconds.`
    );
    expect(blockReason()).toBe('Waiting to ask for the preview again.');
    await act(async () => button('Try again now', view.root.findByProps({ role: 'alert' })).props.onClick());
    await settle(0);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(3);
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', { [PRICE.id]: 'proposal', [SSO.id]: 'proposal' });
    expect(mergeButton().props.disabled).toBe(false);
  });

  it('names the current version as it is written, wraps long values and words what a merge combines', async () => {
    const long = `description: ${'a long description '.repeat(12)}\n`;
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({
        target: { id: 'v3', version: '2024-08-pr7', private: false },
        conflicts: [conflict(['plans', 'PRO', 'description'], { base: 'a\n', current: long, proposal: 'b\n' })],
      })
    );
    await renderMerge();
    expect(text()).toContain('Merging into version 2024-08-pr7, from the base version 2.0.');
    const [only] = view.root.findAll(node => node.type === 'article');
    const label = only.find(node => node.type === 'span' && textOf(node) === ' · 2024-08-pr7');
    // The title is in capitals; the label keeps its own case.
    expect(label.props.className).toContain('normal-case');
    for (const value of only.findAllByType('pre')) expect(value.props.className).toContain('whitespace-pre-wrap');
  });

  it('marks the conflicts in the YAML, read-only, and blocks an invalid result naming its line (CA-30)', async () => {
    await renderMerge();
    await showView('YAML');
    const textarea = view.root.findByType('textarea');
    expect(textarea.props.value).toBe(RESULT);
    // The result changes by choosing a side, never by typing.
    expect(textarea.props.readOnly).toBe(true);

    const priceLine = RESULT.split('\n').indexOf('    price: 15') + 1;
    const ssoLine = RESULT.split('\n').indexOf('        value: true') + 1;
    const decorated = mocks.editor.createDecorationsCollection.mock.lastCall![0] as {
      range: { startLineNumber: number };
      options: { hoverMessage: { value: string } };
    }[];
    expect(decorated.map(item => [item.range.startLineNumber, item.options.hoverMessage.value])).toEqual([
      [priceLine, 'Conflict: plans.PRO.price'],
      [ssoLine, 'Conflict: plans.PRO.features.sso.value'],
    ]);
    // Only the file: the marked lines name their conflict on hover, with no list or caption around it.
    expect(text()).not.toMatch(/Conflicts still to choose|read-only|Edited by hand/);

    act(() => view.unmount());
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ conflicts: [], outcome: 'merged', validation: { ok: false, error: 'Plan PRO has no price', line: 17 } })
    );
    await renderMerge();
    await showView('YAML');
    expect(textOf(view.root.findByProps({ role: 'alert' }))).toBe('Line 17:Plan PRO has no price');
    expect(mergeButton().props.disabled).toBe(true);
    expect(blockReason()).toBe('The result is not a valid pricing (line 17): Plan PRO has no price');
  });

  it('shows the names in the YAML hovers as text, never as markdown images or links', async () => {
    const planted = conflict(['plans', '![](https://attacker.example/p.png)', 'price']);
    const linked = conflict(['features', '[click](https://phish.example)*bold*', 'description'], { current: 'a\n', proposal: 'b\n' });
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [planted, linked] }));
    await renderMerge();
    await showView('YAML');
    const hovers = (mocks.editor.createDecorationsCollection.mock.lastCall![0] as Array<{
      options: { hoverMessage: { value: string; isTrusted?: boolean; supportHtml?: boolean } };
    }>).map(decoration => decoration.options.hoverMessage);
    expect(hovers).toHaveLength(2);
    for (const hover of hovers) {
      expect(hover.value.startsWith('Conflict: ')).toBe(true);
      expect(hover).toMatchObject({ isTrusted: false, supportHtml: false });
      // Once the escaped characters are taken out, no markdown syntax is left.
      expect(hover.value.slice('Conflict: '.length).replace(/\\[\s\S]/g, '')).not.toMatch(/[[\]()!*_<>`]/);
    }
    // The text still reads as the name.
    expect(hovers[0].value.replace(/\\/g, '')).toBe(`Conflict: ${planted.label}`);
  });

  it('never takes a result typed by hand: a choice asks nothing and a merge sends the choices and the preview token', async () => {
    await renderMerge();
    await choose(PRICE, 'Use proposal');
    await choose(SSO, 'Keep current');
    expect(mocks.confirm).not.toHaveBeenCalled();
    for (const label of ['YAML', 'Conflicts', 'Compare', 'Visual']) {
      await showView(label);
      expect(text()).not.toMatch(/by hand|Discard my edits/);
    }
    await settle(PREVIEW_DEBOUNCE_MS);
    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest).toHaveBeenCalledWith(
      PR_ID,
      { resolutions: { [PRICE.id]: 'proposal', [SSO.id]: 'current' }, previewToken: 'token-1', version: '3.1', private: false },
      ETAG
    );
  });

  it('resolves the conflicts over the whole window, and confirms the merge back in the merge box with the choices made', async () => {
    const body = { style: { overflow: 'auto' } };
    vi.stubGlobal('document', { body });
    await renderMerge(undefined, PULL_REQUEST, { open: false });
    // The merge box says how many conflicts there are, with the way into the resolver; nothing to merge yet.
    expect(workspace()).toHaveLength(0);
    expect(text()).toContain('2 conflicts to resolve');
    expect(button('Resolve conflicts').props.className).toContain('cursor-pointer');
    expect(mergeButton().props.disabled).toBe(true);

    await openWorkspace();
    expect(workspace()).toHaveLength(1);
    expect(workspace()[0].props['aria-label']).toBe('Resolve conflicts');
    // The page behind does not scroll, and the resolver already has the whole window: no Expand.
    expect(body.style.overflow).toBe('hidden');
    expect(button('Expand')).toBeUndefined();
    await choose(PRICE, 'Use proposal');
    await act(async () => button('Done').props.onClick());
    expect(workspace()).toHaveLength(0);
    expect(body.style.overflow).toBe('auto');
    expect(text()).toContain('1 of 2 conflicts still to resolve');

    // Back in, the choice is there; Escape (one the editor did not take) also goes back.
    await openWorkspace();
    expect(button('Use proposal', card(PRICE)).props['aria-pressed']).toBe(true);
    await choose(SSO, 'Keep current');
    const stopPropagation = vi.fn();
    await act(async () => workspace()[0].props.onKeyDown({ key: 'Escape', defaultPrevented: true, stopPropagation }));
    expect(workspace()).toHaveLength(1);
    await act(async () => workspace()[0].props.onKeyDown({ key: 'Escape', defaultPrevented: false, stopPropagation }));
    expect(workspace()).toHaveLength(0);
    expect(text()).toContain('2 conflicts resolved');
    expect(button('Review your choices')).toBeDefined();

    await settle(PREVIEW_DEBOUNCE_MS);
    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest).toHaveBeenCalledWith(
      PR_ID,
      { resolutions: { [PRICE.id]: 'proposal', [SSO.id]: 'current' }, previewToken: 'token-1', version: '3.1', private: false },
      ETAG
    );
  });

  it('opens the result for review, on Compare, when there are no conflicts', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged' }));
    await renderMerge(undefined, PULL_REQUEST, { open: false });
    expect(text()).toContain('No conflicts');
    expect(mergeButton().props.disabled).toBe(false);
    await openWorkspace();
    expect(workspace()[0].props['aria-label']).toBe('Review the merge');
    expect(button('Compare').props['aria-pressed']).toBe(true);
  });

  it('opens the resolver at once when the merge box already knew of conflicts', async () => {
    await act(async () => {
      view = create(
        <MergePanel
          pullRequest={PULL_REQUEST}
          etag={ETAG}
          loadLatestYaml={mocks.loadLatestYaml}
          onMerged={mocks.onMerged}
          onPricingChanged={mocks.onPricingChanged}
          onCancel={() => {}}
          resolveFirst
        />
      );
    });
    await settle(0);
    expect(workspace()).toHaveLength(1);
    expect(button('Conflicts').props['aria-pressed']).toBe(true);
  });

  it('compares the result with the version it follows, with + − ~ marks (CA-31)', async () => {
    await renderMerge();
    await showView('Compare');
    expect(mocks.loadLatestYaml).toHaveBeenCalledWith({ id: 'v3', version: '3.0' });
    const file = view.root.findByType(FileDiffView);
    expect(file.props).toMatchObject({ before: LATEST_YAML, after: RESULT, beforeLabel: 'Version 3.0', afterLabel: 'Result', markers: true });
    const marks = file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)));
    expect(new Set(marks.map(textOf))).toEqual(new Set(['+', '~']));
  });

  it('compares in the latest syntax when the result and the version it follows are written in different ones', async () => {
    const upgraded = `${LATEST_YAML}syntaxVersion: "3.1"\n`;
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ targetNormalizedYaml: upgraded }));
    await renderMerge();
    await showView('Compare');
    // The server sent the target upgraded: it is not read again.
    expect(mocks.loadLatestYaml).not.toHaveBeenCalled();
    expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: upgraded, after: RESULT });
    expect(text()).toContain('Version 3.0 and the result are written in different Pricing2Yaml syntaxes.');

    act(() => view.unmount());
    const resultUpgraded = `${RESULT}upgraded: true\n`;
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ targetNormalizedYaml: upgraded, resultNormalizedYaml: resultUpgraded }));
    await renderMerge();
    await showView('Compare');
    expect(view.root.findByType(FileDiffView).props).toMatchObject({ before: upgraded, after: resultUpgraded });
    expect(text().match(/different Pricing2Yaml syntaxes/g)).toHaveLength(1);
  });

  it('does not show the quotes SPHERE writes around the same name as a change in Compare', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ resultYaml: LATEST_YAML.replace('saasName: Demo', "saasName: 'Demo'") }));
    await renderMerge();
    await showView('Compare');
    const file = view.root.findByType(FileDiffView);
    expect(file.props.after).toBe(LATEST_YAML);
    expect(file.findAll(node => node.type === 'span' && ['+', '−', '~'].includes(textOf(node)))).toHaveLength(0);
  });

  it('marks only what changes in Compare when the result is formatted differently from the version it follows', async () => {
    // The version as stored, and the fork's version as a tool wrote it after one change: every string quoted.
    mocks.loadLatestYaml.mockResolvedValue("saasName: Demo\nversion: '3.0'\n# Plans\nplans:\n  PRO:\n    description: For teams, with SSO\n    price: 15\n");
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ resultYaml: 'saasName: "Demo"\nversion: "3.1"\nplans:\n  PRO:\n    description: "For teams, with SSO"\n    price: 18\n' })
    );
    await renderMerge();
    await showView('Compare');
    const file = view.root.findByType(FileDiffView);
    expect(file.props.before).toBe("saasName: Demo\nversion: '3.0'\nplans:\n  PRO:\n    description: For teams, with SSO\n    price: 15\n");
    expect(file.props.after).toBe("saasName: Demo\nversion: '3.1'\nplans:\n  PRO:\n    description: For teams, with SSO\n    price: 18\n");
    expect(file.findAll(node => node.type === 'span' && textOf(node) === '~')).toHaveLength(4);
    expect(text()).toContain('Version 3.0 and the result are formatted differently (quotes, line breaks or comments).');
    expect(text()).not.toContain('different Pricing2Yaml syntaxes');
  });

  it('draws the result with the Overview\'s renderer and lists every conflict above it, sharing the choices (CA-32, CA-33)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: EVERYWHERE }));
    await renderMerge();
    await showView('Visual');
    expect(mocks.parsePricing).toHaveBeenCalledWith(RESULT);
    expect(mocks.renderPricing.mock.lastCall![0]).toMatchObject({ pricing: PRICING });

    // Every conflict once, named, with whether it is resolved; the first open one is shown with its choices.
    const chips = view.root.findByProps({ 'aria-label': 'Conflicts' }).findAllByType('button');
    expect(chips.map(chip => chip.props['aria-label'])).toEqual(EVERYWHERE.map(item => `${item.label}: unresolved`));
    expect(card(PRICE)).toBeDefined();

    await act(async () => chips[1].props.onClick());
    await choose(SSO, 'Use proposal');
    const chip = () => view.root.findByProps({ 'aria-label': 'Conflicts' }).findAllByType('button')[1];
    expect(chip().props['aria-label']).toBe(`${SSO.label}: resolved`);
    await showView('Conflicts');
    expect(button('Use proposal', card(SSO)).props['aria-pressed']).toBe(true);
    expect(text()).toContain(`${EVERYWHERE.length} conflicts · ${EVERYWHERE.length - 1} unresolved`);
  });

  it('draws the result again when a choice changes it, and the variables simulator changes only the drawing', async () => {
    const chosen = RESULT.replace('price: 15', 'price: 12');
    mocks.previewPullRequestMerge.mockImplementation(async (_id: string, _purpose: string, resolutions: Record<string, string>) =>
      preview(resolutions[PRICE.id] ? { resultYaml: chosen } : {})
    );
    await renderMerge();
    await showView('Visual');
    await choose(PRICE, 'Use proposal');
    await settle(OPEN_CONFLICTS_DEBOUNCE_MS);
    expect(mocks.parsePricing).toHaveBeenLastCalledWith(chosen);

    const { onApplyVariables } = mocks.renderPricing.mock.lastCall![0] as { onApplyVariables: (values: Record<string, unknown>) => void };
    await act(async () => onApplyVariables({ seats: 3 }));
    expect(mocks.parsePricing.mock.lastCall![0]).toBe(`${chosen}\nvariables:\n  seats: 3\n`);
    // Nothing of it reaches the merge.
    await showView('Conflicts');
    await choose(SSO, 'Keep current');
    await settle(PREVIEW_DEBOUNCE_MS);
    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest.mock.lastCall![1]).toEqual({
      resolutions: { [PRICE.id]: 'proposal', [SSO.id]: 'current' }, previewToken: 'token-1', version: '3.1', private: false,
    });
  });

  it('shows values as text, never as links or markup (CA-80)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: EVERYWHERE }));
    await renderMerge();
    const url = EVERYWHERE.find(item => item.label === 'url')!;
    for (const label of ['Conflicts', 'Visual']) {
      await showView(label);
      if (label === 'Visual') {
        const chips = view.root.findByProps({ 'aria-label': 'Conflicts' }).findAllByType('button');
        await act(async () => chips.find(chip => chip.props['aria-label'].startsWith('url:'))!.props.onClick());
        expect(card(url)).toBeDefined();
      }
      expect(text()).toContain('javascript:alert(1)');
      expect(view.root.findAll(node => node.type === 'a' || node.type === 'img')).toHaveLength(0);
      expect(view.root.findAll(node => 'href' in node.props || 'dangerouslySetInnerHTML' in node.props)).toHaveLength(0);
    }
  });

  it('says when the result cannot be drawn and points to its YAML (CA-34)', async () => {
    mocks.parsePricing.mockRejectedValue(new Error('Failed to parse pricing'));
    await renderMerge();
    await showView('Visual');
    expect(textOf(view.root.findByProps({ role: 'alert' }))).toContain('The result cannot be drawn: Failed to parse pricing');
    expect(mocks.renderPricing).not.toHaveBeenCalled();
    await act(async () => button('See its YAML').props.onClick());
    expect(view.root.findAllByType('textarea')).toHaveLength(1);
  });

  it('shows what SPHERE does to the result before merging (CA-40, CA-89)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ warnings: [{ code: 'FORMAT_REGENERATED' }, { code: 'SYNTAX_UPGRADED' }] })
    );
    await renderMerge();
    expect(mocks.mergePullRequest).not.toHaveBeenCalled();
    const notices = view.root.findAll(node => node.type === 'li' && node.props['data-warning'] !== undefined);
    expect(notices.map(notice => notice.props['data-warning'])).toEqual(['FORMAT_REGENERATED', 'SYNTAX_UPGRADED']);
    expect(textOf(notices[0])).toBe(
      'The result combines both sides, so SPHERE writes its YAML again: comments and the original layout are not kept.'
    );
  });

  it('starts from the visibility SPHERE suggests and warns before making a private version public (CA-39)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({ conflicts: [], outcome: 'merged', target: { id: 'v3', version: '3.0', private: true }, defaults: { private: true } })
    );
    await renderMerge();
    const radio = (label: string) =>
      view.root.findAll(node => node.type === 'label' && textOf(node) === label)[0].findByType('input');
    expect(radio('Private').props.checked).toBe(true);
    expect(text()).not.toContain('is private');

    await act(async () => radio('Public').props.onChange());
    expect(text()).toContain('Version 3.0, the one this merge follows, is private.');
    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest.mock.lastCall![1]).toMatchObject({ private: false, version: '3.1' });
  });

  it('says why the label it suggests is not the proposal\'s own, until another one is typed', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(
      preview({
        conflicts: [], outcome: 'merged', suggestedVersion: '2.5-pr7', suggestedVersionFollows: { proposal: '2.4', latest: '2.5' },
      })
    );
    await renderMerge();
    expect(view.root.findByProps({ id: 'merge-version' }).props.value).toBe('2.5-pr7');
    // The latest public version, which may not be the one merged into (3.0 here, private or not).
    expect(text()).toContain('The proposal names it 2.4, which reads as older than version 2.5, the latest public one.');
    await act(async () => view.root.findByProps({ id: 'merge-version' }).props.onChange({ target: { value: '3.5' } }));
    expect(text()).not.toContain('The proposal names it');

    // The proposal's own label needs no word.
    act(() => view.unmount());
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged' }));
    await renderMerge();
    expect(text()).not.toContain('The proposal names');
  });

  it('warns about a label that is already a version and lets another one be typed', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged', versionTaken: true }));
    await renderMerge();
    expect(mergeButton().props.disabled).toBe(true);
    expect(blockReason()).toBe('Version 3.1 already exists: choose another label.');
    await act(async () => view.root.findByProps({ id: 'merge-version' }).props.onChange({ target: { value: '3.2' } }));
    expect(mergeButton().props.disabled).toBe(false);
  });

  it('leaves a changed pricing to the page, which offers to reload (412)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged' }));
    mocks.onPricingChanged.mockReturnValue(true);
    const changed = new PullRequestApiError(412, { error: 'Precondition failed', code: 'PRECONDITION_FAILED' });
    mocks.mergePullRequest.mockRejectedValue(changed);
    await renderMerge();
    await act(async () => mergeButton().props.onClick());
    expect(mocks.onPricingChanged).toHaveBeenCalledWith(changed);
    expect(view.root.findAll(node => node.props.role === 'alert')).toHaveLength(0);
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledTimes(1);
  });

  it('moves between conflicts with Alt+↓ and Alt+↑, and gives every enabled button a pointer cursor (CA-37)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: EVERYWHERE }));
    // The element that has the focus, as `document.activeElement` would say: the conflict of a card.
    let focused: string | null = null;
    await renderMerge({
      createNodeMock: element =>
        element.type === 'article'
          ? { scrollIntoView: () => {}, focus: () => (focused = element.props['data-conflict-id']) }
          : null,
    });
    const list = view.root.findByProps({ role: 'group', 'aria-label': 'Conflicts' });
    const active = () => view.root.find(node => node.type === 'article' && node.props['aria-current'] === 'true').props['data-conflict-id'];
    // The active conflict is drawn as such only while the keyboard is in the list, not on arrival.
    expect(list.props.className).toContain('group/conflicts');
    expect(card(EVERYWHERE[0]).props.className).toContain('group-focus-within/conflicts:border-tp-primary/60');
    expect(card(EVERYWHERE[0]).props.className).not.toMatch(/(^|\s)border-tp-primary\/60/);
    const key = (key: string, altKey = true) => act(async () => list.props.onKeyDown({ key, altKey, preventDefault: () => {} }));
    expect(active()).toBe(EVERYWHERE[0].id);
    expect(focused).toBeNull();
    await key('ArrowDown');
    await key('ArrowDown');
    expect(active()).toBe(EVERYWHERE[2].id);
    // The focus goes with it, so Enter and Tab act on the conflict that is marked.
    expect(focused).toBe(EVERYWHERE[2].id);
    expect(card(EVERYWHERE[2]).props).toMatchObject({ tabIndex: -1, 'aria-label': EVERYWHERE[2].label });
    await key('ArrowUp');
    expect(active()).toBe(EVERYWHERE[1].id);
    expect(focused).toBe(EVERYWHERE[1].id);
    await key('ArrowDown', false);
    expect(active()).toBe(EVERYWHERE[1].id);
    expect(focused).toBe(EVERYWHERE[1].id);
    // Choosing with the mouse marks a conflict without taking the focus away from the button.
    await choose(EVERYWHERE[4], 'Keep current');
    expect(active()).toBe(EVERYWHERE[4].id);
    expect(focused).toBe(EVERYWHERE[1].id);
    // The keyboard goes on from the conflict chosen, and takes the focus again.
    focused = null;
    await key('ArrowDown');
    expect(focused).toBe(EVERYWHERE[5].id);

    for (const label of ['Conflicts', 'YAML', 'Compare', 'Visual']) {
      await showView(label);
      const enabled = buttons().filter(item => !item.props.disabled);
      expect(enabled.length).toBeGreaterThanOrEqual(5);
      enabled.forEach(item => expect(item.props.className).toContain('cursor-pointer'));
    }
  });

  it('brings a pull request up to the latest version with the update preview', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'no-changes' }));
    mocks.updatePullRequestToLatest.mockResolvedValue({ id: PR_ID, warnings: [] });
    const onUpdated = vi.fn();
    await act(async () => {
      view = create(
        <UpdatePanel pullRequest={PULL_REQUEST} loadLatestYaml={mocks.loadLatestYaml} onUpdated={onUpdated} onCancel={() => {}} />
      );
    });
    await settle(0);
    await openWorkspace();
    expect(workspace()[0].props['aria-label']).toBe('Review the update');
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'update', {});
    expect(text()).toContain('after updating, the pull request has no changes');
    // The author brings their proposal up to date: nothing is merged.
    expect(text()).toContain('Bringing your proposal up to version 3.0, from the base version 2.0.');
    expect(text()).not.toContain('Merging into');
    await act(async () => button('Update pull request').props.onClick());
    expect(mocks.updatePullRequestToLatest).toHaveBeenCalledWith(PR_ID, { resolutions: {}, previewToken: 'token-1' });
    expect(onUpdated).toHaveBeenCalledWith({ id: PR_ID, warnings: [] });
  });
});
