import { useEffect, useRef, useState } from 'preact/hooks';
import * as Y from 'yjs';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useFocusTrap } from '../ui/useFocusTrap';
import {
  listVersions,
  listVersionCheckpoints,
  getVersionBlob,
  saveVersion,
  formatDate,
  type HistoryEntry,
  type VersionInfo,
} from '../api';
import type { DocProvider } from '../providers/types';
import { promptDialog, confirmDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { groupSessions, contributorSummary, type EditSession } from '../history/sessions';
import {
  decodeVersion,
  extractPlainText,
  extractSheetText,
  restoreTextInto,
  restoreSheetInto,
} from '../history/restore';

type Props = {
  docId: string;
  provider: DocProvider;
  editor: TiptapEditor | null;
  docType: string;
  onClose: () => void;
};

type Preview = { version: VersionInfo; body: string };

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const sessionLine = (s: EditSession): string => {
  const changes = `${s.count} change${s.count === 1 ? '' : 's'}`;
  const when = s.end != null ? formatDate(s.end) : '';
  return when ? `${s.author} · ${changes} · ${when}` : `${s.author} · ${changes}`;
};

export function HistoryPanel({ docId, provider, editor, docType, onClose }: Props) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const isSheet = docType === 'sheet';

  const refresh = async () => {
    const [v, e] = await Promise.all([
      listVersionCheckpoints(docId),
      listVersions(docId),
    ]);
    setVersions(v);
    setEntries(e);
  };

  // Escape closes the open preview first, otherwise the whole panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (preview) setPreview(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        await refresh();
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId]);

  const named = versions.filter((v) => v.label != null);
  const sessions = groupSessions(entries);
  const snapshots = entries.filter((e) => e.kind === 'snapshot');

  const onSaveVersion = async () => {
    const name = await promptDialog({
      title: 'Save this version',
      message: 'Name it so you can find and restore it later.',
      placeholder: 'e.g. Final draft',
      confirmLabel: 'Save',
    });
    if (name == null) return;
    const label = name.trim();
    if (!label) return;
    setBusy('save');
    try {
      const blob = Array.from(Y.encodeStateAsUpdate(provider.ydoc));
      await saveVersion(docId, label, blob);
      toast.success('Version saved');
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const onPreview = async (v: VersionInfo) => {
    setBusy(`preview-${v.at}`);
    try {
      const blob = await getVersionBlob(docId, v.at);
      if (!blob) throw new Error('Version data is unavailable');
      const scratch = decodeVersion(blob);
      const body = isSheet ? extractSheetText(scratch) : extractPlainText(scratch);
      setPreview({ version: v, body });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async (v: VersionInfo) => {
    const label = v.label ?? 'this version';
    const ok = await confirmDialog({
      title: 'Restore this version?',
      message:
        `Your current document is saved first (as "Before restore …"), then ` +
        `replaced with "${label}". Nothing is lost — you can restore back anytime.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;

    setBusy(`restore-${v.at}`);
    try {
      // 1. Fetch the target version FIRST (a network round-trip during which
      //    collaborators may keep editing the live doc via SSE).
      const blob = await getVersionBlob(docId, v.at);
      if (!blob) throw new Error('Version data is unavailable');
      const scratch = decodeVersion(blob);

      // 2. Safeguard + destructive replace happen SYNCHRONOUSLY, with no
      //    await between them, so no SSE fact can interleave a collaborator
      //    edit that the safeguard misses and the replace then deletes.
      //    (Encoding the safeguard before the fetch above would let an edit
      //    that arrives mid-fetch be lost by the replace — an M1 violation.)
      const current = Array.from(Y.encodeStateAsUpdate(provider.ydoc));
      if (isSheet) {
        restoreSheetInto(provider.ydoc, scratch);
      } else {
        if (!editor) throw new Error('Editor is not ready');
        restoreTextInto(editor, scratch);
      }

      // 3. Persist the safeguard (async is fine now — the live doc already
      //    holds the restored content, and `current` captured everything
      //    that existed the instant before the replace).
      await saveVersion(docId, `Before restore ${formatDate(Date.now())}`, current);

      setPreview(null);
      toast.success(`Restored "${label}"`);
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside class="history-panel" role="complementary" aria-label="Document history">
      <header class="history-header">
        <span class="history-title">Version history</span>
        <button class="btn-icon" aria-label="Close history" onClick={onClose}>×</button>
      </header>

      <div class="history-save-row">
        <button
          class="btn primary"
          disabled={busy !== null}
          onClick={onSaveVersion}
        >
          Save current version…
        </button>
      </div>

      {loading && <div class="muted" style="padding: 16px">Loading…</div>}
      {!loading && error && (
        <div class="muted" style="padding: 16px" role="alert">
          Couldn't load history.
        </div>
      )}

      {!loading && !error && (
        <div class="history-scroll">
          <section class="history-section">
            <h3 class="history-section-title">Named versions</h3>
            {named.length === 0 ? (
              <p class="muted history-empty">
                No saved versions yet. Use “Save current version…” to name one.
              </p>
            ) : (
              <ul class="history-vlist">
                {named.map((v) => {
                  const contribs = contributorSummary(v.contributors);
                  return (
                    <li key={v.at} class="history-version">
                      <div class="history-version-main">
                        <span class="history-version-label">{v.label}</span>
                        <span class="history-version-sub muted">
                          {v.author} · {formatDate(v.at)}
                          {contribs ? ` · ${contribs}` : ''}
                        </span>
                      </div>
                      <div class="history-version-actions">
                        <button
                          class="history-act"
                          disabled={busy !== null}
                          onClick={() => onPreview(v)}
                        >
                          Preview
                        </button>
                        <button
                          class="history-act primary"
                          disabled={busy !== null}
                          onClick={() => onRestore(v)}
                        >
                          {busy === `restore-${v.at}` ? 'Restoring…' : 'Restore'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section class="history-section">
            <h3 class="history-section-title">Activity</h3>
            {sessions.length === 0 && snapshots.length === 0 ? (
              <p class="muted history-empty">No edits recorded yet.</p>
            ) : (
              <ul class="history-vlist">
                {sessions.map((s, i) => (
                  <li key={`s${i}`} class="history-session">
                    <span class="history-session-line">{sessionLine(s)}</span>
                    <span class="history-meta">{formatBytes(s.bytes)}</span>
                  </li>
                ))}
                {snapshots.map((snap, i) => (
                  <li key={`snap${i}`} class="history-session history-baseline">
                    <span class="history-session-line">Baseline snapshot</span>
                    <span class="history-meta">{formatBytes(snap.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {preview && (
        <PreviewModal
          preview={preview}
          busy={busy}
          onClose={() => setPreview(null)}
          onRestore={onRestore}
        />
      )}
    </aside>
  );
}

// The version-preview overlay is a true modal: it traps focus and restores it
// to the trigger on close (Escape is handled by the parent HistoryPanel).
function PreviewModal({
  preview,
  busy,
  onClose,
  onRestore,
}: {
  preview: Preview;
  busy: string | null;
  onClose: () => void;
  onRestore: (v: VersionInfo) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="modal history-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-preview-title"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="modal-header">
          <div>
            <h2 id="history-preview-title">{preview.version.label ?? 'Version'}</h2>
            <p class="muted history-preview-meta">
              {preview.version.author} · {formatDate(preview.version.at)}
            </p>
          </div>
          <button class="btn-icon" aria-label="Close preview" onClick={onClose}>
            ×
          </button>
        </header>
        <pre class="history-preview-body">{preview.body || '(empty)'}</pre>
        <footer class="history-preview-actions">
          <button class="btn" onClick={onClose}>
            Close
          </button>
          <button
            class="btn primary"
            disabled={busy !== null}
            onClick={() => onRestore(preview.version)}
          >
            Restore this version
          </button>
        </footer>
      </div>
    </div>
  );
}
