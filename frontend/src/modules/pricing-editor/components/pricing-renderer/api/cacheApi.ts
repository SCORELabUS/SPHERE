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
    return fetch(`${CACHE_BASE_PATH}?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: buildHeaders(),
    })
      .then(response => response.json())
      .then(data => {
        if (data.error){
          return Promise.reject(data.error);
        }else{
          return data.data;
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  };

  const setInCache = async (key: string, value: string, expirationInSeconds?: number) => {
    return fetch(`${CACHE_BASE_PATH}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        key,
        value,
        expirationInSeconds,
      }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.error){
          return Promise.reject(data.error);
        }else{
          return data;
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  };

  return {
    getFromCache,
    setInCache,
  };
}
