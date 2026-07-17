import { describe, expect, test } from 'bun:test';
import { parseRoute } from './routes';

describe('parseRoute', () => {
  test('doc route', () => {
    expect(parseRoute('/drive/d/0v123.abcde', '')).toEqual({
      kind: 'doc',
      id: '0v123.abcde',
      viaToken: false,
    });
  });

  test('doc route via token', () => {
    expect(parseRoute('/drive/d/0v123.abcde', '?via=token')).toEqual({
      kind: 'doc',
      id: '0v123.abcde',
      viaToken: true,
    });
  });

  test('doc route with other query params is not viaToken', () => {
    expect(parseRoute('/drive/d/0v1', '?via=other')).toEqual({
      kind: 'doc',
      id: '0v1',
      viaToken: false,
    });
  });

  test('doc route ignores trailing path segments', () => {
    expect(parseRoute('/drive/d/0v1/extra', '')).toEqual({
      kind: 'doc',
      id: '0v1',
      viaToken: false,
    });
  });

  test('files root, with and without trailing slash', () => {
    expect(parseRoute('/drive/files', '')).toEqual({ kind: 'files', folderId: null });
    expect(parseRoute('/drive/files/', '')).toEqual({ kind: 'files', folderId: null });
  });

  test('files folder', () => {
    expect(parseRoute('/drive/files/0vfold.er111', '')).toEqual({
      kind: 'files',
      folderId: '0vfold.er111',
    });
  });

  test('space route', () => {
    expect(parseRoute('/drive/space/0vteam.abcde', '')).toEqual({
      kind: 'space',
      id: '0vteam.abcde',
    });
  });

  test('space route ignores trailing path segments', () => {
    expect(parseRoute('/drive/space/0vteam/extra', '')).toEqual({
      kind: 'space',
      id: '0vteam',
    });
  });

  test('section routes, with and without trailing slash', () => {
    for (const kind of ['notes', 'photos', 'trash', 'starred', 'recent'] as const) {
      expect(parseRoute(`/drive/${kind}`, '')).toEqual({ kind });
      expect(parseRoute(`/drive/${kind}/`, '')).toEqual({ kind });
    }
  });

  test('hub for /drive and anything unknown', () => {
    expect(parseRoute('/drive', '')).toEqual({ kind: 'hub' });
    expect(parseRoute('/drive/', '')).toEqual({ kind: 'hub' });
    expect(parseRoute('/drive/bogus', '')).toEqual({ kind: 'hub' });
    expect(parseRoute('/', '')).toEqual({ kind: 'hub' });
  });
});
