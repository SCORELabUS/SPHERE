import { Request, Response, NextFunction } from 'express';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { handleError, verifyJwtToken } from '../utils/users/helpers';
import { ROLE_WEIGHT } from '../types/models/Organization';
import OAuthService, { oauthChallenge } from '../services/OAuthService';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

/**
 * Authentication middleware.
 * Populates req.user from JWT token or API key.
 * Does NOT check route permissions — that is AuthorizationMiddleware's job.
 */
const authenticationMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader: string = req.headers.authorization || '';
  const apiKeyHeader: string = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'] || ('' as string);

  try {
    const isMcp = req.path === (process.env.BASE_URL_PATH ?? '') + '/api/v1/orbit/mcp';
    if (isMcp) res.setHeader('WWW-Authenticate', oauthChallenge());
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const apiKey = apiKeyHeader;

    if (token && token !== 'null') {
      if (token.startsWith('sph_oat_')) {
        if (!isMcp) return res.status(401).json({ error: 'OAuth access tokens are restricted to MCP' });
        const service: OAuthService = container.resolve('oauthService');
        let auth;
        try { auth = await service.authenticate(token); }
        catch (error) {
          if (!(error instanceof InvalidTokenError)) throw error;
          res.setHeader('WWW-Authenticate', oauthChallenge() + ', error="invalid_token"');
          return res.status(401).json({ error: 'invalid_token' });
        }
        (req as any).user = auth.user;
        (req as any).mcpCredential = auth.credential;
        (req as any).authType = 'oauth';
      } else {
        await authenticateToken(req, token);
      }
    } else if (apiKey) {
      await authenticateApiKey(req, apiKey);
    }

    next();
  } catch (err: any) {
    if (!res.headersSent) {
      const { status, message } = handleError(err);
      return res.status(status).json({ error: message });
    }
  }
};

async function authenticateApiKey(req: Request, apiKey: string): Promise<void> {
  const userRepository: UserRepository = container.resolve('userRepository');
  const user = await userRepository.findByApiKey(apiKey);

  if (!user) {
    throw new Error('UNAUTHORIZED: Invalid API Key. Maybe the key is invalid, revoked, or expired');
  }

  if (!user.apiKey || user.apiKey.revoked) {
    throw new Error('UNAUTHORIZED: API Key revoked');
  }

  if (user.apiKey.expiresAt && new Date() > new Date(user.apiKey.expiresAt)) {
    throw new Error('UNAUTHORIZED: API Key expired');
  }

  (req as any).user = user;
  (req as any).authType = 'api-key';
}

async function authenticateToken(req: Request, token: string): Promise<void> {
  const userRepository: UserRepository = container.resolve('userRepository');

  let decoded: { id: string; username: string; role: string };
  try {
    decoded = verifyJwtToken(token);
  } catch {
    throw new Error('UNAUTHORIZED: Invalid or expired token');
  }

  const user = await userRepository.findById(decoded.id);
  if (!user) {
    throw new Error('UNAUTHORIZED: User not found');
  }

  (req as any).user = user;
  (req as any).authType = 'token';
}

/**
 * Resolves the caller of a request that is not behind authenticationMiddleware
 * (static files), without failing it: missing or invalid credentials make the
 * caller anonymous instead of answering 401, so public files keep being
 * served to clients that send a stale token. Does not modify `req`.
 */
export async function resolveRequestUser(
  req: Request
): Promise<{ user: any; authType: 'token' | 'api-key' } | null> {
  if ((req as any).user) {
    return { user: (req as any).user, authType: (req as any).authType };
  }

  const authHeader: string = req.headers.authorization || '';
  const apiKeyHeader: string = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
  const holder: any = {};

  try {
    if (token && token !== 'null') {
      await authenticateToken(holder, token);
    } else if (apiKeyHeader) {
      await authenticateApiKey(holder, apiKeyHeader);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  return { user: holder.user, authType: holder.authType };
}

export function extractOrganizationIdFromPath(path: string): string | undefined {
  const segments = path
    .replace('/api/v1' + (process.env.BASE_URL_PATH ?? ''), '')
    .split('/')
    .filter(Boolean);

  if (segments[0] !== 'orgs' && segments[0] !== 'pricings' && segments[0] !== 'collections') {
    return undefined;
  }

  const organizationId = segments[1];
  if (!organizationId || organizationId === 'invitations' || organizationId === 'join') {
    return undefined;
  }

  return organizationId;
}

export { authenticationMiddleware };
