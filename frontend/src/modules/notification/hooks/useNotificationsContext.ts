import { useContext } from 'react';
import { NotificationsContext, NotificationsContextValue } from '../contexts/notificationsContext';

export function useNotificationsContext(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotificationsContext must be used within a NotificationsProvider');
  }
  return context;
}
