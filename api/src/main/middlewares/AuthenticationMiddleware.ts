import { Request, Response, NextFunction } from 'express';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { handleError, verifyJwtToken } from '../utils/users/helpers';
import { ROLE_WEIGHT } from '../types/models/Organization';

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
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const apiKey = apiKeyHeader;

    if (token && token !== 'null') {
      await authenticateToken(req, token);
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
