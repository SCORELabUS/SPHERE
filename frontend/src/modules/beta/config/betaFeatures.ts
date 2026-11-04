export interface BetaFeature {
  /** Part of SPHERE where the feature shows up, e.g. 'ORBIT' or 'Pricing editor'. */
  area: string;
  name: string;
  description: string;
}

/**
 * Features that only users who turned on Settings → Beta features can see.
 *
 * To add one, register it here and wrap its UI in `<BetaGate feature="...">` (or
 * check `useBetaFeature('...')`); guard its API routes with `requireBetaFeatures`.
 * When it graduates, delete its entry: the compiler then points at every gate left.
 *
 * Example:
 *   'orbit-voice-input': {
 *     area: 'ORBIT',
 *     name: 'Voice input',
 *     description: 'Dictate your messages to ORBIT.',
 *   },
 */
export const BETA_FEATURES = {} satisfies Record<string, BetaFeature>;

export type BetaFeatureKey = keyof typeof BETA_FEATURES;
