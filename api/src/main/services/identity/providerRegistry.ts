import { GoogleProvider } from './GoogleProvider';
import { IdentityProvider } from './IdentityProvider';
import { UsCasProvider } from './UsCasProvider';

/**
 * Maps the `:provider` URL segment to its identity provider implementation.
 * Adding a new social login = one implementation + one entry here.
 */
const providers: Record<string, IdentityProvider> = {
  us: new UsCasProvider(),
  google: new GoogleProvider(),
};

export function getProvider(name: string): IdentityProvider | null {
  return providers[name] ?? null;
}
