import { useCallback, useState } from 'react';

import { useOrganizationsApi } from '../api/organizationsApi';

export interface OrgMoveRequest {
  organizationId: string;
  organizationName: string;
  /** Null moves the organization out to the root of the tree. */
  parentId: string | null;
  parentName: string | null;
}

export interface OrgReparenting {
  isMoving: boolean;
  error: string | null;
  message: string | null;
  dismissFeedback: () => void;
  move: (request: OrgMoveRequest) => Promise<void>;
}

/**
 * Sends a re-parenting request and holds the feedback the tree shows.
 *
 * Ownership of both ends of the move is settled by the API, which is the only
 * side that knows the caller's role in the destination, so a refused move is
 * reported rather than guessed at up front.
 */
export function useOrgReparenting(onMoved: () => void | Promise<void>): OrgReparenting {
  const { moveOrganization } = useOrganizationsApi();
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dismissFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

  const move = useCallback(
    async (request: OrgMoveRequest) => {
      setIsMoving(true);
      setError(null);
      setMessage(null);

      try {
        await moveOrganization(request.organizationId, request.parentId);
        setMessage(
          request.parentName
            ? `${request.organizationName} is now part of ${request.parentName}.`
            : `${request.organizationName} is now a root organization.`
        );
        await onMoved();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsMoving(false);
      }
    },
    [moveOrganization, onMoved]
  );

  return { isMoving, error, message, dismissFeedback, move };
}
