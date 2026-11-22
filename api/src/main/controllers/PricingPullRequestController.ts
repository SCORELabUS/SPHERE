import container from '../config/container';
import PricingPullRequestService, { ForkSource } from '../services/PricingPullRequestService';
import { PullRequestError } from '../types/models/PricingPullRequest';
import { parseIfMatch, PreconditionFailedError } from '../utils/pricing-etag';
import { PricingMergeError } from '../utils/pricing-merge';
import { PricingYamlError } from '../utils/pricing-syntax';
import { handleError } from '../utils/users/helpers';

/** Answers `{ error, code, ...details }` for the typed refusals, and as `handleError` says for anything else. */
function sendError(res: any, err: unknown) {
  if (err instanceof PullRequestError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...err.details });
  }
  if (err instanceof PricingYamlError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.line !== undefined ? { line: err.line } : {}) });
  }
  if (err instanceof PreconditionFailedError) {
    // The pricing's current tag, only when the caller may read it.
    if (err.currentEtag) res.set('ETag', err.currentEtag);
    return res.status(412).json({ error: err.message, code: 'PRECONDITION_FAILED' });
  }
  if (err instanceof PricingMergeError) {
    return res.status(err.status).json({ error: err.message, code: err.code, conflictIds: err.conflictIds });
  }
  const { status, message } = handleError(err);
  return res.status(status).json({ error: message });
}

/** A fork source as the service takes it: the fork and, when named, the version of it to propose. */
const forkSourceOf = (source: { forkPricingId: string; versionId?: string }): ForkSource => ({
  kind: 'fork',
  forkPricingId: source.forkPricingId,
  ...(source.versionId !== undefined ? { versionId: source.versionId } : {}),
});

class PricingPullRequestController {
  private pricingPullRequestService: PricingPullRequestService;

  constructor() {
    this.pricingPullRequestService = container.resolve('pricingPullRequestService');
    this.requireWebSession = this.requireWebSession.bind(this);
    this.index = this.index.bind(this);
    this.create = this.create.bind(this);
    this.forkTarget = this.forkTarget.bind(this);
    this.preview = this.preview.bind(this);
    this.show = this.show.bind(this);
    this.update = this.update.bind(this);
    this.mergePreview = this.mergePreview.bind(this);
    this.updateToLatest = this.updateToLatest.bind(this);
    this.close = this.close.bind(this);
    this.merge = this.merge.bind(this);
  }

  /**
   * Pull requests are only for SPHERE web sessions: an API key reaches these
   * routes (they are outside /pricings/**, where its scopes would apply) and is
   * refused here, before anything else runs. OAuth tokens never get this far.
   */
  requireWebSession(req: any, res: any, next: () => void) {
    if (req.authType !== 'token') {
      return sendError(res, new PullRequestError(401, 'WEB_SESSION_REQUIRED', 'A SPHERE web session is required'));
    }
    return next();
  }

  async index(req: any, res: any) {
    try {
      const result = await this.pricingPullRequestService.list(req.user, {
        pricingId: String(req.query.pricingId),
        status: req.query.status,
        page: req.query.page,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  }

  async create(req: any, res: any) {
    try {
      const { title, description, source } = req.body;
      if (source.kind === 'fork') {
        const { resolutions, manualYaml, previewToken } = req.body;
        const result = await this.pricingPullRequestService.proposeFromFork(req.user, {
          title,
          description,
          source: forkSourceOf(source),
          resolutions,
          manualYaml,
          previewToken,
        });
        // The author's open pull request from the fork took the new proposal.
        if (!result.created) return res.json({ updated: true, ...result.pullRequest });
        return res.status(201).json(result.pullRequest);
      }
      const result = await this.pricingPullRequestService.create(req.user, {
        title,
        description,
        source: { kind: 'text', pricingId: source.pricingId, baseVersionId: source.baseVersionId, proposedYaml: source.proposedYaml },
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  }

  async forkTarget(req: any, res: any) {
    try {
      res.json(await this.pricingPullRequestService.forkTarget(req.user, String(req.query.forkPricingId)));
    } catch (err) {
      sendError(res, err);
    }
  }

  async preview(req: any, res: any) {
    try {
      const { source, resolutions } = req.body;
      const normalized = source.kind === 'fork'
        ? forkSourceOf(source)
        :{ kind: 'text' as const, pricingId: source.pricingId, baseVersionId: source.baseVersionId, proposedYaml: source.proposedYaml };
      res.json(await this.pricingPullRequestService.preview(req.user, { source: normalized, resolutions }));
    } catch (err) {
      sendError(res, err);
    }
  }

  async mergePreview(req: any, res: any) {
    try {
      const { purpose, resolutions } = req.body;
      res.json(await this.pricingPullRequestService.mergePreview(req.user, req.params.pullRequestId, { purpose, resolutions }));
    } catch (err) {
      sendError(res, err);
    }
  }

  async updateToLatest(req: any, res: any) {
    try {
      const { resolutions, manualYaml, previewToken } = req.body;
      res.json(await this.pricingPullRequestService.update(req.user, req.params.pullRequestId, { resolutions, manualYaml, previewToken }));
    } catch (err) {
      sendError(res, err);
    }
  }

  async merge(req: any, res: any) {
    try {
      const { version, resolutions, manualYaml, previewToken } = req.body;
      const result = await this.pricingPullRequestService.merge(
        req.user,
        req.params.pullRequestId,
        { version, private: req.body.private, resolutions, manualYaml, previewToken },
        parseIfMatch(req.headers['if-match'])
      );
      // Only set for who may read the pricing's private versions.
      if (result.etag) res.set('ETag', result.etag);
      res.json({ pullRequest: result.pullRequest, version: result.version });
    } catch (err) {
      sendError(res, err);
    }
  }

  async show(req: any, res: any) {
    try {
      res.json(await this.pricingPullRequestService.show(req.user, req.params.pullRequestId));
    } catch (err) {
      sendError(res, err);
    }
  }

  async update(req: any, res: any) {
    try {
      const { title, description, proposedYaml } = req.body;
      res.json(await this.pricingPullRequestService.edit(req.user, req.params.pullRequestId, { title, description, proposedYaml }));
    } catch (err) {
      sendError(res, err);
    }
  }

  async close(req: any, res: any) {
    try {
      res.json(await this.pricingPullRequestService.close(req.user, req.params.pullRequestId, req.body.reason));
    } catch (err) {
      sendError(res, err);
    }
  }
}

export default PricingPullRequestController;
