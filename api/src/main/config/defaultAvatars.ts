/**
 * The predefined avatars a user or an organization may choose instead of
 * uploading an image.
 *
 * They are plain SVGs drawn with `currentColor`, so the same file serves every
 * colour the picker offers: the client swaps the colour in and renders it over
 * the chosen background.
 *
 * This list is also the allow-list for the "choose a predefined avatar"
 * endpoints. Those take a path rather than a file upload, and without a list to
 * check it against a caller could point an organization's image at any URL they
 * liked and have every member's browser fetch it.
 */
export const DEFAULT_AVATAR_FOLDER = 'static/avatars/users/default';

export const DEFAULT_AVATAR_FILES = [
  'avatar-1.svg',
  'avatar-2.svg',
  'avatar-3.svg',
  'avatar-4.svg',
  'avatar-6.svg',
  'avatar-7.svg',
  'avatar-8.svg',
  'avatar-9.svg',
  'avatar-10.svg',
] as const;

export const DEFAULT_AVATAR_PATHS: readonly string[] = DEFAULT_AVATAR_FILES.map(
  file => `${DEFAULT_AVATAR_FOLDER}/${file}`
);

/** True for the empty value (meaning "use initials") or a known predefined avatar. */
export function isSelectableAvatarPath(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true;
  return typeof value === 'string' && DEFAULT_AVATAR_PATHS.includes(value);
}

/** A colour the pickers can produce: `#rgb` or `#rrggbb`. */
export function isHexColor(value: unknown): boolean {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
