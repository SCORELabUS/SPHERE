import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/hooks/useAuth';
import { isPullRequestId } from '../../../core/utils/pull-request-state';

export default function PermanentLinkPage({ kind }: { kind: 'pricing' | 'collection' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [searchParams] = useSearchParams();
  // `/p/{pricingId}?version=…` opens that version; the API decides whether the
  // caller may see it and only then keeps it in the location it answers with.
  const version = kind === 'pricing' ? searchParams.get('version') : null;
  // `?tab=pull-requests&pr=<id>` (the links of pull request notifications) goes on
  // to the pricing page; any other tab, or a pr that is not an id, is dropped.
  const pullRequestTab = kind === 'pricing' && searchParams.get('tab') === 'pull-requests';
  const prParam = searchParams.get('pr');
  const pullRequest = pullRequestTab && isPullRequestId(prParam) ? prParam : null;
  const { authUser } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => {
    if (authUser.isLoading) return;
    const controller = new AbortController();
    setError('');
    const query = version ? `?version=${encodeURIComponent(version)}` : '';
    fetch(`${import.meta.env.VITE_API_URL}/permalinks/${kind}/${id}${query}`, {
      signal: controller.signal,
      headers: authUser.token ? { Authorization: `Bearer ${authUser.token}` } : {},
      cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('This resource is unavailable. Sign in if you have access to a private resource.');
      const { location } = await response.json();
      if (typeof location !== 'string' || !/^\/(pricings|collections)\//.test(location)) throw new Error('Invalid destination');
      const forwarded = new URLSearchParams();
      if (pullRequestTab) forwarded.set('tab', 'pull-requests');
      if (pullRequest) forwarded.set('pr', pullRequest);
      const extra = forwarded.toString();
      const target = extra ? `${location}${location.includes('?') ? '&' : '?'}${extra}` : location;
      if (!controller.signal.aborted) navigate(target + hash, { replace: true });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [authUser.isLoading, authUser.token, id, kind, version, pullRequestTab, pullRequest, hash, navigate]);
  return <p role="status" className="p-8 text-tp-ink">{error || 'Opening permanent link…'}</p>;
}
