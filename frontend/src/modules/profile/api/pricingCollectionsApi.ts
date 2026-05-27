import { useAuth } from '../../auth/hooks/useAuth';
import { useCallback, useMemo } from 'react';
import { CollectionToCreate } from '../types/profile-types';

export const COLLECTIONS_BASE_PATH = import.meta.env.VITE_API_URL + '/collections';

export function usePricingCollectionsApi() {
  const { fetchWithInterceptor, authUser } = useAuth();

  const token = authUser?.token;
  const username = authUser?.user?.username;

  const basicHeaders = useMemo(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }, [token]);

  const getCollections = useCallback(async (filters?: Record<string, string | number>) => {
    let requestUrl;

    if (Object.keys(filters ?? {}).length === 0) {
      requestUrl = `${COLLECTIONS_BASE_PATH}`;
    } else {
      const filterParams = new URLSearchParams();
      Object.entries(filters ?? {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        // numeric pagination params
        if (key === 'limit' || key === 'offset') {
          filterParams.append(key, String(value));
          return;
        }
        if ((value as string).trim && (value as string).trim().length > 0) filterParams.append(key, value as string);
      });
      requestUrl = `${COLLECTIONS_BASE_PATH}?${filterParams.toString()}`;
    }

    return fetchWithInterceptor(requestUrl, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => response.json())
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const getLoggedUserCollections = useCallback(async () => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${username}`, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => response.json())
      .then(data => ({
        ...data,
        collections: data.collections ?? [],
      }))
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders, username]);

  const USERS_BASE_PATH = import.meta.env.VITE_API_URL + '/users';

  const getPermissionBasedUserCollections = useCallback(async (filters: Record<string, string | number> = {}) => {
    const filterParams = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'limit' || key === 'offset') {
        filterParams.append(key, String(value));
        return;
      }
      const stringValue = String(value);
      if (stringValue.trim().length > 0) filterParams.append(key, stringValue);
    });
    const qs = filterParams.toString();
    const url = `${USERS_BASE_PATH}/me/collections${qs ? `?${qs}` : ''}`;

    return fetchWithInterceptor(url, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => response.json())
      .then(data => ({
        ...data,
        collections: data.collections ?? [],
      }))
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  const createCollection = useCallback(async (collection: CollectionToCreate, organizationId: string) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${organizationId}`, {
      method: 'POST',
      headers: basicHeaders,
      body: JSON.stringify(collection),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          // Normalize error with status for caller
          const message = data?.error || data?.message || response.statusText || 'Error creating collection';
          type ErrorWithStatus = Error & { status?: number };
          const e = new Error(message) as ErrorWithStatus;
          e.status = response.status;
          return Promise.reject(e);
        }
        return data;
      })
      .catch(error => {
  return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      });
  }, [fetchWithInterceptor, basicHeaders]);
  
  const createBulkCollection = useCallback(async (formData: FormData, organizationId: string) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${organizationId}/bulk`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data?.error || data?.message || response.statusText || 'Error creating collection';
          type ErrorWithStatus = Error & { status?: number };
          const e = new Error(message) as ErrorWithStatus;
          e.status = response.status;
          return Promise.reject(e);
        }
        if (data.error){
          type ErrorWithStatus = Error & { status?: number };
          const e = new Error(data.error) as ErrorWithStatus;
          e.status = 500;
          return Promise.reject(e);
        }
        return data;
      })
      .catch(error => {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      });
  }, [fetchWithInterceptor, token, username]);

  const getCollectionByOwnerAndName = useCallback(async (ownerId: string, collectionSlug: string) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${ownerId}/${collectionSlug}`, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          return Promise.reject(new Error(data.error));
        }
        return data;
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const downloadCollection = useCallback(async (owner: string, collectionSlug: string) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${owner}/${collectionSlug}/download`, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(async response => {
        if (!response.ok) {
          return Promise.reject(new Error('Error downloading collection'));
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = collectionSlug + '.zip';
        a.click();

        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]);

   
  const getCollectionPermissions = useCallback(async (organizationId: string, collectionSlug: string) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${organizationId}/${collectionSlug}/permissions`, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(async response => {
        if (!response.ok) {
          return { GET: false, PUT: false, DELETE: false };
        }
        return response.json();
      })
      .catch(() => ({ GET: false, PUT: false, DELETE: false }));
  }, [fetchWithInterceptor, basicHeaders]);
   
  const updateCollection = useCallback(async (organizationId: string, collectionSlug: string, collectionData: any) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${organizationId}/${collectionSlug}`, {
      method: 'PUT',
      headers: basicHeaders,
      body: JSON.stringify(collectionData),
    })
      .then(async response => response.json())
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const deleteCollection = useCallback(async (organizationId: string, collectionSlug: string, deleteCascade: boolean) => {
    return fetchWithInterceptor(`${COLLECTIONS_BASE_PATH}/${organizationId}/${collectionSlug}?cascade=${deleteCascade}`, {
      method: 'DELETE',
      headers: basicHeaders
    })
      .then(async response => response.json())
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject(body as Error);
      });
  }, [fetchWithInterceptor, basicHeaders]);

  return useMemo(() => ({
    getLoggedUserCollections,
    getPermissionBasedUserCollections,
    createCollection,
    createBulkCollection,
    getCollectionByOwnerAndName,
    getCollections,
    downloadCollection,
    getCollectionPermissions,
    updateCollection,
    deleteCollection
  }), [
    getLoggedUserCollections,
    getPermissionBasedUserCollections,
    createCollection,
    createBulkCollection,
    getCollectionByOwnerAndName,
    getCollections,
    downloadCollection,
    getCollectionPermissions,
    updateCollection,
    deleteCollection,
  ]);
}
