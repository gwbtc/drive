import { useEffect, useState } from 'preact/hooks';
import { initUrbit, type Whoami } from './api';
import { Shell } from './components/Shell';
import { HubView } from './components/HubView';
import { FilesView } from './components/FilesView';
import { NotesView } from './components/NotesView';
import { PhotosView } from './components/PhotosView';
import { TrashView } from './components/TrashView';
import { StarredView } from './components/StarredView';
import { RecentView } from './components/RecentView';
import { SpaceView } from './components/SpaceView';
import { Editor } from './components/Editor';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { recordRecent } from './recents';
import { ToastHost } from './ui/ToastHost';
import { DialogHost } from './ui/DialogHost';
import { ContextMenuHost } from './ui/ContextMenuHost';
import { CommandPalette } from './ui/CommandPalette';
import { dialogQueue } from './ui/dialogs';
import { parseRoute as parseRoutePure, type Route } from './routes';
import {
  decideBoot,
  loadCachedWhoami,
  purgeLocalData,
  saveCachedWhoami,
  shouldPurge,
  type BootDecision,
} from './session';

function parseRoute(): Route {
  return parseRoutePure(window.location.pathname, window.location.search);
}

export function App() {
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute());
  const [cmdK, setCmdK] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Apply the boot decision. Purge (when required) runs BEFORE we render, so
    // a switched-ship / logged-out user never briefly sees the prior session.
    const applyBoot = async (d: BootDecision, errText?: string) => {
      if (cancelled) return;
      if (shouldPurge(d)) {
        await purgeLocalData();
        if (cancelled) return;
      }
      switch (d.screen) {
        case 'app':
          saveCachedWhoami(d.whoami);
          setWhoami(d.whoami);
          setOffline(false);
          break;
        case 'offline':
          // Publish the cached ship (ui.html seeds window.__SHIP__ from the
          // hostname). ourShip()/_ship in api.ts is only set by a *live*
          // whoami, so an offline boot leaves it null — which would make
          // HttpProvider open the per-doc IndexedDB under the wrong key.
          // Exposing the real (normalized) ship here lets that path recover it.
          if (d.whoami.auth === 'ship') window.__SHIP__ = d.whoami.ship;
          setWhoami(d.whoami);
          setOffline(true);
          break;
        case 'login':
          // Server affirmatively said logged-out — caches already purged above.
          setWhoami({ auth: 'none' });
          setOffline(false);
          break;
        case 'error':
          setError(errText ?? "Couldn't connect");
          break;
      }
    };

    const cached = loadCachedWhoami();
    initUrbit()
      .then((w) => applyBoot(decideBoot({ ok: true, whoami: w }, cached)))
      // initUrbit only throws on a genuine network error (fetch rejected /
      // whoami non-2xx) — NOT on an affirmative `{auth:'none'}`, which resolves
      // and routes to the login+purge branch above. So this is the offline PWA
      // path: keep the cache, render from it.
      .catch((e) => applyBoot(decideBoot({ ok: false }, cached), String(e)));
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdK((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // "?" opens the keyboard-shortcuts overlay. Re-subscribed on cmdK/whoami
  // change so the handler closes over fresh values. Guards: only when signed
  // in, never while typing (an input/textarea/contenteditable is focused —
  // which also covers the command-palette / prompt inputs), and never over an
  // already-open dialog or the command palette. ("?" is Shift+/, so it can't
  // collide with the Cmd/Ctrl chords.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!whoami || whoami.auth === 'none') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (cmdK || dialogQueue.value.length > 0) return;
      e.preventDefault();
      setShowShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdK, whoami]);

  // Track opened docs for the Recent view.
  useEffect(() => {
    if (route.kind === 'doc') recordRecent(route.id);
  }, [route]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
  };

  return (
    <>
      {renderBody()}
      {offline && whoami && (
        <div
          role="status"
          data-testid="offline-indicator"
          style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;background:#1a1a1a;color:#fff;font-size:13px;padding:6px 14px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:0.92;pointer-events:none"
        >
          Offline — showing cached content
        </div>
      )}
      {whoami && whoami.auth === 'ship' && route.kind !== 'doc' && (
        <button
          type="button"
          class="shortcuts-fab"
          data-testid="shortcuts-help-button"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setShowShortcuts(true)}
        >
          ?
        </button>
      )}
      <ToastHost />
      <DialogHost />
      <ContextMenuHost />
      {cmdK && <CommandPalette navigate={navigate} onClose={() => setCmdK(false)} />}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
    </>
  );

  function renderBody() {
    if (error) {
      return (
        <div class="loading-screen">
          <div class="error-card">
            <h1>Couldn't connect</h1>
            <p>{error}</p>
          </div>
        </div>
      );
    }
    if (!whoami) {
      return (
        <div class="loading-screen">
          <div class="spinner" />
        </div>
      );
    }

    // Not logged in (server returned `{auth:'none'}`): a clean login screen,
    // NOT a half-rendered shell whose every POST would 401. Prior-session
    // caches were already purged before we got here.
    if (whoami.auth === 'none') {
      return (
        <div class="loading-screen">
          <div class="error-card">
            <h1>Log in to your ship</h1>
            <p>
              You're not signed in. Open your ship's web interface, log in, then
              reload this page to use Drive.
            </p>
            <p style="margin-top:20px">
              <a class="btn" href="/~/login">
                Go to ship login
              </a>
            </p>
          </div>
        </div>
      );
    }

    // Token sessions go straight to the doc editor.
    if (whoami.auth === 'token') {
      const tokenInfo = {
        type: whoami.type,
        role: whoami.role,
        title: whoami.title,
      };
      return (
        <Editor
          docId={whoami.doc}
          viaToken
          ship={whoami.ship}
          navigate={navigate}
          tokenInfo={tokenInfo}
        />
      );
    }

    // Doc editor renders without the standard Shell chrome.
    if (route.kind === 'doc') {
      return (
        <Editor
          docId={route.id}
          viaToken={route.viaToken}
          ship={whoami.ship}
          navigate={navigate}
        />
      );
    }

    return (
      <Shell
        active={route.kind}
        activeSpaceId={route.kind === 'space' ? route.id : null}
        ship={whoami.ship}
        navigate={navigate}
      >
        {route.kind === 'hub' && <HubView ship={whoami.ship} navigate={navigate} />}
        {route.kind === 'files' && (
          <FilesView folderId={route.folderId} navigate={navigate} />
        )}
        {route.kind === 'notes' && <NotesView ship={whoami.ship} navigate={navigate} />}
        {route.kind === 'photos' && <PhotosView navigate={navigate} />}
        {route.kind === 'starred' && <StarredView navigate={navigate} />}
        {route.kind === 'recent' && <RecentView navigate={navigate} />}
        {route.kind === 'trash' && <TrashView />}
        {route.kind === 'space' && (
          <SpaceView spaceId={route.id} ship={whoami.ship} navigate={navigate} />
        )}
      </Shell>
    );
  }
}
