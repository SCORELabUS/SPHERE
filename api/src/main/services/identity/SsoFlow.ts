export const SSO_FLOW_TTL_SECONDS = 600;
export const SSO_FLOW_CACHE_PREFIX = 'sso:flow:';
export const ACCOUNT_MERGE_CACHE_PREFIX = 'account-merge:';
export const ACCOUNT_MERGE_TTL_SECONDS = 600;

export type SsoFlow =
  | { action: 'login' }
  | { action: 'link'; userId: string; provider: string };

export type AccountMergeChallenge = {
  targetUserId: string;
  sourceUserId: string;
  provider: string;
};
