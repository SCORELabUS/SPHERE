import { useCallback, useMemo } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';

export interface Notification {
  id: string;
  kind: 'OrganizationInvitation' | 'System' | 'CollectionShared' | 'PricingUpdated';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

const BASE_URL = import.meta.env.VITE_API_URL;

export function useNotificationsApi() {
  const { fetchWithInterceptor, authUser } = useAuth();
  const token = authUser?.token;

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  );

  const getNotifications = useCallback(
    async (options?: { unreadOnly?: boolean; offset?: number; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.unreadOnly) params.set('unreadOnly', 'true');
      if (options?.offset !== undefined) params.set('offset', String(options.offset));
      if (options?.limit !== undefined) params.set('limit', String(options.limit));

      const queryString = params.toString();
      const url = `${BASE_URL}/notifications${queryString ? `?${queryString}` : ''}`;

      const response = await fetchWithInterceptor(url, { method: 'GET', headers });
      if (!response.ok) throw new Error('Failed to fetch notifications');
      return response.json() as Promise<Notification[]>;
    },
    [fetchWithInterceptor, token]
  );

  const getUnreadCount = useCallback(async () => {
    const response = await fetchWithInterceptor(`${BASE_URL}/notifications/unread-count`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Failed to fetch unread count');
    const data = await response.json();
    return data.count as number;
  }, [fetchWithInterceptor, token]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      const response = await fetchWithInterceptor(`${BASE_URL}/notifications/${notificationId}`, {
        method: 'PUT',
        headers,
      });
      if (!response.ok) throw new Error('Failed to mark notification as read');
      return response.json();
    },
    [fetchWithInterceptor, token]
  );

  const markAllAsRead = useCallback(async () => {
    const response = await fetchWithInterceptor(`${BASE_URL}/notifications/mark-all-read`, {
      method: 'PUT',
      headers,
    });
    if (!response.ok) throw new Error('Failed to mark all notifications as read');
    return response.json();
  }, [fetchWithInterceptor, token]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      const response = await fetchWithInterceptor(`${BASE_URL}/notifications/${notificationId}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error('Failed to delete notification');
      return response.json();
    },
    [fetchWithInterceptor, token]
  );

  return {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}
