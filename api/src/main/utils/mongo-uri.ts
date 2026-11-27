/**
 * Returns a MongoDB connection URI fit for logs: the password, if any, is
 * replaced with `***`. The username, hosts, database and options are kept.
 *
 * The credentials end at the last `@` before the query string, so a password
 * holding `@`, `:` or `/` is masked whole.
 */
const redactMongoUri = (uri: string): string => {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) return uri;
  const authorityStart = schemeEnd + 3;
  const queryStart = uri.indexOf('?', authorityStart);
  const searchEnd = queryStart === -1 ? uri.length : queryStart;
  const at = uri.lastIndexOf('@', searchEnd - 1);
  if (at < authorityStart) return uri;
  const userInfo = uri.slice(authorityStart, at);
  const colon = userInfo.indexOf(':');
  if (colon === -1) return uri;
  return `${uri.slice(0, authorityStart)}${userInfo.slice(0, colon)}:***${uri.slice(at)}`;
};

export { redactMongoUri };
