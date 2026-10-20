import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotificationsApi, Notification } from '../api/notificationsApi';
import { useAuth } from '../../auth/hooks/useAuth';

export interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  fetchNotifications: (options?: { unreadOnly?: boolean; offset?: number; limit?: number }) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  addNotification: (notification: Notification) => void;
  /** An unread notification arrived after the bell was last opened. */
  hasUnseen: boolean;
  markSeen: () => void;
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// When the bell was last opened, per user and per browser. Storage may be unavailable
// (private window, blocked site data): the dot then simply shows for any unread notification.
const lastSeenKey = (username: string) => `sphere:notifications:last-seen:${username}`;
const readLastSeen = (username: string) => {
  try {
    return Number(localStorage.getItem(lastSeenKey(username))) || 0;
  } catch {
    return 0;
  }
};
const writeLastSeen = (username: string, time: number) => {
  try {
    localStorage.setItem(lastSeenKey(username), String(time));
  } catch {
    // Not persisted: the dot is cleared for this session only.
  }
};

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const api = useNotificationsApi();
  const { authUser } = useAuth();

  // Ref to always have latest API methods without causing re-renders
  const apiRef = useRef(api);
  apiRef.current = api;

  const fetchNotifications = useCallback(
    async (options?: { unreadOnly?: boolean; offset?: number; limit?: number }) => {
      if (!authUser?.isAuthenticated) return;
      setIsLoading(true);
      try {
        const data = await apiRef.current.getNotifications(options);
        setNotifications(data);
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [authUser?.isAuthenticated]
  );

  const fetchUnreadCount = useCallback(async () => {
    if (!authUser?.isAuthenticated) return;
    try {
      const count = await apiRef.current.getUnreadCount();
      setUnreadCount(count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, [authUser?.isAuthenticated]);

  const handleMarkAsRead = useCallback(async (notificationId: string) => {
    await apiRef.current.markAsRead(notificationId);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const handleMarkAllAsRead = useCallback(async () => {
    await apiRef.current.markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const handleDeleteNotification = useCallback(async (notificationId: string) => {
    await apiRef.current.deleteNotification(notificationId);
    setNotifications((prev) => {
      const deleted = prev.find((n) => n.id === notificationId);
      if (deleted && !deleted.read) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      return prev.filter((n) => n.id !== notificationId);
    });
  }, []);

  const addNotification = useCallback((notification: Notification) => {
    setNotifications((prev) => [notification, ...prev]);
    if (!notification.read) {
      setUnreadCount((prev) => prev + 1);
      setHasUnseen(true);
    }
  }, []);

  const username = authUser?.user?.username;

  const markSeen = useCallback(() => {
    setHasUnseen(false);
    if (username) writeLastSeen(username, Date.now());
  }, [username]);

  // On sign-in, the dot shows if the newest unread notification came after the bell was last opened.
  useEffect(() => {
    setHasUnseen(false);
    if (!authUser?.isAuthenticated || !username) return;
    let active = true;
    apiRef.current
      .getNotifications({ unreadOnly: true, limit: 1 })
      .then(([newest]) => {
        if (active && newest) setHasUnseen(new Date(newest.createdAt).getTime() > readLastSeen(username));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [authUser?.isAuthenticated, username]);

  // Nothing left to read, nothing to point at.
  useEffect(() => {
    if (unreadCount === 0) setHasUnseen(false);
  }, [unreadCount]);

  // Initial fetch
  useEffect(() => {
    if (authUser?.isAuthenticated) {
      fetchUnreadCount();
    }
  }, [authUser?.isAuthenticated, fetchUnreadCount]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount,
      isLoading,
      fetchNotifications,
      fetchUnreadCount,
      markAsRead: handleMarkAsRead,
      markAllAsRead: handleMarkAllAsRead,
      deleteNotification: handleDeleteNotification,
      addNotification,
      hasUnseen,
      markSeen,
    }),
    [notifications, unreadCount, isLoading, fetchNotifications, fetchUnreadCount, handleMarkAsRead, handleMarkAllAsRead, handleDeleteNotification, addNotification, hasUnseen, markSeen]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
