export const identityMode = () => process.env.AUTH_PROVIDER === 'scoretech';
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\r\n]/.test(value)
    ? value
    : '/';
}
function publicUrl(value: string, name: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw Error(`Invalid ${name}: HTTPS or local loopback required`);
  return url.href.replace(/\/$/, '');
}
export function scoretechConfig() {
  const issuer = publicUrl(
    process.env.SCORETECH_IDENTITY_ISSUER || '',
    'SCORETECH_IDENTITY_ISSUER'
  );
  const frontend = publicUrl(process.env.FRONTEND_URL || 'http://localhost:5173', 'FRONTEND_URL');
  const clientId = process.env.SCORETECH_IDENTITY_CLIENT_ID || '';
  const clientSecret = process.env.SCORETECH_IDENTITY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret)
    throw Error('SCORETECH_IDENTITY_CLIENT_ID and SCORETECH_IDENTITY_CLIENT_SECRET are required');
  const base = (process.env.BASE_URL_PATH || '') + '/api/v1/auth/identity';
  const callback = publicUrl(
    process.env.SCORETECH_IDENTITY_CALLBACK_URL || frontend + base + '/callback',
    'SCORETECH_IDENTITY_CALLBACK_URL'
  );
  if (
    new URL(callback).origin !== new URL(frontend).origin ||
    new URL(callback).pathname !== base + '/callback'
  )
    throw Error(
      'SCORETECH_IDENTITY_CALLBACK_URL must use the public SPHERE origin and authentication callback path'
    );
  const accountUrl =
    process.env.SCORETECH_IDENTITY_ACCOUNT_URL ||
    issuer.replace(/\/auth\/realms\/[^/]+$/, '/account/');
  const account = new URL(accountUrl);
  if (account.username || account.password || account.search) throw Error('Invalid SCORETECH_IDENTITY_ACCOUNT_URL');
  publicUrl(account.origin + account.pathname, 'SCORETECH_IDENTITY_ACCOUNT_URL');
  account.hash = 'public-profile';
  const transport = process.env.SCORETECH_IDENTITY_TRANSPORT_URL?.replace(/\/$/, '');
  if (transport && !['http:', 'https:'].includes(new URL(transport).protocol))
    throw Error('Invalid SCORETECH_IDENTITY_TRANSPORT_URL');
  return {
    issuer,
    frontend,
    clientId,
    clientSecret,
    callback,
    accountUrl: account.href,
    base,
    transport,
    secure: new URL(frontend).protocol === 'https:',
  };
}
export function validateAuthenticationConfig() {
  if (!['local', 'scoretech'].includes(process.env.AUTH_PROVIDER || 'local'))
    throw Error('AUTH_PROVIDER must be local or scoretech');
  if (identityMode()) scoretechConfig();
}
export function authenticationConfig() {
  let configured: ReturnType<typeof scoretechConfig> | undefined;
  if (identityMode() || process.env.SCORETECH_IDENTITY_CLIENT_ID) configured = scoretechConfig();
  const base = (process.env.BASE_URL_PATH || '') + '/api/v1/auth/identity';
  return {
    provider: identityMode() ? 'scoretech' : 'local',
    identityAvailable: Boolean(configured),
    loginUrl: base + '/login',
    registerUrl: base + '/login?screen=register',
    accountUrl: configured?.accountUrl,
  };
}
