import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { Notification } from '../../notification/api/notificationsApi';
import ToastItem, { Toast } from '../components/toast';

export interface ToastContextValue {
  addToast: (notification: Notification) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const maxToasts = 3;
  const idSetRef = useRef(new Set<string>());

  const addToast = useCallback((notification: Notification) => {
    const id = `toast-${++toastCounter}`;
    if (idSetRef.current.has(notification.id)) return;
    idSetRef.current.add(notification.id);

    const toast: Toast = { id, notification };
    setToasts((prev) => {
      const next = [toast, ...prev];
      return next.length > maxToasts ? next.slice(0, maxToasts) : next;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ addToast, removeToast }),
    [addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
