import { NextFunction, Request, Response } from 'express';

/** Whether the user opted in to beta features in Settings → Beta features. */
export function hasBetaFeatures(user: any): boolean {
  return user?.settings?.betaFeatures === true;
}

/**
 * Restricts a route to users who opted in to beta features. Place it after the
 * authentication middlewares, e.g. `.post(requireBetaFeatures, controller.action)`.
 */
export function requireBetaFeatures(req: Request, res: Response, next: NextFunction) {
  if (!hasBetaFeatures((req as any).user)) {
    return res.status(403).json({ error: 'PERMISSION ERROR: Beta features are not enabled for this user' });
  }
  return next();
}
