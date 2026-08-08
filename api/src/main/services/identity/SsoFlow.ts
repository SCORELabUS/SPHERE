export const SSO_FLOW_TTL_SECONDS = 600;
export const SSO_FLOW_CACHE_PREFIX = 'sso:flow:';

export type SsoFlow =
  | { action: 'login' }
  | { action: 'link'; userId: string; provider: string };
