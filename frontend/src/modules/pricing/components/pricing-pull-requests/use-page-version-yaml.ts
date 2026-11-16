import { useCallback } from 'react';
import { useAuth } from '../../../auth/hooks/useAuth';
import { readVersionYaml } from '../../utils/version-yaml';
import type { VersionData } from '../../types/card';
import type { PullRequestVersionRef } from '../../types/pull-requests';

/** Reads the YAML of one of the versions the pricing page loaded, as the latest public one a proposal starts from. */
export function usePageVersionYaml(versions: VersionData[]) {
  const { authUser } = useAuth();
  return useCallback(
    async (target: PullRequestVersionRef) => {
      const version = versions.find(item => item.id === target.id);
      if (!version) throw new Error('it is not loaded on this page. Reload the page and try again.');
      return readVersionYaml(version.yaml, authUser.token);
    },
    [versions, authUser.token]
  );
}
