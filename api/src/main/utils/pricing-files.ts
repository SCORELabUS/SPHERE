import fs from 'fs';
import path from 'path';

/** The folder the stored paths of pricing files are relative to. */
function staticsFolder(): string {
  return path.resolve(process.env.SERVER_STATICS_FOLDER || 'public/');
}

/**
 * The folders pricing files are stored in: uploads, forks and the seeded
 * datasets under `static/pricings`, and ZIP uploads under the collections
 * folder.
 */
function pricingFolders(): string[] {
  const base = staticsFolder();
  return [
    path.resolve(base, 'static', 'pricings'),
    path.resolve(base, process.env.COLLECTIONS_FOLDER || 'static/collections'),
  ];
}

function isInside(file: string, folder: string): boolean {
  return file.startsWith(folder + path.sep);
}

/**
 * The absolute path of a pricing file whose path the database stores
 * (`static/pricings/...` or `static/collections/...`), or null when it does
 * not land inside one of the folders pricing files live in. Symbolic links are
 * followed for whatever already exists, so a link cannot lead out either.
 * Every path the server builds from a stored `yaml` goes through here before
 * it is read, copied or written.
 */
export function resolvePricingFile(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored.trim() || stored.includes('\0') || stored.includes('\\')) return null;
  const absolute = path.resolve(staticsFolder(), stored);
  const folders = pricingFolders();
  const folder = folders.find(candidate => isInside(absolute, candidate));
  if (!folder) return null;

  let existing = absolute;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing);
  try {
    const real = fs.realpathSync(existing);
    const realFolder = fs.existsSync(folder) ? fs.realpathSync(folder) : folder;
    if (real !== realFolder && !isInside(real, realFolder)) return null;
  } catch {
    return null;
  }
  return absolute;
}

/** Like `resolvePricingFile`, but throws NOT FOUND instead of answering null. */
export function requirePricingFile(stored: unknown): string {
  const file = resolvePricingFile(stored);
  if (!file) throw new Error('NOT FOUND: Pricing file not found');
  return file;
}
