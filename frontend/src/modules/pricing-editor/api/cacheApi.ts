export const CACHE_BASE_PATH = import.meta.env.VITE_API_URL + '/cache';

export function useCacheApi() {

  const basicHeaders = {
    'Content-Type': 'application/json',
  };

  const getFromCache = async (key: string) => {
    return fetch(
      `${CACHE_BASE_PATH}/get?key=${key}`,
      {
        method: 'GET',
        headers: basicHeaders,
      }
    )
      .then(response => response.json())
      .then(data => {
        if (data.error){
          return Promise.reject(data.error);
        }else{
          return data;
        }
      })
      .catch(error => {
        return Promise.reject(error as Error);
      });
  };

  const setInCache = async (key: string, value: string, expirationInSeconds?: number) => {
    return fetch(
      `${CACHE_BASE_PATH}/set`,
      {
        method: 'POST',
        headers: basicHeaders,
        body: JSON.stringify({
          key,
          value,
          expirationInSeconds
        }),
      }
    )
      .then(response => response.json())
      .then(data => {
        if (data.error){
          return Promise.reject(data.error);
        }else{
          return data;
        }
      })
      .catch(error => {
        return Promise.reject(error as Error);
      });
  };

  return {
    getFromCache,
    setInCache,
  };
}
