import container from '../config/container';
import PricingPullRequestService from '../services/PricingPullRequestService';
import { PullRequestError } from '../types/models/PricingPullRequest';
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
  const { status, message } = handleError(err);
  return res.status(status).json({ error: message });
}

class PricingPullRequestController {
  private pricingPullRequestService: PricingPullRequestService;

  constructor() {
    this.pricingPullRequestService = container.resolve('pricingPullRequestService');
    this.requireWebSession = this.requireWebSession.bind(this);
    this.index = this.index.bind(this);
    this.create = this.create.bind(this);
    this.show = this.show.bind(this);
    this.update = this.update.bind(this);
    this.close = this.close.bind(this);
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
      const result = await this.pricingPullRequestService.create(req.user, { title, description, source });
      res.status(201).json(result);
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
