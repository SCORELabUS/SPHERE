import { useCallback, useMemo } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';

export const PRICINGS_BASE_PATH = import.meta.env.VITE_API_URL + '/pricings';

export function usePricingsApi() {
  const { fetchWithInterceptor, authUser } = useAuth();
  const token = authUser?.token;
  const username = authUser?.user?.username;

  const basicHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const getPricings = useCallback(async (filters: Record<string, string | number> = {}) => {
    let requestUrl;

    if (Object.keys(filters).length === 0) {
      requestUrl = `${PRICINGS_BASE_PATH}`;
    } else {
      const filterParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        // handle numeric pagination params
        if (key === 'limit' || key === 'offset') {
          if (value !== undefined && value !== null) filterParams.append(key, String(value));
          return;
        }
        if (Array.isArray(value)) {
          if (typeof value[0] === 'number') {
            if (value[0])
              filterParams.append('min-' + key.replace('Range', ''), value[0].toString());
            if (value[1])
              filterParams.append('max-' + key.replace('Range', ''), value[1].toString());
          } else if (typeof value[0] === 'string') {
            const selectedOwners = value as string[];

            const owners = selectedOwners.join(',');
            filterParams.append(key, owners);
          }
        } else {
          const stringValue = value as string;

          if (stringValue.trim().length > 0) filterParams.append(key, value as string);
        }
      });
      requestUrl = `${PRICINGS_BASE_PATH}?${filterParams.toString()}`;
    }

    return fetch(requestUrl as string, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, []);

  const getPricingBySlug = useCallback(async (slug: string, organizationId: string, collectionSlug: string | null) => {
    return fetch(
      `${PRICINGS_BASE_PATH}/${organizationId}/${slug}${
        collectionSlug && collectionSlug !== 'undefined' ? `?collection=${collectionSlug}` : ''
      }`,
      {
        method: 'GET',
        headers: basicHeaders,
      }
    )
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [basicHeaders]);

  const getLoggedUserPricings = useCallback(async () => {
    return fetchWithInterceptor(`${PRICINGS_BASE_PATH}/${authUser.user?.username}`, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const USERS_BASE_PATH = import.meta.env.VITE_API_URL + '/users';

  const getPermissionBasedUserPricings = useCallback(async (filters: Record<string, string | number> = {}) => {
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
    const url = `${USERS_BASE_PATH}/me/pricings${qs ? `?${qs}` : ''}`;

    return fetchWithInterceptor(url, {
      method: 'GET',
      headers: basicHeaders,
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfigurationSpace = useCallback(async (organizationId: string, pricingSlug: string, pricingVersion: string, limit?: number, offset?: number) => {
    
    const params = new URLSearchParams();

    if (limit !== undefined) params.set('limit', limit.toString());
    if (offset !== undefined) params.set('offset', offset.toString());

    const queryString = params.toString(); 
    
    return fetchWithInterceptor(
      `${PRICINGS_BASE_PATH}/${organizationId}/${pricingSlug}/${pricingVersion}${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
        headers: basicHeaders,
      }
    )
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          return Promise.reject({message: data.error});
        } else {
          return data;
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const createPricing = useCallback(async (formData: FormData, organizationId: string, setErrors: (errors: string[]) => void = () => {}) => {
    return fetchWithInterceptor(`${PRICINGS_BASE_PATH}/${organizationId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })
      .then(async response => {
        const parsedResponse = await response.json();

        if (!response.ok) {
          throw new Error(parsedResponse.error);
        }

        return parsedResponse;
      })
      .catch((error: Error) => {
        setErrors([error.message]);
      });
  }, [fetchWithInterceptor, token]);

  const createPricingVersion = useCallback(async (formData: FormData, organizationId: string, pricingSlug: string, pricingVersion: string) => {
    return fetchWithInterceptor(`${PRICINGS_BASE_PATH}/${organizationId}/${pricingSlug}/${pricingVersion}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })
      .then(async response => {
        const parsedResponse = await response.json();

        if (!response.ok) {
          throw new Error(parsedResponse.error);
        }

        return parsedResponse;
      });
  }, [fetchWithInterceptor, token]);

  const addPricingToCollection = useCallback(async (organizationId: string, pricingSlug: string, collectionSlug: string) => {
    return fetchWithInterceptor(`${import.meta.env.VITE_API_URL}/collections/${organizationId}/${collectionSlug}`, {
      method: 'POST',
      headers: basicHeaders,
      body: JSON.stringify({ pricingSlug }),
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders, authUser]);

   
  const updatePricing = useCallback((organizationId: string, pricingSlug: string, collectionSlug: string, pricingData: any) => {
    return fetchWithInterceptor(`${PRICINGS_BASE_PATH}/${organizationId}/${pricingSlug}?collection=${collectionSlug}`, {
      method: 'PUT',
      headers: basicHeaders,
      body: JSON.stringify(pricingData),
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders, username]);

  const updateClientPricingVersion = useCallback(async (pricingString: string) => {
    return fetchWithInterceptor(`${PRICINGS_BASE_PATH}`, {
      method: 'PUT',
      headers: basicHeaders,
      body: JSON.stringify({pricing: pricingString}),
    })
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const removePricingVersion = useCallback(async (organizationId: string, pricingSlug: string, pricingVersion: string) => {
    return fetchWithInterceptor(
      `${PRICINGS_BASE_PATH}/${organizationId}/${pricingSlug}/${pricingVersion}`,
      {
        method: 'DELETE',
        headers: basicHeaders,
      }
    )
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders, username]);

  const removePricingFromCollection = useCallback(async (pricingName: string, organizationId: string, collectionSlug: string) => {
    return fetchWithInterceptor(
      `${import.meta.env.VITE_API_URL}/collections/${organizationId}/${collectionSlug}/pricings/${pricingName}`,
      {
        method: 'DELETE',
        headers: basicHeaders,
      }
    )
      .then(response => {
        if (!response.ok) {
          return Promise.reject(response);
        } else {
          return response.json();
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders]);

  const removePricingBySlug = useCallback(async (organizationId: string, slug: string, collectionSlug?: string) => {
    return fetchWithInterceptor(
      `${PRICINGS_BASE_PATH}/${organizationId}/${slug}${
        collectionSlug ? `?collection=${collectionSlug}` : ''
      }`,
      {
        method: 'DELETE',
        headers: basicHeaders,
      }
    )
      .then(async response => response.json())
      .then(data => {
        if (data.error) {
          return Promise.reject(data.error);
        } else {
          return data;
        }
      })
      .catch(async error => {
        const body = await (error as Response).json().catch(() => ({}));
        return Promise.reject({message: body.error});
      });
  }, [fetchWithInterceptor, basicHeaders, username]);

  return useMemo(
    () => ({
      getPricings,
      getPricingBySlug,
      getLoggedUserPricings,
      getPermissionBasedUserPricings,
      getConfigurationSpace,
      createPricing,
      createPricingVersion,
      addPricingToCollection,
      removePricingFromCollection,
      removePricingBySlug,
      updatePricing,
      updateClientPricingVersion,
      removePricingVersion,
    }),
    [
      getPricings,
      getPricingBySlug,
      getLoggedUserPricings,
      getPermissionBasedUserPricings,
      getConfigurationSpace,
      createPricing,
      createPricingVersion,
      addPricingToCollection,
      removePricingFromCollection,
      removePricingBySlug,
      updatePricing,
      updateClientPricingVersion,
      removePricingVersion,
    ]
  );
}

const BASE_URL = import.meta.env.VITE_API_URL;

export async function getPublicOrgPricings(orgId: string, filters?: Record<string, string>): Promise<{ pricings: any[]; total: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });
  }
  const response = await fetch(`${BASE_URL}/pricings/${orgId}?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch organization pricings');
  const data = await response.json();
  return { pricings: data.pricings ?? [], total: data.total ?? 0 };
}

export async function getPublicOrgCollections(orgId: string, filters?: Record<string, string>): Promise<{ collections: any[]; total: number }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });
  }
  const qs = params.toString();
  const response = await fetch(`${BASE_URL}/collections/${orgId}${qs ? `?${qs}` : ''}`);
  if (!response.ok) throw new Error('Failed to fetch organization collections');
  const data = await response.json();
  return { collections: data.collections ?? [], total: data.total ?? 0 };
}
