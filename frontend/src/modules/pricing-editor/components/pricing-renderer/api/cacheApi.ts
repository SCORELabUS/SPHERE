import { useAuth } from '../../../../auth/hooks/useAuth';

export const CACHE_BASE_PATH = import.meta.env.VITE_API_URL + '/cache';

export function useCacheApi() {
  const { authUser } = useAuth();

  const requestOrigin = globalThis.location?.origin ?? 'https://sphere.score.us.es';

  const buildHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requestOrigin) {
      headers.Origin = requestOrigin;
      headers['x-origin'] = requestOrigin;
    }

    if (authUser?.token) {
      headers.Authorization = `Bearer ${authUser.token}`;
    }

    return headers;
  };

  const getFromCache = async (key: string) => {
    const response = await fetch(`${CACHE_BASE_PATH}?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data;
  };

  const setInCache = async (key: string, value: string, expirationInSeconds?: number) => {
    const response = await fetch(`${CACHE_BASE_PATH}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        key,
        value,
        expirationInSeconds,
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data;
  };

  return {
    getFromCache,
    setInCache,
  };
}
