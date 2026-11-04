import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/hooks/useAuth';

export default function PermanentLinkPage({ kind }: { kind: 'pricing' | 'collection' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [searchParams] = useSearchParams();
  // `/p/{pricingId}?version=…` opens that version; the API decides whether the
  // caller may see it and only then keeps it in the location it answers with.
  const version = kind === 'pricing' ? searchParams.get('version') : null;
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
      if (!controller.signal.aborted) navigate(location + hash, { replace: true });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [authUser.isLoading, authUser.token, id, kind, version, hash, navigate]);
  return <p role="status" className="p-8 text-tp-ink">{error || 'Opening permanent link…'}</p>;
}
