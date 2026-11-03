import type { Request, Response } from 'express';
import container from '../config/container';
import OidcService, { OidcError } from '../services/OidcService';

export default class OidcController {
  handle = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    const service: OidcService = container.resolve('oidcService');
    try {
      if (req.path.endsWith('/openid-configuration')) return res.json(service.discovery());
      if (req.path.endsWith('/jwks')) return res.json(service.jwks());
      if (req.path.endsWith('/authorize')) return res.redirect(await service.authorize(req.query));
      if (req.path.endsWith('/token')) return res.json(await service.exchange(req.body));
      if (req.path.endsWith('/userinfo')) return res.json(await service.userinfo(req.headers.authorization?.replace(/^Bearer /, '') ?? ''));
      if ((req as any).authType !== 'token') return res.status(401).json({ error: 'A SPHERE web session is required' });
      return res.json(req.method === 'GET'
        ? await service.consentRequest(req.params.requestId, (req as any).user.id)
        : await service.decide(req.params.requestId, (req as any).user.id, req.body.approve));
    } catch (error) {
      if (error instanceof OidcError) {
        if (req.path.endsWith('/userinfo') && error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        return res.status(error.status).json({ error: error.code, error_description: error.message });
      }
      console.error('Identity provider request failed', error);
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'SPHERE sign-in is temporarily unavailable' });
    }
  };
}
