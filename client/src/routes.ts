// Pure route parsing for the hand-rolled SPA router. Kept free of window/
// DOM access so it can be unit-tested; app.tsx feeds it location parts.

export type Route =
  | { kind: 'hub' }
  | { kind: 'files'; folderId: string | null }
  | { kind: 'notes' }
  | { kind: 'photos' }
  | { kind: 'trash' }
  | { kind: 'starred' }
  | { kind: 'recent' }
  | { kind: 'space'; id: string }
  | { kind: 'doc'; id: string; viaToken: boolean };

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);

  let m = pathname.match(/^\/drive\/d\/([^/]+)/);
  if (m) {
    return { kind: 'doc', id: m[1], viaToken: params.get('via') === 'token' };
  }
  m = pathname.match(/^\/drive\/space\/([^/]+)/);
  if (m) return { kind: 'space', id: m[1] };
  m = pathname.match(/^\/drive\/files\/([^/]+)/);
  if (m) return { kind: 'files', folderId: m[1] };
  if (pathname === '/drive/files' || pathname === '/drive/files/') {
    return { kind: 'files', folderId: null };
  }
  if (pathname === '/drive/notes' || pathname === '/drive/notes/') return { kind: 'notes' };
  if (pathname === '/drive/photos' || pathname === '/drive/photos/') return { kind: 'photos' };
  if (pathname === '/drive/trash' || pathname === '/drive/trash/') return { kind: 'trash' };
  if (pathname === '/drive/starred' || pathname === '/drive/starred/') return { kind: 'starred' };
  if (pathname === '/drive/recent' || pathname === '/drive/recent/') return { kind: 'recent' };
  return { kind: 'hub' };
}
