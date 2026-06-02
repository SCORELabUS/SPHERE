import { useEffect, useRef } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { useNotificationsContext } from './useNotificationsContext';
import { useToast } from '../../core/contexts/useToast';

const BASE_URL = import.meta.env.VITE_API_URL;
const SSE_URL = `${BASE_URL}/notifications/stream`;
const INITIAL_DELAY = 2000;
const MAX_DELAY = 60000;

export function useNotificationsSSE() {
  const { authUser } = useAuth();
  const { addNotification, fetchUnreadCount } = useNotificationsContext();
  const { addToast } = useToast();

  const addNotificationRef = useRef(addNotification);
  const fetchUnreadCountRef = useRef(fetchUnreadCount);
  const addToastRef = useRef(addToast);
  addNotificationRef.current = addNotification;
  fetchUnreadCountRef.current = fetchUnreadCount;
  addToastRef.current = addToast;

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(INITIAL_DELAY);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!authUser?.isAuthenticated || !authUser?.token) return;

    stopRef.current = false;
    delayRef.current = INITIAL_DELAY;

    function scheduleReconnect() {
      if (stopRef.current) return;
      timerRef.current = setTimeout(() => {
        delayRef.current = Math.min(delayRef.current * 1.5, MAX_DELAY);
        connect();
      }, delayRef.current);
    }

    function connect() {
      if (stopRef.current) return;
      cleanup();

      const es = new EventSource(`${SSE_URL}?token=${authUser!.token}`);
      esRef.current = es;

      es.addEventListener('connected', () => {
        delayRef.current = INITIAL_DELAY;
      });

      es.addEventListener('notification', (event) => {
        try {
          const notification = JSON.parse(event.data);
          addNotificationRef.current(notification);
          addToastRef.current(notification);
        } catch { /* ignore */ }
      });

      es.addEventListener('unread-count', () => {
        fetchUnreadCountRef.current();
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        scheduleReconnect();
      };
    }

    function cleanup() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    connect();

    return () => {
      stopRef.current = true;
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.isAuthenticated, authUser?.token]);
}
