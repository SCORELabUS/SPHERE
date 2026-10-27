import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import PricingMongoose from '../repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../repositories/mongoose/models/PricingCollectionMongoose';
import { resolveRequestUser } from './AuthenticationMiddleware';

/**
 * Folders whose files are written by users (pricing uploads and extracted
 * collection archives). A file in them is only served when a pricing version
 * references it; anything else there (drafts, orphans left after deleting a
 * version, archive leftovers) is never served.
 */
const USER_UPLOAD_FOLDERS = ['static/pricings/uploaded/', 'static/collections/'];

const PRICING_FILE = /\.ya?ml$/i;

type VersionReference = {
  private?: boolean;
  slug?: string;
  _organizationId: unknown;
  _collectionId?: string | null;
};

/**
 * The path, relative to the static root, that `express.static` would serve for
 * this request, or null when it would not serve a file at all (malformed
 * encoding, NUL bytes or parent-directory segments, which `send` rejects).
 */
export function resolveStaticPath(req: Request): string | null {
  // Same pathname serve-static uses (parseurl), relative to the mount point.
  const pathname = req.path;
  if (!pathname) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) return null;
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)) return null;

  return path.posix.normalize(decoded).replace(/^\/+/, '');
}

function isUserUpload(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return USER_UPLOAD_FOLDERS.some(folder => lower.startsWith(folder));
}

async function findVersionsReferencing(relativePath: string): Promise<VersionReference[]> {
  // Case-insensitive so a case-insensitive file system (macOS development
  // setups) cannot be used to reach a private file under another spelling.
  return PricingMongoose.find({ yaml: { $in: [relativePath, '/' + relativePath] } })
    .collation({ locale: 'en', strength: 2 })
    .select('private slug _organizationId _collectionId')
    .lean<VersionReference[]>();
}

async function canReadPrivateVersion(req: Request, version: VersionReference): Promise<boolean> {
  const caller = await resolveRequestUser(req);
  if (!caller || !version.slug) return false;

  const collection = version._collectionId
    ? await PricingCollectionMongoose.findById(version._collectionId).select('slug').lean<{ slug?: string }>()
    : null;

  const { default: container } = await import('../config/container');
  const permanentLinkService = container.resolve('permanentLinkService');

  try {
    await permanentLinkService.authorize(
      caller.user,
      String(version._organizationId),
      'pricing',
      version.slug,
      collection?.slug,
      caller.authType
    );
    return true;
  } catch {
    return false;
  }
}

type StaticDecision = 'public' | 'private' | 'hidden';

async function decide(req: Request, relativePath: string): Promise<StaticDecision> {
  const userUpload = isUserUpload(relativePath);
  if (!userUpload && !PRICING_FILE.test(relativePath)) return 'public';

  const versions = await findVersionsReferencing(relativePath);
  if (versions.length === 0) return userUpload ? 'hidden' : 'public';

  // Every version that points at this file has the same bytes, so one public
  // version makes the file public.
  if (versions.some(version => version.private !== true)) return 'public';

  for (const version of versions) {
    if (await canReadPrivateVersion(req, version)) return 'private';
  }
  return 'hidden';
}

/**
 * Serves `root` like `express.static`, except pricing YAML files: the file of
 * a private version is only served to callers allowed to read that version
 * (same rules as the rest of the API), and user-uploaded files that no version
 * references are not served. A file the caller may not read is handled exactly
 * like a file that does not exist, so its existence is not revealed.
 */
export function protectedStatic(root: string, options?: Parameters<typeof express.static>[1]): RequestHandler {
  const serve = express.static(root, options);

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const relativePath = resolveStaticPath(req);
    // Let express.static answer requests it would reject or not map to a file.
    if (relativePath === null) return serve(req, res, next);

    let decision: StaticDecision;
    try {
      decision = await decide(req, relativePath);
    } catch (error) {
      console.error('Unable to check access to a static file', error);
      decision = 'hidden';
    }

    if (decision === 'hidden') return next();

    if (decision === 'private') {
      // `send` keeps a Cache-Control header that is already set.
      res.setHeader('Cache-Control', 'private, no-store');
    }

    return serve(req, res, next);
  };
}
