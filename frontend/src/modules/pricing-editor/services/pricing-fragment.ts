import LZString from 'lz-string';

/**
 * Pricing passed to the editor in the URL fragment:
 *
 *   /editor#pricing=<LZString.compressToEncodedURIComponent(yaml)>
 *
 * Browsers never send the fragment to a server (not in the request, not in the
 * Referer header), so a pricing opened this way reaches neither SPHERE's nor
 * any proxy's logs. Unlike `?pricing=`, the value is always the encoded YAML
 * itself, never a short-link key: a key would have to be resolved by the API.
 *
 * Other `key=value` pairs may share the fragment (`#pricing=...&foo=bar`); only
 * `pricing` is read.
 */
export const PRICING_FRAGMENT_KEY = 'pricing';

export type PricingFragment =
  /** The fragment has no `pricing` key: the editor loads from its query parameters. */
  | { status: 'absent' }
  | { status: 'ok'; yaml: string }
  /** `pricing` is present but cannot be decoded; `error` is meant for the user. */
  | { status: 'invalid'; error: string };

/** The characters `compressToEncodedURIComponent` writes (a space is a `+` that went through form decoding). */
const ENCODED_URI_COMPONENT_ALPHABET = /^[A-Za-z0-9+\-$ ]+$/;

const INVALID_PREFIX = 'The pricing in this link could not be read';

/**
 * Reads the pricing from a URL fragment (`location.hash`, with or without the
 * leading `#`). Pure: it neither touches the location nor stores anything.
 *
 * Decoding cannot always tell a truncated value from a complete one: a cut link
 * usually decodes to nothing (reported here), but one cut in its last characters
 * may still decode, whole or in part; the editor's own parsing then reports what
 * is missing.
 */
export function readPricingFragment(hash: string): PricingFragment {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  if (!params.has(PRICING_FRAGMENT_KEY)) {
    return { status: 'absent' };
  }

  const encoded = params.get(PRICING_FRAGMENT_KEY) ?? '';

  if (encoded.trim() === '') {
    return { status: 'invalid', error: `${INVALID_PREFIX}: it carries no pricing.` };
  }

  if (!ENCODED_URI_COMPONENT_ALPHABET.test(encoded)) {
    return {
      status: 'invalid',
      error: `${INVALID_PREFIX}: it is not lz-string compressToEncodedURIComponent output.`,
    };
  }

  let yaml: string | null;
  try {
    yaml = LZString.decompressFromEncodedURIComponent(encoded);
  } catch {
    yaml = null;
  }

  // lz-string answers a damaged or cut value with `null`, an exception or an
  // empty string, depending on where the damage is.
  if (!yaml) {
    return {
      status: 'invalid',
      error: `${INVALID_PREFIX}: it is damaged or incomplete. Open it again from where it came from.`,
    };
  }

  if (yaml.trim() === '') {
    return { status: 'invalid', error: `${INVALID_PREFIX}: it carries no pricing.` };
  }

  return { status: 'ok', yaml };
}

/**
 * The current URL without its fragment, for `history.replaceState`. The query
 * string is kept so that the editor's other parameters stay as they were.
 */
export function urlWithoutFragment(location: Pick<Location, 'pathname' | 'search'>): string {
  return location.pathname + location.search;
}

/**
 * Reads the pricing fragment of the current page and, when there is one (valid
 * or not), removes it from the address bar and from the current session-history
 * entry straight away, so a later copy of the URL, a bookmark or a reload no
 * longer carries the pricing.
 *
 * `history.state` is kept as it is: React Router stores its own `key`/`idx` in
 * it, and replacing it with `null` would make it lose track of this entry.
 *
 * What this cannot undo: the browser's global history (the list of visited
 * pages, address-bar suggestions and anything synced from them) recorded the
 * URL with its fragment when the page was opened, and extensions allowed to
 * read tab URLs could have seen it.
 */
export function takePricingFragment(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>
): PricingFragment {
  const fragment = readPricingFragment(location.hash);

  if (fragment.status !== 'absent') {
    history.replaceState(history.state, '', urlWithoutFragment(location));
  }

  return fragment;
}
