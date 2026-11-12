import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MergePanel from '../../../pricing/components/pricing-pull-requests/merge-panel';
import UpdatePanel from '../../../pricing/components/pricing-pull-requests/update-panel';
import FileDiffView from '../../../pricing/components/pricing-version-diff/file-diff-view';
import { PullRequestApiError } from '../../../pricing/api/pricingPullRequestsApi';
import { VisualEditorUnavailable } from '../../../pricing-editor/components/visual-editor/components/VisualEditorUnavailable';
import { PREVIEW_DEBOUNCE_MS } from '../../hooks/useMergeResolver';
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
// Monaco needs a browser: a text area stands in, and it hands the tests a fake editor once mounted.
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  function MonacoEditor({
    value,
    onChange,
    onMount,
  }: {
    value: string;
    onChange: (value: string) => void;
    onMount: (editor: unknown) => void;
  }) {
    React.useEffect(() => onMount(mocks.editor), [onMount]);
    return React.createElement('textarea', {
      value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    });
  }
  return { default: MonacoEditor };
});

const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';
const PULL_REQUEST = { id: PR_ID, number: 7 } as PullRequestDetail;
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

/** One conflict for each place the Visual view draws, plus fields it has no place for. */
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
  const mergeButton = () => button('Merge pull request');
  const blockReason = () => textOf(view.root.findByProps({ id: 'merge-block-reason' }));
  const settle = (ms = PREVIEW_DEBOUNCE_MS) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const showView = (label: string) => act(async () => button(label).props.onClick());
  const choose = async (target: MergeConflict, label: 'Keep current' | 'Use proposal') => {
    await act(async () => button(label, card(target)).props.onClick());
  };

  async function renderMerge() {
    await act(async () => {
      view = create(
        <MergePanel
          pullRequest={PULL_REQUEST}
          etag={ETAG}
          loadLatestYaml={mocks.loadLatestYaml}
          onMerged={mocks.onMerged}
          onPricingChanged={mocks.onPricingChanged}
          onCancel={() => {}}
        />
      );
    });
    await settle(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.previewPullRequestMerge.mockResolvedValue(preview());
    mocks.loadLatestYaml.mockResolvedValue(LATEST_YAML);
    mocks.onPricingChanged.mockReturnValue(false);
    mocks.editor.createDecorationsCollection.mockReturnValue({ clear: () => {} });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.useRealTimers();
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
    // The preview is asked again once the choices settle, with them.
    await settle(PREVIEW_DEBOUNCE_MS - 1);
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
    await settle();
    expect(textOf(card(PRICE))).toContain('Using proposal');
    expect(textOf(card(SSO))).toContain('Changed since your choice');
    expect(button('Use proposal', card(SSO)).props['aria-pressed']).toBe(false);
    expect(text()).toContain('2 conflicts · 1 unresolved');
    expect(mocks.previewPullRequestMerge).toHaveBeenLastCalledWith(PR_ID, 'merge', { [PRICE.id]: 'proposal' });
  });

  it('marks the conflicts in the YAML and blocks a result with a syntax error, naming its line (CA-30)', async () => {
    await renderMerge();
    await showView('YAML');
    expect(view.root.findByType('textarea').props.value).toBe(RESULT);

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
    expect(text()).toContain(`plans.PRO.priceline ${priceLine}`);

    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'plans:\n  PRO: [\n' } }));
    const alert = textOf(view.root.findByProps({ role: 'alert' }));
    expect(alert).toMatch(/^Line \d+:/);
    expect(mergeButton().props.disabled).toBe(true);
    expect(blockReason()).toMatch(/^The YAML has an error on line \d+: /);
    expect(view.root.findAll(node => node.props['data-warning'] === 'MANUAL_OVERRIDE')).toHaveLength(1);
  });

  it('asks before a choice replaces a result edited by hand (CA-35)', async () => {
    await renderMerge();
    await showView('YAML');
    const edited = `${RESULT}# reviewed\n`;
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: edited } }));
    await showView('Conflicts');

    mocks.confirm.mockRejectedValueOnce(undefined);
    await choose(PRICE, 'Use proposal');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(button('Use proposal', card(PRICE)).props['aria-pressed']).toBe(false);
    // With a manual result, open conflicts do not block: the server takes that result.
    expect(mergeButton().props.disabled).toBe(false);

    mocks.confirm.mockResolvedValueOnce(undefined);
    await choose(PRICE, 'Use proposal');
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(button('Use proposal', card(PRICE)).props['aria-pressed']).toBe(true);
    await showView('YAML');
    expect(view.root.findByType('textarea').props.value).toBe(RESULT);
  });

  it('sends the hand-typed result with the choices and the preview token', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: [], outcome: 'merged' }));
    await renderMerge();
    await showView('YAML');
    const edited = `${RESULT}# reviewed\n`;
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: edited } }));
    mocks.mergePullRequest.mockResolvedValue({ pullRequest: { id: PR_ID }, version: { id: 'v4', version: '3.1', private: false } });
    await act(async () => mergeButton().props.onClick());
    expect(mocks.mergePullRequest).toHaveBeenCalledWith(
      PR_ID,
      { resolutions: {}, manualYaml: edited, previewToken: 'token-1', version: '3.1', private: false },
      ETAG
    );
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

  it('marks conflicts where the visual layout draws them, each once, and shares the choices (CA-32, CA-33, CA-83)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: EVERYWHERE }));
    await renderMerge();
    await showView('Visual');

    const markers = view.root.findAll(node => node.type === 'button' && node.props['data-conflicts'] !== undefined);
    expect(markers.reduce((sum, marker) => sum + marker.props['data-conflicts'], 0)).toBe(EVERYWHERE.length);

    // A plan's value of a feature is a cell of the table.
    const cell = view.root.findAll(node => node.type === 'td' && textOf(node).includes('Conflict'));
    expect(cell).toHaveLength(1);
    expect(textOf(cell[0])).toBe('YesConflict');
    // The order of the plans goes to the header of its section.
    const plansHeader = view.root.find(node => node.type === 'h4' && textOf(node) === 'Plans').parent!;
    expect(textOf(plansHeader)).toBe('PlansConflict');
    // What the layout does not draw is listed as text under "Other fields".
    const others = view.root.find(node => node.type === 'section' && textOf(node).startsWith('Other fields'));
    const labels = others.findAllByType('code').map(textOf);
    expect(labels).toEqual(['billing', 'url', 'tags', 'custom.x', 'plans.GONE.price']);
    expect(textOf(others)).toContain('javascript:alert(1)');
    expect(textOf(others)).toContain('Not in the result');

    await act(async () => cell[0].findByType('button').props.onClick());
    await choose(SSO, 'Use proposal');
    await showView('Conflicts');
    expect(button('Use proposal', card(SSO)).props['aria-pressed']).toBe(true);
    expect(text()).toContain(`${EVERYWHERE.length} conflicts · ${EVERYWHERE.length - 1} unresolved`);
  });

  it('shows values as text, never as links or markup (CA-80)', async () => {
    mocks.previewPullRequestMerge.mockResolvedValue(preview({ conflicts: EVERYWHERE }));
    await renderMerge();
    for (const label of ['Conflicts', 'Visual']) {
      await showView(label);
      expect(text()).toContain('javascript:alert(1)');
      expect(view.root.findAll(node => node.type === 'a' || node.type === 'img')).toHaveLength(0);
      expect(view.root.findAll(node => 'href' in node.props || 'dangerouslySetInnerHTML' in node.props)).toHaveLength(0);
    }
  });

  it('stands in for the visual layout while the result cannot be read (CA-34)', async () => {
    await renderMerge();
    await showView('YAML');
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'plans: [\n' } }));
    await showView('Visual');
    expect(view.root.findAllByType(VisualEditorUnavailable)).toHaveLength(1);
    await act(async () => button('Back to the code editor').props.onClick());
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
    await renderMerge();
    const list = view.root.findByProps({ role: 'group', 'aria-label': 'Conflicts' });
    const active = () => view.root.find(node => node.type === 'article' && node.props['aria-current'] === 'true').props['data-conflict-id'];
    const key = (key: string, altKey = true) => act(async () => list.props.onKeyDown({ key, altKey, preventDefault: () => {} }));
    expect(active()).toBe(EVERYWHERE[0].id);
    await key('ArrowDown');
    await key('ArrowDown');
    expect(active()).toBe(EVERYWHERE[2].id);
    await key('ArrowUp');
    expect(active()).toBe(EVERYWHERE[1].id);
    await key('ArrowDown', false);
    expect(active()).toBe(EVERYWHERE[1].id);

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
    expect(mocks.previewPullRequestMerge).toHaveBeenCalledWith(PR_ID, 'update', {});
    expect(text()).toContain('after updating, the pull request has no changes');
    await act(async () => button('Update pull request').props.onClick());
    expect(mocks.updatePullRequestToLatest).toHaveBeenCalledWith(PR_ID, { resolutions: {}, previewToken: 'token-1' });
    expect(onUpdated).toHaveBeenCalledWith({ id: PR_ID, warnings: [] });
  });
});
