import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPricingChangedError } from './pricingsApi';
import { PullRequestApiError, usePricingPullRequestsApi } from './pricingPullRequestsApi';

vi.mock('../../auth/hooks/useAuth', () => ({ useAuth: () => ({
  authUser: { token: 'owner', user: { username: 'owner' } },
  // Like the real interceptor, which adds the session's Bearer token to every call.
  fetchWithInterceptor: (url: string, options?: RequestInit) => fetch(url, options),
}) }));

const PR_ID = '6650f0c0c0c0c0c0c0c0c0aa';

describe('pricing pull requests API', () => {
  let view: ReactTestRenderer;
  let api: ReturnType<typeof usePricingPullRequestsApi>;
  function Probe() { api = usePricingPullRequestsApi(); return null; }
  function mount(response: () => Response) {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => response());
    vi.stubGlobal('fetch', request);
    act(() => { view = create(<Probe />); });
    return request;
  }
  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  it('lists the pull requests of a pricing by its id, status and page', async () => {
    const list = { items: [], total: 0, counts: { open: 0, merged: 0, closed: 0 }, proposals: { canOpen: true, reason: null, latest: null }, viewer: { isMaintainer: false } };
    const request = mount(() => Response.json(list));
    expect(await api.listPullRequests('6650f0c0c0c0c0c0c0c0c001', { status: 'open', page: 2 })).toEqual(list);
    expect(request.mock.calls[0][0]).toMatch(/\/pricing-pull-requests\?pricingId=6650f0c0c0c0c0c0c0c0c001&status=open&page=2$/);
    expect(request.mock.calls[0][1]?.method).toBe('GET');
  });

  it('posts a text proposal and reads the fork target', async () => {
    const request = mount(() => Response.json({ id: PR_ID, number: 1, warnings: [] }, { status: 201 }));
    const source = { kind: 'text' as const, pricingId: 'p', baseVersionId: 'v2', proposedYaml: 'saasName: Demo\n' };
    await api.createPullRequest({ title: 'Raise PRO', source });
    const [url, init] = request.mock.calls[0];
    expect(url).toMatch(/\/pricing-pull-requests$/);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Raise PRO', source });

    await api.getForkTarget('6650f0c0c0c0c0c0c0c0c0f1');
    expect(request.mock.calls[1][0]).toMatch(/\/pricing-pull-requests\/fork-target\?forkPricingId=6650f0c0c0c0c0c0c0c0c0f1$/);
  });

  it('sends the previews, update and close to their routes with their bodies', async () => {
    const request = mount(() => Response.json({}));
    await api.previewProposal({ kind: 'fork', forkPricingId: 'f' }, { '["plans","PRO","price"]': 'current' });
    await api.previewPullRequestMerge(PR_ID, 'merge');
    await api.updatePullRequestToLatest(PR_ID, { resolutions: {}, previewToken: 't' });
    await api.editPullRequest(PR_ID, { title: 'New title' });
    await api.closePullRequest(PR_ID, 'Not now');
    const calls = request.mock.calls.map(([url, init]) => [String(url).replace(/^.*\/pricing-pull-requests/, ''), init?.method, JSON.parse(String(init?.body))]);
    expect(calls).toEqual([
      ['/previews', 'POST', { source: { kind: 'fork', forkPricingId: 'f' }, resolutions: { '["plans","PRO","price"]': 'current' } }],
      [`/${PR_ID}/merge-preview`, 'POST', { purpose: 'merge' }],
      [`/${PR_ID}/update`, 'POST', { resolutions: {}, previewToken: 't' }],
      [`/${PR_ID}`, 'PUT', { title: 'New title' }],
      [`/${PR_ID}/close`, 'POST', { reason: 'Not now' }],
    ]);
  });

  it('merges with the page ETag as If-Match and returns the new ETag', async () => {
    const result = { pullRequest: { id: PR_ID }, version: { id: 'v5', version: '5.0', private: false } };
    const request = mount(() => Response.json(result, { headers: { ETag: '"p.8"' } }));
    const body = { version: '5.0', private: false, resolutions: {}, previewToken: 't' };
    expect(await api.mergePullRequest(PR_ID, body, '"p.7"')).toEqual({ ...result, etag: '"p.8"' });
    const [url, init] = request.mock.calls[0];
    expect(url).toMatch(new RegExp(`/pricing-pull-requests/${PR_ID}/merge$`));
    expect(new Headers(init?.headers).get('If-Match')).toBe('"p.7"');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it('sends no If-Match without an ETag, and no ETag comes back for who may not read private versions', async () => {
    const result = { pullRequest: { id: PR_ID }, version: { id: 'v5', version: '5.0', private: false } };
    const request = mount(() => Response.json(result));
    const merged = await api.mergePullRequest(PR_ID, { version: '5.0', private: false, resolutions: {}, previewToken: 't' });
    expect(new Headers(request.mock.calls[0][1]?.headers).has('If-Match')).toBe(false);
    expect(merged.etag).toBeUndefined();
  });

  it('throws the server code with its details', async () => {
    mount(() => Response.json(
      { error: 'Pull requests start from the latest public version', code: 'BASE_NOT_LATEST', latest: { id: 'v4', version: '4.0' } },
      { status: 409 }
    ));
    const error = await api.createPullRequest({ title: 't', source: { kind: 'text', pricingId: 'p', baseVersionId: 'v2', proposedYaml: 'x' } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PullRequestApiError);
    expect(error).toMatchObject({ status: 409, code: 'BASE_NOT_LATEST', message: 'Pull requests start from the latest public version', latest: { id: 'v4', version: '4.0' } });
  });

  it('keeps the number of an open pull request, the line of a YAML error and the conflicts left out', async () => {
    const answers = [
      Response.json({ error: 'Pull request #3 from this fork is already open', code: 'PULL_REQUEST_EXISTS', number: 3 }, { status: 409 }),
      Response.json({ error: 'bad indentation', code: 'INVALID_PRICING', line: 12 }, { status: 400 }),
      Response.json({ error: 'Choose a side for every conflict', code: 'UNRESOLVED_CONFLICTS', conflictIds: ['["url"]'] }, { status: 409 }),
    ];
    mount(() => answers.shift()!);
    const fork = { title: 't', source: { kind: 'fork' as const, forkPricingId: 'f' }, resolutions: {}, previewToken: 't' };
    await expect(api.createPullRequest(fork)).rejects.toMatchObject({ code: 'PULL_REQUEST_EXISTS', number: 3 });
    await expect(api.editPullRequest(PR_ID, { proposedYaml: 'x' })).rejects.toMatchObject({ code: 'INVALID_PRICING', line: 12 });
    await expect(api.createPullRequest(fork)).rejects.toMatchObject({ code: 'UNRESOLVED_CONFLICTS', conflictIds: ['["url"]'] });
  });

  it('turns a 412 on merging into the pricing-changed error the page offers to reload for', async () => {
    mount(() => Response.json({ error: 'Precondition failed', code: 'PRECONDITION_FAILED' }, { status: 412, headers: { ETag: '"p.9"' } }));
    const error = await api.mergePullRequest(PR_ID, { version: '5.0', private: false, resolutions: {}, previewToken: 't' }, '"p.7"')
      .catch((caught: unknown) => caught);
    expect(isPricingChangedError(error)).toBe(true);
    expect(error).toMatchObject({ status: 412, code: 'PRECONDITION_FAILED' });
    expect((error as Error).message).toMatch(/Someone else changed this pricing/);
  });

  it('keeps how long a 429 asks to wait, from Retry-After or else from the limiter\'s message', async () => {
    const limited = (headers: Record<string, string>, error = 'TOO MANY REQUESTS: Rate limit exceeded. Try again in 42 seconds.') =>
      Response.json({ error }, { status: 429, headers });
    const preview = () => api.previewPullRequestMerge(PR_ID, 'merge').catch((caught: unknown) => caught);

    mount(() => limited({ 'Retry-After': '17' }));
    expect(await preview()).toMatchObject({ status: 429, retryAfter: 17 });
    act(() => view.unmount());

    // Cross-origin, the header is not shown to the page: the message says it too.
    mount(() => limited({}));
    expect(await preview()).toMatchObject({ status: 429, retryAfter: 42 });
    act(() => view.unmount());

    mount(() => limited({}, 'Slow down'));
    expect(((await preview()) as PullRequestApiError).retryAfter).toBeUndefined();
    act(() => view.unmount());

    // Only a 429 waits.
    mount(() => Response.json({ error: 'Try again in 5 seconds.' }, { status: 503, headers: { 'Retry-After': '5' } }));
    expect(((await preview()) as PullRequestApiError).retryAfter).toBeUndefined();
  });

  it('survives an error without a JSON body', async () => {
    mount(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await api.getPullRequest(PR_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PullRequestApiError);
    expect(error).toMatchObject({ status: 502, code: undefined });
    expect((error as Error).message).toBe('The pull request service answered 502');
  });
});
