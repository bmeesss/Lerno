import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const THEME_KEY = 'lerno.theme';
const THEME_EVENT = 'lerno:theme';

function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(THEME_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(THEME_EVENT, listener);
  };
}

/** One UI preference shared by all toggles, including settings and mobile navigation. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore<Theme>(subscribe, getTheme, () => 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggleTheme = useCallback(() => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Device storage may be disabled. */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);
  return { theme, toggleTheme };
}
