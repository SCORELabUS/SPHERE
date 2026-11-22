import { useCallback } from 'react';
import { useAuth } from '../../../auth/hooks/useAuth';
import { readVersionYaml } from '../../utils/version-yaml';
import type { VersionData } from '../../types/card';
import type { PullRequestVersionRef } from '../../types/pull-requests';

/** A version the page has not loaded: one published since it loaded its versions, which it loads again after a merge. */
export class VersionNotOnPage extends Error {
  constructor() {
    super('it is not loaded on this page. Reload the page and try again.');
    this.name = 'VersionNotOnPage';
  }
}

/** Reads the YAML of one of the versions the pricing page loaded, as the latest public one a proposal starts from. */
export function usePageVersionYaml(versions: VersionData[]) {
  const { authUser } = useAuth();
  return useCallback(
    async (target: PullRequestVersionRef) => {
      const version = versions.find(item => item.id === target.id);
      if (!version) throw new VersionNotOnPage();
      return readVersionYaml(version.yaml, authUser.token);
    },
    [versions, authUser.token]
  );
}
