const API_URL = import.meta.env.VITE_API_URL;

export interface ApiKeyScope {
  organizationId: string;
  scope: 'ALL' | 'MANAGEMENT' | 'VIEW';
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPreview: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  revoked: boolean;
}

export interface CreateApiKeyData {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKeySummary;
  plainKey: string;
}

export async function getApiKeys(
  username: string,
  token: string
): Promise<ApiKeySummary[]> {
  const response = await fetch(`${API_URL}/users/${username}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch API keys');
  }
  return response.json();
}

export async function createApiKey(
  username: string,
  data: CreateApiKeyData,
  token: string
): Promise<CreateApiKeyResponse> {
  const response = await fetch(`${API_URL}/users/${username}/api-keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create API key');
  }
  return response.json();
}

export async function revokeApiKey(
  username: string,
  keyId: string,
  token: string
): Promise<void> {
  const response = await fetch(
    `${API_URL}/users/${username}/api-keys/${keyId}/revoke`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to revoke API key');
  }
}

export async function deleteApiKey(
  username: string,
  keyId: string,
  token: string
): Promise<void> {
  const response = await fetch(
    `${API_URL}/users/${username}/api-keys/${keyId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete API key');
  }
}
