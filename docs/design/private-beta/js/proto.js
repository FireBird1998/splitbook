(function () {
  const STORAGE_KEY = 'splitwise-proto-theme';
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('theme');
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme =
    fromQuery === 'dark' || fromQuery === 'light'
      ? fromQuery
      : stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

  document.documentElement.setAttribute('data-theme', theme);

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY, next);
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(next === btn.dataset.themeToggle));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(theme === btn.dataset.themeToggle));
      btn.addEventListener('click', () => setTheme(btn.dataset.themeToggle));
    });

    const path = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.getAttribute('href') === path) {
        link.setAttribute('aria-current', 'page');
      }
    });
  });
})();
