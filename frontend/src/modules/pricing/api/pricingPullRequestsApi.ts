import { useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { ifMatchHeader, PRICING_CHANGED_MESSAGE } from './pricingsApi';
import type {
  ConflictResolutions,
  CreatedPullRequest,
  ForkTarget,
  MergePreviewPurpose,
  NewForkPullRequest,
  NewTextPullRequest,
  PullRequestDetail,
  PullRequestErrorCode,
  PullRequestList,
  PullRequestMergeRequest,
  PullRequestMergeResult,
  PullRequestPreview,
  PullRequestSource,
  PullRequestStatus,
  PullRequestUpdate,
  PullRequestVersionRef,
  PullRequestWithWarnings,
} from '../types/pull-requests';

export const PULL_REQUESTS_BASE_PATH = import.meta.env.VITE_API_URL + '/pricing-pull-requests';

/**
 * A refusal of the pull request routes, with the server's `code` and the
 * details some codes carry: the latest public version (`BASE_NOT_LATEST`), the
 * number of the open pull request (`PULL_REQUEST_EXISTS`), the line of a YAML
 * error and the conflicts a resolution left out. A 412 keeps `status`, so
 * `isPricingChangedError` recognises it.
 */
export class PullRequestApiError extends Error {
  readonly status: number;
  readonly code?: PullRequestErrorCode;
  readonly latest?: PullRequestVersionRef;
  readonly number?: number;
  readonly line?: number;
  readonly conflictIds?: string[];
  /** For a 429, the seconds until the limit lets requests through again, when the server says. */
  readonly retryAfter?: number;

  constructor(status: number, body: Record<string, unknown>, retryAfter?: number) {
    super(
      status === 412
        ? PRICING_CHANGED_MESSAGE
        : typeof body.error === 'string'
          ? body.error
          : `The pull request service answered ${status}`
    );
    this.name = 'PullRequestApiError';
    this.status = status;
    if (typeof body.code === 'string') this.code = body.code as PullRequestErrorCode;
    if (body.latest && typeof body.latest === 'object') this.latest = body.latest as PullRequestVersionRef;
    if (typeof body.number === 'number') this.number = body.number;
    if (typeof body.line === 'number') this.line = body.line;
    if (Array.isArray(body.conflictIds)) this.conflictIds = body.conflictIds as string[];
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/**
 * The seconds a 429 asks to wait: its `Retry-After` header (seconds or a date),
 * or else the "Try again in N seconds" of the limiter's message, since a
 * cross-origin client is not shown that header.
 */
export function retryAfterOf(response: Response, body: Record<string, unknown>): number | undefined {
  const header = response.headers?.get('Retry-After')?.trim();
  if (header) {
    if (/^\d+$/.test(header)) return Number(header);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const match = typeof body.error === 'string' ? /try again in (\d+) seconds?/i.exec(body.error) : null;
  return match ? Number(match[1]) : undefined;
}

async function readBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fields = (body ?? {}) as Record<string, unknown>;
    throw new PullRequestApiError(
      response.status,
      fields,
      response.status === 429 ? retryAfterOf(response, fields) : undefined
    );
  }
  return body as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function usePricingPullRequestsApi() {
  const { fetchWithInterceptor } = useAuth();

  const send = useCallback(
    async <T>(path: string, init?: { method: 'POST' | 'PUT'; body: unknown; headers?: Record<string, string> }) => {
      const response = await fetchWithInterceptor(
        PULL_REQUESTS_BASE_PATH + path,
        init
          ? { method: init.method, headers: { ...JSON_HEADERS, ...init.headers }, body: JSON.stringify(init.body) }
          : { method: 'GET' }
      );
      return { response, body: await readBody<T>(response) };
    },
    [fetchWithInterceptor]
  );

  /** The pull requests of a pricing the caller may see, and whether they may open one now. */
  const listPullRequests = useCallback(
    async (pricingId: string, options: { status?: PullRequestStatus; page?: number } = {}) => {
      const params = new URLSearchParams({ pricingId });
      if (options.status) params.set('status', options.status);
      if (options.page !== undefined) params.set('page', String(options.page));
      return (await send<PullRequestList>(`?${params.toString()}`)).body;
    },
    [send]
  );

  const getPullRequest = useCallback(
    async (id: string) => (await send<PullRequestDetail>(`/${encodeURIComponent(id)}`)).body,
    [send]
  );

  /** Whether the caller may propose the fork's latest version to the pricing it was forked from. */
  const getForkTarget = useCallback(
    async (forkPricingId: string) =>
      (await send<ForkTarget>(`/fork-target?${new URLSearchParams({ forkPricingId }).toString()}`)).body,
    [send]
  );

  /** The merge a proposal would make, without creating anything. */
  const previewProposal = useCallback(
    async (source: PullRequestSource, resolutions?: ConflictResolutions) =>
      (await send<PullRequestPreview>('/previews', { method: 'POST', body: { source, resolutions } })).body,
    [send]
  );

  /** Opens a pull request; from a fork it replaces the author's open one (`updated: true`). */
  const createPullRequest = useCallback(
    async (request: NewTextPullRequest | NewForkPullRequest) =>
      (await send<CreatedPullRequest>('', { method: 'POST', body: request })).body,
    [send]
  );

  const previewPullRequestMerge = useCallback(
    async (id: string, purpose: MergePreviewPurpose, resolutions?: ConflictResolutions) =>
      (
        await send<PullRequestPreview>(`/${encodeURIComponent(id)}/merge-preview`, {
          method: 'POST',
          body: { purpose, resolutions },
        })
      ).body,
    [send]
  );

  /** Brings the pull request up to the latest public version, as its update preview showed. */
  const updatePullRequestToLatest = useCallback(
    async (id: string, update: PullRequestUpdate) =>
      (await send<PullRequestWithWarnings>(`/${encodeURIComponent(id)}/update`, { method: 'POST', body: update })).body,
    [send]
  );

  /**
   * Publishes the pull request as a new version. `etag` is the pricing's ETag as
   * the page loaded it; the answer carries the new one when the server sends it.
   */
  const mergePullRequest = useCallback(
    async (id: string, request: PullRequestMergeRequest, etag?: string | null): Promise<PullRequestMergeResult> => {
      const { response, body } = await send<Omit<PullRequestMergeResult, 'etag'>>(`/${encodeURIComponent(id)}/merge`, {
        method: 'POST',
        body: request,
        headers: ifMatchHeader(etag),
      });
      return { ...body, etag: response.headers.get('ETag') ?? undefined };
    },
    [send]
  );

  const closePullRequest = useCallback(
    async (id: string, reason?: string) =>
      (await send<PullRequestDetail>(`/${encodeURIComponent(id)}/close`, { method: 'POST', body: { reason } })).body,
    [send]
  );

  return {
    listPullRequests,
    getPullRequest,
    getForkTarget,
    previewProposal,
    createPullRequest,
    previewPullRequestMerge,
    updatePullRequestToLatest,
    mergePullRequest,
    closePullRequest,
  };
}
