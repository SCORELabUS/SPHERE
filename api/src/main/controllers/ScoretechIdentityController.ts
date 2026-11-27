import type { Request, Response, NextFunction } from 'express';
import container from '../config/container';
import ScoretechIdentityService from '../services/ScoretechIdentityService';
import { authenticationConfig, identityMode, scoretechConfig } from '../services/scoretech/config';
import { handleError } from '../utils/users/helpers';
import { SsoEmailConflictError } from '../services/AuthProviderService';
const cookieName = 'sphere_identity_session';
function cookie(request: Request, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(name + '='))
    ?.slice(name.length + 1);
}
function options() {
  const c = scoretechConfig();
  return { httpOnly: true, secure: c.secure, sameSite: 'lax' as const, path: c.base };
}
export default class ScoretechIdentityController {
  private service: ScoretechIdentityService = container.resolve('scoretechIdentityService');
  config = (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store').json(authenticationConfig());
  };
  private csrf(req: Request) {
    if (req.get('Origin') !== new URL(scoretechConfig().frontend).origin)
      throw Error('PERMISSION ERROR: Request origin is not allowed');
  }
  private async run(res: Response, operation: () => Promise<void>) {
    try {
      res.set('Cache-Control', 'no-store');
      await operation();
    } catch (error) {
      const result = handleError(error);
      res
        .status(String(error).includes('Identity unavailable') ? 503 : result.status)
        .json({ error: result.message });
    }
  }
  login = async (req: Request, res: Response) =>
    this.run(res, async () => {
      if (!identityMode()) {
        res.status(404).json({ error: 'Identity mode is disabled' });
        return;
      }
      const start = await this.service.begin(req.query.returnTo, req.query.screen === 'register');
      res.cookie('sphere_identity_flow_' + start.state, start.binding, {
        ...options(),
        maxAge: 600000,
      });
      res.redirect(start.url);
    });
  link = async (req: Request, res: Response) =>
    this.run(res, async () => {
      this.csrf(req);
      const actor = (req as any).user;
      if (identityMode() || !actor || (req as any).authType !== 'token')
        throw Error('PERMISSION ERROR: Sign in locally before connecting your existing account');
      const start = await this.service.begin('/me/settings', false, actor.id);
      res.cookie('sphere_identity_flow_' + start.state, start.binding, {
        ...options(),
        maxAge: 600000,
      });
      res.json({ url: start.url });
    });
  callback = async (req: Request, res: Response) => {
    let c: ReturnType<typeof scoretechConfig>;
    try { c = scoretechConfig(); } catch { res.status(404).json({ error: 'Identity is not configured' }); return; }
    res.set('Cache-Control', 'no-store');
    try {
      const state =
        typeof req.query.state === 'string' && /^[a-f0-9]{64}$/.test(req.query.state)
          ? req.query.state
          : '';
      const name = 'sphere_identity_flow_' + state;
      const result = await this.service.complete(
        state,
        cookie(req, name),
        req.query.code,
        req.query.error
      );
      res.clearCookie(name, options());
      if (result.sessionId) {
        const previous = cookie(req, cookieName);
        if (previous) await this.service.clearLocal(previous);
        res.cookie(cookieName, result.sessionId, { ...options(), maxAge: 30 * 86400000 });
      }
      res.redirect(
        c.frontend +
          (result.sessionId
            ? '/sso/identity/callback?returnTo=' + encodeURIComponent(result.returnTo)
            : result.returnTo)
      );
    } catch (error) {
      const detail =
        error instanceof Error &&
        /^(UNAUTHORIZED:|Identity unavailable:|CONFLICT:)/.test(error.message)
          ? error.message
          : error instanceof Error
            ? error.name
            : 'Unknown error';
      console.warn('[SCORETech Identity] callback failed:', detail, {
        claim: (error as { claim?: string })?.claim,
        reason: (error as { reason?: string })?.reason,
      });
      const code = error instanceof SsoEmailConflictError ? 'account_not_linked' : 'signin_failed';
      res.redirect(
        c.frontend +
          (!identityMode()
            ? '/me/settings?identity_error=scoretech_link_failed'
            : '/authentication?identity_error=' + code)
      );
    }
  };
  session = async (req: Request, res: Response) =>
    this.run(res, async () => {
      if (!identityMode()) {
        res.status(404).end();
        return;
      }
      this.csrf(req);
      res.json(await this.service.session(cookie(req, cookieName) || ''));
    });
  logout = async (req: Request, res: Response) =>
    this.run(res, async () => {
      if (!identityMode() && !process.env.SCORETECH_IDENTITY_CLIENT_ID) { res.status(404).end(); return; }
      this.csrf(req);
      const id = cookie(req, cookieName);
      res.clearCookie(cookieName, options());
      if (id) await this.service.logout(id);
      res.status(204).end();
    });
}
/** Keep credential changes in Identity and service-specific settings in SPHERE. */
export function identityModePolicy(req: Request, res: Response, next: NextFunction) {
  if (!identityMode()) return next();
  const path = req.path.toLowerCase().replace(((process.env.BASE_URL_PATH || '') + '/api/v1').toLowerCase(), '').replace(/\/+$/, '');
  const localAuth = /^\/users\/(login|register|password\/|email-verification\/|auth\/sso\/)/.test(
    path
  );
  const owned =
    /^\/users\/me\/(password|identities)(\/|$)/.test(path) ||
    (path === '/users/me/settings' && req.method !== 'GET' &&
      !Object.keys(req.body || {}).every(key => ['firstName', 'lastName', 'phone'].includes(key))) ||
    /^\/users\/[^/]+\/refresh-token$/.test(path) ||
    (/^\/users\/[^/]+$/.test(path) &&
      req.method === 'PUT' &&
      !(
        Object.keys(req.body || {}).length > 0 && Object.keys(req.body).every(key => key === 'role')
      ));
  if (localAuth || (owned && req.method !== 'GET'))
    return res.status(409).json({ error: 'Manage your identity in SCORETech Identity.' });
  next();
}
