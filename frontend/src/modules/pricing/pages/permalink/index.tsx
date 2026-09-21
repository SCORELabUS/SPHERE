import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../auth/hooks/useAuth';

export default function PermanentLinkPage({ kind }: { kind: 'pricing' | 'collection' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => {
    if (authUser.isLoading) return;
    const controller = new AbortController();
    setError('');
    fetch(`${import.meta.env.VITE_API_URL}/permalinks/${kind}/${id}`, {
      signal: controller.signal,
      headers: authUser.token ? { Authorization: `Bearer ${authUser.token}` } : {},
      cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('This resource is unavailable. Sign in if you have access to a private resource.');
      const { location } = await response.json();
      if (typeof location !== 'string' || !/^\/(pricings|collections)\//.test(location)) throw new Error('Invalid destination');
      if (!controller.signal.aborted) navigate(location, { replace: true });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [authUser.isLoading, authUser.token, id, kind, navigate]);
  return <p role="status" className="p-8 text-tp-ink">{error || 'Opening permanent link…'}</p>;
}
