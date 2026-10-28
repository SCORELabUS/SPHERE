import type { Request, Response } from 'express';
import container from '../config/container';
import OAuthService from '../services/OAuthService';
import { handleError } from '../utils/users/helpers';

export default class OAuthController {
  handle = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if ((req as any).authType !== 'token') return res.status(401).json({ error: 'A SPHERE web session is required' });
    const service: OAuthService = container.resolve('oauthService');
    const userId = (req as any).user.id;
    try {
      if (req.params.requestId) {
        return res.json(req.method === 'GET'
          ? await service.consentRequest(req.params.requestId, userId)
          : await service.decide(req.params.requestId, userId, req.body.approve, req.body.scopes));
      }
      if (req.method === 'GET') return res.json(await service.listGrants(userId));
      if (req.method === 'PUT') await service.updateGrant(userId, req.params.grantId, req.body.scopes);
      else await service.revokeGrant(userId, req.params.grantId);
      return res.status(204).end();
    } catch (error) {
      const { status, message } = handleError(error);
      return res.status(status).json({ error: message });
    }
  };
}
