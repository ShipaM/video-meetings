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
