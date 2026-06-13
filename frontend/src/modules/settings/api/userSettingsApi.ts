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

  return {
    getSettings,
    updateAccount,
    updateProfile,
    updateSocialLinks,
    updateNotificationPrefs,
    uploadAvatar,
    removeAvatar,
    updateAvatarColors,
  };
}
