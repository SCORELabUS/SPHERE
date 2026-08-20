import { useAuth } from '../../auth/hooks/useAuth';

const BASE_PATH = import.meta.env.VITE_API_URL;

export interface UserSettings {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  settings?: {
    phone?: string;
    avatar?: string;
    avatarBgColor?: string;
    avatarFgColor?: string;
    profile?: {
      displayName?: string;
      bio?: string;
      city?: string;
      country?: string;
      dateOfBirth?: string;
    };
    socialLinks?: {
      linkedin?: string;
      instagram?: string;
      facebook?: string;
      x?: string;
    };
    notificationPrefs?: Record<string, { email: boolean; inbox: boolean }>;
  };
}

export type IdentityProvider = 'google' | 'us-sso';

export interface ConnectedIdentity {
  provider: IdentityProvider;
  email?: string;
  emailVerified: boolean;
  linkedAt?: string;
}

export interface AuthenticationMethods {
  hasPassword: boolean;
  identities: ConnectedIdentity[];
}

export function useUserSettingsApi() {
  const { fetchWithInterceptor } = useAuth();

  async function getSettings(): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings`);
    if (!res.ok) throw new Error('Failed to load settings');
    return res.json();
  }

  async function updateAccount(data: { email: string; firstName: string; lastName: string; phone?: string }): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update account');
    }
    return res.json();
  }

  async function updateProfile(data: {
    displayName?: string;
    bio?: string;
    city?: string;
    country?: string;
    dateOfBirth?: string;
  }): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update profile');
    }
    return res.json();
  }

  async function updateSocialLinks(data: {
    linkedin?: string;
    instagram?: string;
    facebook?: string;
    x?: string;
  }): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/social-links`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update social links');
    }
    return res.json();
  }

  async function updateNotificationPrefs(
    prefs: Record<string, { email: boolean; inbox: boolean }>
  ): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update notification preferences');
    }
    return res.json();
  }

  async function uploadAvatar(file: File): Promise<UserSettings> {
    const formData = new FormData();
    formData.append('avatar', file);
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/avatar`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to upload avatar');
    }
    return res.json();
  }

  async function removeAvatar(): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/avatar`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to remove avatar');
    }
    return res.json();
  }

  async function updateAvatarColors(data: {
    avatarPath: string;
    avatarBgColor: string;
    avatarFgColor: string;
  }): Promise<UserSettings> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/settings/avatar-colors`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update avatar colors');
    }
    return res.json();
  }

  async function getAuthenticationMethods(): Promise<AuthenticationMethods> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/identities`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to load sign-in methods');
    }
    return res.json();
  }

  async function initiateIdentityLink(provider: 'google' | 'us'): Promise<string> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/identities/${provider}/initiate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to start identity connection');
    }
    const body = await res.json();
    return body.url;
  }

  async function unlinkIdentity(provider: 'google' | 'us'): Promise<AuthenticationMethods> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/identities/${provider}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to disconnect identity');
    }
    return res.json();
  }

  async function setInitialPassword(password: string): Promise<AuthenticationMethods> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/me/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to create password');
    }
    return res.json();
  }

  async function deleteAccount(username: string): Promise<{ message: string }> {
    const res = await fetchWithInterceptor(`${BASE_PATH}/users/${username}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to delete account');
    }
    return res.json();
  }

  return {
    getSettings,
    updateAccount,
    updateProfile,
    updateSocialLinks,
    updateNotificationPrefs,
    uploadAvatar,
    removeAvatar,
    updateAvatarColors,
    getAuthenticationMethods,
    initiateIdentityLink,
    unlinkIdentity,
    setInitialPassword,
    deleteAccount,
  };
}
