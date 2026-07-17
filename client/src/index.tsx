import { render } from 'preact';
import { App } from './app';

render(<App />, document.getElementById('root')!);

// Register the offline-shell service worker (scoped to /drive/). Best-effort:
// guard for browsers without SW support and swallow registration errors so a
// failure here never blocks the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/drive/sw.js', { scope: '/drive/' })
      .catch(() => {
        /* SW unsupported / blocked — the app still works, just not offline */
      });
  });
}
