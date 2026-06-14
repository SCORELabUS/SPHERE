import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOrganizationsApi, Organization, OrganizationInvitation } from '../../api/organizationsApi';
import Iconify from '../../../core/components/iconify';
import { useRouter } from '../../../core/hooks/useRouter';
import { useAuth } from '../../../auth/hooks/useAuth';
import OrgJoinSkeleton from '../../../core/components/skeletons/org-join-skeleton';
import OrgAvatar from '../../../core/components/org-avatar';

export default function OrganizationJoinPage() {
  const { code } = useParams<{ code: string }>();
  const { authUser } = useAuth();
  const router = useRouter();
  const { previewInvitation, joinViaInvitation } = useOrganizationsApi();
  const [org, setOrg] = useState<Organization | null>(null);
  const [invitation, setInvitation] = useState<OrganizationInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (authUser.isLoading) return;
    if (!authUser.isAuthenticated) {
      router.push('/authentication');
      return;
    }
    if (!code) {
      setError('Invalid invitation link.');
      setIsLoading(false);
      return;
    }

    previewInvitation(code)
      .then((data) => {
        setInvitation(data.invitation);
        setOrg(data.organization);
      })
      .catch((err: any) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [authUser.isLoading, authUser.isAuthenticated, code]);

  const handleJoin = () => {
    if (!code) return;
    setIsJoining(true);
    joinViaInvitation(code)
      .then(() => setJoined(true))
      .catch((err: any) => {
        setError(err.message);
        setIsJoining(false);
      });
  };

  if (isLoading) {
    return <OrgJoinSkeleton />;
  }

  if (joined && org) {
    return (
      <div className="mx-auto max-w-112 px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
            <Iconify icon="mdi:check-circle-outline" width={36} />
          </span>
          <h1 className="text-2xl font-bold text-sphere-grey-800">You joined!</h1>
          <p className="text-sm text-sphere-grey-600">
            You are now a member of <strong>{org.displayName}</strong>.
          </p>
          <button
            type="button"
            onClick={() => router.push('/me/orgs')}
            className="mt-2 cursor-pointer rounded-md bg-tp-primary px-6 py-2 text-sm font-semibold text-white hover:bg-tp-primary"
          >
            Go to My Organizations
          </button>
        </div>
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="mx-auto max-w-112 px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-500">
            <Iconify icon="mdi:link-off" width={36} />
          </span>
          <h1 className="text-2xl font-bold text-sphere-grey-800">Invalid invitation</h1>
          <p className="text-sm text-sphere-grey-600">
            {error ?? 'This invitation link is invalid, expired, or has already been used to its limit.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/me/orgs')}
            className="mt-2 cursor-pointer rounded-md border border-sphere-grey-300 px-5 py-2 text-sm font-semibold text-sphere-grey-700 hover:bg-sphere-grey-100"
          >
            Back to Organizations
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-112 px-4 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <OrgAvatar name={org.displayName} avatar={org.avatar} size={100}/>
        <div>
          <h1 className="text-2xl font-bold text-sphere-grey-800">{org.displayName}</h1>
          <p className="text-sm text-sphere-grey-500">@{org.name}</p>
        </div>
        {org.description && <p className="text-sm text-sphere-grey-600">{org.description}</p>}

        <div className="mt-2 w-full rounded-lg border border-sphere-grey-200 bg-sphere-grey-50 px-5 py-4 text-left text-sm">
          <p className="mb-1 font-semibold text-sphere-grey-700">You have been invited to join this organization.</p>
          <p className="text-sphere-grey-500">
            You will join as a <strong>member</strong>. Admins can change your role later.
          </p>
          {invitation?.expiresAt && (
            <p className="mt-1 text-xs text-sphere-grey-400">
              Invitation expires on {new Date(invitation.expiresAt).toLocaleDateString()}.
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={handleJoin}
            disabled={isJoining}
            className="w-full cursor-pointer rounded-md bg-tp-primary py-2.5 text-sm font-semibold text-white hover:bg-tp-primary disabled:opacity-50"
          >
            {isJoining ? 'Joining...' : `Join ${org.displayName}`}
          </button>
          <button
            type="button"
            onClick={() => router.push('/me/orgs')}
            className="w-full cursor-pointer rounded-md border border-sphere-grey-300 py-2.5 text-sm font-semibold text-sphere-grey-700 hover:bg-sphere-grey-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
