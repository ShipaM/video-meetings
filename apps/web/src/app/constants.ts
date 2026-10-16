export const THEME_STORAGE_KEY = 'theme';

// Runs before hydration so the saved (or system) theme is applied without a flash.
export const THEME_SCRIPT = `(() => {
  try {
    const saved = localStorage.getItem('${THEME_STORAGE_KEY}');
    const theme = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  } catch {}
})();`;

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ACCESS_TOKEN_KEY = 'accessToken';
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const EMAIL_MAX_LENGTH = 254;
export const RECENT_MEETINGS_COUNT = 3;
export const MEETING_TITLE_MAX_LENGTH = 200;
