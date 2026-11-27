import container from '../config/container';
import PricingAnonymousLinkService from '../services/PricingAnonymousLinkService';
import { handleError } from '../utils/users/helpers';

const UNAVAILABLE = { error: 'Link not available' };

/**
 * The same for every answer of the public routes, whatever happened: never
 * stored, never indexed, and no Referer with the token leaves the page.
 */
function setPublicHeaders(res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/** The name of a downloaded file: the version's label, nothing that names the pricing or who published it. */
function downloadName(version: string) {
  const safe = version.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  return `pricing-${safe || 'version'}.yml`;
}

class PricingAnonymousLinkController {
  private service: PricingAnonymousLinkService;

  constructor() {
    this.service = container.resolve('pricingAnonymousLinkService');
    this.list = this.list.bind(this);
    this.create = this.create.bind(this);
    this.revoke = this.revoke.bind(this);
    this.show = this.show.bind(this);
    this.yaml = this.yaml.bind(this);
    this.configurationSpace = this.configurationSpace.bind(this);
  }

  async list(req: any, res: any) {
    try {
      res.json(await this.service.list(req.user, req.query.pricingId));
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  async create(req: any, res: any) {
    try {
      res.status(201).json(await this.service.create(req.user, req.body?.versionId, req.body?.allVersions === true));
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  async revoke(req: any, res: any) {
    try {
      await this.service.revoke(req.user, req.params.linkId);
      res.status(204).end();
    } catch (err: any) {
      this.sendError(res, err);
    }
  }

  async show(req: any, res: any) {
    setPublicHeaders(res);
    try {
      const resolved = await this.service.resolve(req.params.token, typeof req.query.version === 'string' ? req.query.version : undefined);
      if (!resolved) return res.status(404).json(UNAVAILABLE);
      res.json(resolved.pricing);
    } catch {
      res.status(503).json(UNAVAILABLE);
    }
  }

  async configurationSpace(req: any, res: any) {
    setPublicHeaders(res);
    const limit = Number(req.query.limit ?? 200);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000 || !Number.isInteger(offset) || offset < 0) return res.status(400).json({ error: 'Invalid pagination' });
    try {
      const result = await this.service.configurationSpace(req.params.token, limit, offset, typeof req.query.version === 'string' ? req.query.version : undefined);
      if (!result) return res.status(404).json(UNAVAILABLE);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return res.status(400).json({ error: message === 'DeadFeatureError' ? message : 'Configuration space could not be calculated' });
    }
  }

  async yaml(req: any, res: any) {
    setPublicHeaders(res);
    try {
      const resolved = await this.service.resolve(req.params.token, typeof req.query.version === 'string' ? req.query.version : undefined);
      if (!resolved) return res.status(404).json(UNAVAILABLE);
      res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName(resolved.pricing.version)}"`);
      res.send(resolved.file);
    } catch {
      res.status(503).json(UNAVAILABLE);
    }
  }

  private sendError(res: any, err: any) {
    const { status, message } = handleError(err);
    res.status(status).send({ error: message });
  }
}

export default PricingAnonymousLinkController;
