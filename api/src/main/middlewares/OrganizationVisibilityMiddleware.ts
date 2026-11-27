import { NextFunction, Request, Response } from 'express';
import { assertOrganizationReadable } from '../policies/organizationVisibility';

/** Public organization-scoped GET routes must apply the organization gate too. */
export async function organizationVisibilityMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const base = (process.env.BASE_URL_PATH ?? '') + '/api/v1';
  let path: string;
  try { path = decodeURIComponent(req.path); } catch { return res.status(400).json({ error: 'INVALID DATA: Invalid URL' }); }
  if (!path.startsWith(base + '/')) return next();
  const match = /^\/(?:orgs|pricings|collections|pricing-graphs)\/([a-f\d]{24})(?:\/|$)/i.exec(path.slice(base.length));
  if (!match) return next();
  try {
    await assertOrganizationReadable(match[1], (req as any).user, (req as any).authType);
    res.setHeader('Cache-Control', 'private, no-store');
    return next();
  } catch {
    return res.status(404).json({ error: 'NOT FOUND: Organization not found' });
  }
}
