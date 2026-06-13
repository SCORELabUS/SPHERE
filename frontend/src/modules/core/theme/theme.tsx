import { useState, useEffect, useCallback } from 'react';
import { ModeContext } from '../contexts/modeContext';

const STORAGE_KEY = 'sphere-theme';

function getInitialMode(): 'light' | 'dark' {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMode(mode: 'light' | 'dark') {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export default function SphereThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const initial = getInitialMode();
    setModeState(initial);
    applyMode(initial);
  }, []);

  const setMode = useCallback((next: 'light' | 'dark') => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}
