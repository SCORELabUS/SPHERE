import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import PricingMongoose, { YAML_PATH_COLLATION } from '../repositories/mongoose/models/PricingMongoose';
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
 * The file, relative to the static root, that this request designates, or
 * null when the request must not be served by the static handler at all.
 *
 * The decision is always taken on this canonical path, and the static handler
 * only ever receives a request whose path is exactly this canonical one, so
 * alternative spellings (`..` or `.` segments that stay inside the root,
 * encoded dots or slashes, empty segments) cannot reach a file without the
 * same check as its canonical URL. Requests that `send` would reject
 * (malformed encoding, NUL bytes) or that point outside the root are not
 * served either; neither are backslashes, which are separators on Windows.
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

  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  // Relative to the root; a result that still starts with `..` climbs above
  // the root (which `send` would refuse).
  const relative = path.posix.normalize(decoded.replace(/^\/+/, ''));
  if (relative === '..' || relative.startsWith('../')) return null;

  return relative === '.' ? '' : relative;
}

function isUserUpload(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return USER_UPLOAD_FOLDERS.some(folder => lower.startsWith(folder));
}

async function findVersionsReferencing(relativePath: string): Promise<VersionReference[]> {
  // Case-insensitive so a case-insensitive file system (macOS development
  // setups) cannot be used to reach a private file under another spelling.
  // Served by the `yaml` index with the same collation (PricingMongoose).
  return PricingMongoose.find({ yaml: { $in: [relativePath, '/' + relativePath] } })
    .collation(YAML_PATH_COLLATION)
    .select('private slug _organizationId _collectionId')
    .lean<VersionReference[]>();
}

type Caller = NonNullable<Awaited<ReturnType<typeof resolveRequestUser>>>;

async function canReadPrivateVersion(caller: Caller, version: VersionReference): Promise<boolean> {
  if (!version.slug) return false;

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

  const caller = await resolveRequestUser(req);
  if (!caller) return 'hidden';
  for (const version of versions) {
    if (await canReadPrivateVersion(caller, version)) return 'private';
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
    // Not a file under the root: answered like any other missing file.
    if (relativePath === null) return next();

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

    // Serve exactly the file the decision was taken on, whatever the
    // spelling of the request (the query string is kept). When there is no
    // such file the request continues with its original URL.
    const originalUrl = req.url;
    const query = originalUrl.indexOf('?');
    req.url = '/' + relativePath.split('/').map(encodeURIComponent).join('/') +
      (query === -1 ? '' : originalUrl.slice(query));
    return serve(req, res, (error?: unknown) => {
      req.url = originalUrl;
      next(error);
    });
  };
}
