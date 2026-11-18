import { NextFunction, Request, Response } from 'express';

const ANONYMOUS_PREFIX = `${process.env.BASE_URL_PATH ?? ''}/api/v1/anonymous-pricings/`.toLowerCase();

/**
 * What an anonymous link shows is the same for everyone, so its requests are
 * read as anonymous whatever they carry: the credentials are dropped before
 * authentication. No caller gets a different answer (or a 401 for a stale
 * token) to tell them apart, and the rate limit counts them by address.
 */
export function anonymousAccess(req: Request, _res: Response, next: NextFunction) {
  // Express matches routes regardless of case, so the prefix is compared the same way.
  if (req.path.toLowerCase().startsWith(ANONYMOUS_PREFIX)) {
    delete req.headers.authorization;
    delete req.headers['x-api-key'];
    delete req.headers.cookie;
  }
  next();
}
