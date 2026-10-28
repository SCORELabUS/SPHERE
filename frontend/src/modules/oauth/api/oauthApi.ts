import type { ApiKeyScope } from '../../api-keys/api/apiKeysApi';

export interface ConnectedApplication {
  _id: string;
  clientName: string;
  scopes: (ApiKeyScope & { organizationName?: string })[];
  lastUsedAt?: string;
  createdAt: string;
}

export async function oauthApi<T>(path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/oauth${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Unable to process this connection');
  }
  return response.status === 204 ? undefined as T : response.json();
}
