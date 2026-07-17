import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import {
  listFolderContents,
  createDoc,
  createFolder,
  deleteDoc,
  bulkDelete,
  uploadFile,
  renameDoc,
  starDoc,
  copyDoc,
  BASE,
  type DocSummary,
} from '../api';
import { Breadcrumb } from './Breadcrumb';
import { FilesRow } from './FilesRow';
import { SortControl, sortDocs, type SortKey } from './SortControl';
import { toast } from '../ui/toast';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { openContextMenu } from '../ui/contextMenu';
import { moveToSpaceItems } from '../ui/moveToSpace';
import { personalDocs } from '../spaces';
import { useSpaces } from '../useSpaces';
import { ViewError } from '../ui/ViewError';
import { listingFeed } from '../listingFeed';
import { beginDrag, endDrag, dropOnto, draggedIds } from '../ui/dragState';
import { generateAndUploadThumb } from './ThumbImg';
import { buildServerDoc, type ServerDocState } from '../providers/reconcile';
import { jsonToMarkdown } from '../export/markdown';
import { cellsToCSV } from '../sheets/csv';
import { SheetModel } from '../sheets/model';
import { zipStore, downloadZip, type ZipEntry } from '../export/zip';

type Props = {
  folderId: string | null;
  navigate: (path: string) => void;
};

const SORT_STORAGE_KEY = 'drive:filesSort';

// --- Folder → ZIP export ----------------------------------------------------
//
// Recursively walks a folder, serializing each doc into a file and preserving
// the folder tree as directory paths, then packs everything with the pure
// store-only writer in export/zip.ts. Per-doc serialization:
//   text / note → <title>.md  (rebuild the Y.Doc from /drive/state, convert its
//                 ProseMirror XML fragment to PM-JSON, run the existing Markdown
//                 serializer — full fidelity, no DOM / detached editor needed)
//   sheet       → one CSV per tab (single tab: <title>.csv; multi-tab:
//                 "<title> - <sheet name>.csv" each), so no tab is dropped
//   image/file  → raw /drive/blob bytes with an extension inferred from the mime
// A doc that fails to fetch/serialize is skipped (recorded, not fatal) so one
// bad doc never aborts the whole archive.

type SkippedDoc = { title: string; reason: string };
type ZipResult = { bytes: Uint8Array; skipped: SkippedDoc[]; count: number };

const COMMON_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/tiff': 'tiff',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/html': 'html',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
};

function extFromMime(mime: string | undefined): string {
  if (!mime) return 'bin';
  const m = mime.split(';')[0].trim().toLowerCase();
  if (COMMON_MIME_EXT[m]) return COMMON_MIME_EXT[m];
  // Generic binary → 'bin' rather than the ugly 'octetstream'.
  if (m === 'application/octet-stream' || m === 'application/binary') return 'bin';
  // Fall back to the subtype (drop any `+suffix`, e.g. svg+xml → svg).
  const sub = (m.split('/')[1] || '').split('+')[0].replace(/[^a-z0-9]/g, '');
  return sub || 'bin';
}

// Make a title safe as a single path segment: strip separators / control / other
// filesystem-hostile characters, and any leading dots.
function sanitizeSegment(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    // Clamp so a pathological title can't overflow the ZIP's 16-bit
    // name-length field; Unicode letters survive so a non-ASCII title keeps
    // a real name instead of collapsing to empty.
    .slice(0, 120);
  return cleaned || 'untitled';
}

// De-duplicate a name within one directory, inserting " (2)", " (3)"… before
// the extension so `Report.md` and a second `Report.md` don't collide.
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

async function fetchDocState(id: string): Promise<ServerDocState> {
  const r = await fetch(`${BASE}/state?id=${id}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`state ${r.status}`);
  return r.json();
}

// Append `.ext` unless the sanitized base already ends in it (so a blob titled
// "photo.png" doesn't become "photo.png.png").
function withExt(base: string, ext: string): string {
  return base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? base : `${base}.${ext}`;
}

// Serialize a single (non-folder) doc to one OR MORE { filename, bytes } pairs
// (a multi-tab spreadsheet yields one CSV per sheet).
async function docToFiles(doc: DocSummary): Promise<{ name: string; bytes: Uint8Array }[]> {
  const title = doc.title || 'Untitled';
  const enc = new TextEncoder();
  if (doc.type === 'sheet') {
    const state = await fetchDocState(doc.id);
    const ydoc = buildServerDoc(state);
    try {
      const model = new SheetModel(ydoc);
      const sheets = model.list();
      // Single sheet → "<title>.csv" (unchanged). Multiple → one CSV per tab,
      // "<title> - <sheet name>.csv", so no tab is silently dropped.
      return sheets.map((sh) => {
        const cells: Record<string, string> = {};
        model.cellsMap(sh.id).forEach((v, k) => {
          cells[k] = v;
        });
        const csv = cellsToCSV(cells, 1_000_000, 1_000_000);
        const base =
          sheets.length === 1
            ? sanitizeSegment(title)
            : `${sanitizeSegment(title)} - ${sanitizeSegment(sh.name)}`;
        return { name: `${base}.csv`, bytes: enc.encode(csv) };
      });
    } finally {
      ydoc.destroy();
    }
  }
  if (doc.type === 'text' || doc.type === 'note') {
    const state = await fetchDocState(doc.id);
    const ydoc = buildServerDoc(state);
    try {
      // Tiptap's Collaboration binding stores content in the 'default' XML
      // fragment; y-prosemirror converts it to the same PM-JSON shape that
      // editor.state.doc.toJSON() produces, which jsonToMarkdown consumes.
      const pmJson = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('default'));
      const md = jsonToMarkdown(pmJson);
      return [{ name: `${sanitizeSegment(title)}.md`, bytes: enc.encode(md) }];
    } finally {
      ydoc.destroy();
    }
  }
  // image / file / anything with raw bytes → the blob, verbatim.
  const r = await fetch(`${BASE}/blob?id=${doc.id}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`blob ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const ext = extFromMime(doc.blob?.mime);
  return [{ name: withExt(sanitizeSegment(title), ext), bytes }];
}

async function gatherFolder(
  folderId: string,
  prefix: string,
  entries: ZipEntry[],
  skipped: SkippedDoc[],
  visited: Set<string>,
): Promise<void> {
  // The tree can't contain cycles, but guard defensively anyway.
  if (visited.has(folderId)) return;
  visited.add(folderId);
  let items: DocSummary[];
  try {
    items = await listFolderContents(folderId);
  } catch {
    skipped.push({ title: prefix || 'folder', reason: 'listing failed' });
    return;
  }
  const used = new Set<string>();
  for (const item of items) {
    if (item.type === 'folder') {
      const seg = uniqueName(sanitizeSegment(item.title || 'folder'), used);
      await gatherFolder(item.id, `${prefix}${seg}/`, entries, skipped, visited);
      continue;
    }
    try {
      for (const { name, bytes } of await docToFiles(item)) {
        entries.push({ path: prefix + uniqueName(name, used), bytes });
      }
    } catch {
      skipped.push({ title: item.title || 'Untitled', reason: 'export failed' });
    }
  }
}

async function buildFolderZip(folderId: string): Promise<ZipResult> {
  const entries: ZipEntry[] = [];
  const skipped: SkippedDoc[] = [];
  await gatherFolder(folderId, '', entries, skipped, new Set());
  return { bytes: zipStore(entries), skipped, count: entries.length };
}

export function FilesView({ folderId, navigate }: Props) {
  const [items, setItems] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const s = localStorage.getItem(SORT_STORAGE_KEY);
    return (s as SortKey) || 'modified-desc';
  });
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const lastClickedRef = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const spaces = useSpaces();

  // The personal Files view shows ONLY personal docs — anything assigned to a
  // shared space is separated out into its space view (see spaces.ts).
  const refresh = async () => {
    try {
      const list = await listFolderContents(folderId);
      setItems(
        personalDocs(list).filter((d) => d.type !== 'note' && d.type !== 'image'),
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Live listing over SSE, plus a slow fallback poll in case the stream dies
  // silently. Both call refresh; an initial refresh runs regardless.
  useEffect(() => {
    setLoading(true);
    void refresh();
    const unsub = listingFeed.subscribe(refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [folderId]);

  useEffect(() => {
    localStorage.setItem(SORT_STORAGE_KEY, sortKey);
  }, [sortKey]);

  // Clear selection & keyboard cursor when navigating between folders.
  useEffect(() => {
    setSelected(new Set());
    setFocusIndex(-1);
  }, [folderId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? items.filter((d) => (d.title || '').toLowerCase().includes(q))
      : items;
    // Sort folders first within each sort.
    const folders = sortDocs(base.filter((d) => d.type === 'folder'), sortKey);
    const rest = sortDocs(base.filter((d) => d.type !== 'folder'), sortKey);
    return [...folders, ...rest];
  }, [items, filter, sortKey]);

  // Keep the keyboard cursor in range as the list changes, and scroll it into
  // view when it moves.
  useEffect(() => {
    setFocusIndex((i) => (i >= filtered.length ? filtered.length - 1 : i));
  }, [filtered.length]);

  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${focusIndex}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const onNewDoc = async (type: 'text' | 'sheet') => {
    const title = type === 'sheet' ? 'Untitled Sheet' : 'Untitled Document';
    try {
      await createDoc(type, title, folderId);
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onNewFolder = async () => {
    const name = await promptDialog({
      title: 'New folder',
      placeholder: 'Folder name',
      defaultValue: 'New folder',
      confirmLabel: 'Create',
    });
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim(), folderId);
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    toast
      .promise(uploadFile(file, folderId), {
        loading: `Uploading ${file.name}…`,
        success: `Uploaded ${file.name}`,
      })
      .then(async (docId) => {
        // Best-effort thumbnail when the upload is an image.
        await generateAndUploadThumb(docId, file);
        await refresh();
      })
      .catch(() => {})
      .finally(() => {
        setUploading(false);
        input.value = '';
      });
  };

  const onOpen = (item: DocSummary) => {
    if (item.type === 'folder') navigate(`/drive/files/${item.id}`);
    else navigate(`/drive/d/${item.id}`);
  };

  const onRename = async (item: DocSummary) => {
    const next = await promptDialog({
      title: 'Rename',
      defaultValue: item.title || '',
      placeholder: 'Name',
      confirmLabel: 'Rename',
    });
    if (next === null || next === item.title) return;
    try {
      await renameDoc(item.id, next || 'Untitled');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onDelete = async (item: DocSummary) => {
    const ok = await confirmDialog({
      title: `Delete "${item.title || 'Untitled'}"?`,
      message: 'This item will be moved to the trash.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(item.id);
      toast.success('Moved to trash');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onStar = async (item: DocSummary) => {
    const on = !item.starred;
    // Optimistic — flip locally, then reconcile with the server listing.
    setItems((prev) =>
      prev.map((d) => (d.id === item.id ? { ...d, starred: on } : d)),
    );
    try {
      await starDoc(item.id, on);
    } catch (e) {
      setItems((prev) =>
        prev.map((d) => (d.id === item.id ? { ...d, starred: !on } : d)),
      );
      toast.error(e);
      return;
    }
    void refresh();
  };

  const onCopy = async (item: DocSummary) => {
    try {
      await copyDoc(item.id);
      toast.success('Copy created');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onDownloadZip = async (folder: DocSummary) => {
    const label = folder.title || 'folder';
    try {
      const res = await toast.promise(buildFolderZip(folder.id), {
        loading: `Zipping "${label}"…`,
        success: (r) => `Zipped ${r.count} file${r.count === 1 ? '' : 's'}`,
      });
      if (res.count === 0) {
        toast.info(`"${label}" has nothing to download`);
        return;
      }
      downloadZip(label, res.bytes);
      if (res.skipped.length > 0) {
        toast.info(
          `Skipped ${res.skipped.length} item${res.skipped.length === 1 ? '' : 's'} that couldn't be exported`,
        );
      }
    } catch (e) {
      toast.error(e);
    }
  };

  // --- Drag & drop move ---
  const onRowDragStart = (item: DocSummary) => (e: DragEvent) => {
    // If the dragged row is part of the current selection, move all selected.
    const ids = selected.has(item.id) ? Array.from(selected) : [item.id];
    beginDrag(ids);
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', ids.join(','));
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const onRowDragEnd = () => {
    endDrag();
    setDropTargetId(null);
  };

  const onFolderDragOver = (item: DocSummary) => (e: DragEvent) => {
    // Only folders accept drops, and never a folder onto itself.
    if (item.type !== 'folder' || draggedIds.value.includes(item.id)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== item.id) setDropTargetId(item.id);
  };

  const onFolderDragLeave = (item: DocSummary) => () => {
    if (dropTargetId === item.id) setDropTargetId(null);
  };

  const onFolderDrop = (item: DocSummary) => async (e: DragEvent) => {
    e.preventDefault();
    setDropTargetId(null);
    if (item.type !== 'folder') return;
    await dropOnto(item.id);
    await refresh();
  };

  // --- Keyboard navigation on the list ---
  const onListKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    // Don't hijack keys while typing in an input/textarea/editable element.
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }
    if (filtered.length === 0) return;
    const cur = focusIndex;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex((i) => Math.min(filtered.length - 1, (i < 0 ? -1 : i) + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
        break;
      case 'Enter':
        if (cur >= 0 && cur < filtered.length) {
          e.preventDefault();
          onOpen(filtered[cur]);
        }
        break;
      case 'F2':
        if (cur >= 0 && cur < filtered.length) {
          e.preventDefault();
          void onRename(filtered[cur]);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (cur >= 0 && cur < filtered.length) {
          e.preventDefault();
          void onDelete(filtered[cur]);
        }
        break;
      case 'Escape':
        setSelected(new Set());
        setFocusIndex(-1);
        break;
    }
  };

  const toggleSelect = (item: DocSummary, e: MouseEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && lastClickedRef.current) {
      // Range select from last clicked to this one.
      const ids = filtered.map((d) => d.id);
      const a = ids.indexOf(lastClickedRef.current);
      const b = ids.indexOf(item.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
      }
    } else {
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      lastClickedRef.current = item.id;
    }
    setSelected(next);
    // Keep the keyboard cursor on whatever the user just clicked.
    const idx = filtered.findIndex((d) => d.id === item.id);
    if (idx >= 0) setFocusIndex(idx);
  };

  const onRowContextMenu = (item: DocSummary) => (e: MouseEvent) => {
    e.preventDefault();
    const items: Parameters<typeof openContextMenu>[2] = [
      { label: 'Open', onSelect: () => onOpen(item) },
      { label: item.starred ? 'Unstar' : 'Star', onSelect: () => void onStar(item) },
      { label: 'Rename', onSelect: () => onRename(item) },
      { label: 'Make a copy', onSelect: () => void onCopy(item) },
      { label: 'Delete', danger: true, onSelect: () => onDelete(item) },
    ];
    if (item.type === 'folder') {
      items.splice(1, 0, {
        label: 'Download as ZIP',
        onSelect: () => void onDownloadZip(item),
      });
    }
    if (item.blob) {
      items.splice(3, 0, {
        label: 'Download',
        onSelect: () => {
          const a = document.createElement('a');
          a.href = `/drive/blob?id=${item.id}`;
          a.download = item.title || 'download';
          a.click();
        },
      });
    }
    // "Move to space" — from the personal Files view a doc's current space is
    // always null; the helper omits the section for folders / when no space
    // destination exists.
    const moveItems = moveToSpaceItems(item, spaces, null, () => void refresh());
    if (moveItems.length > 0) items.push(...moveItems);
    openContextMenu(e.clientX, e.clientY, items);
  };

  const bulkDoDelete = async () => {
    if (selected.size === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`,
      message: 'They will be moved to the trash.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await bulkDelete(Array.from(selected));
      toast.success(`Moved ${selected.size} to trash`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  // When exactly one folder is selected, offer a ZIP download in the bulk bar.
  const soleFolder =
    selected.size === 1
      ? filtered.find((d) => selected.has(d.id) && d.type === 'folder')
      : undefined;

  return (
    <div class="files">
      <h1 class="sr-only">Files</h1>
      <header class="files-header">
        <Breadcrumb folderId={folderId} navigate={navigate} />
        <div class="files-actions">
          <button class="btn" onClick={() => onNewDoc('text')}>+ Document</button>
          <button class="btn" onClick={() => onNewDoc('sheet')}>+ Sheet</button>
          <button class="btn" onClick={onNewFolder}>+ Folder</button>
          <label class="btn upload-btn">
            {uploading ? 'Uploading…' : '⬆ Upload'}
            <input type="file" disabled={uploading} onChange={onUpload} style="display:none" />
          </label>
        </div>
        <div class="files-tools">
          <input
            class="input files-filter"
            type="search"
            aria-label="Filter files by name"
            placeholder="Filter…"
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          />
          <SortControl value={sortKey} onChange={setSortKey} />
        </div>
      </header>

      {selected.size > 0 && (
        <div class="bulk-bar" role="region" aria-label="Bulk actions">
          <span class="bulk-count">{selected.size} selected</span>
          {soleFolder && (
            <button class="btn" onClick={() => void onDownloadZip(soleFolder)}>
              Download as ZIP
            </button>
          )}
          <button class="btn danger" onClick={bulkDoDelete}>Delete</button>
          <button class="btn" onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}

      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && filtered.length === 0 && (
        <div class="empty">
          <p>{filter ? 'No matches.' : 'This folder is empty.'}</p>
          {!filter && <p class="muted">Create something above, or upload a file.</p>}
        </div>
      )}

      {filtered.length > 0 && (
        <ul
          class="files-list"
          ref={listRef}
          tabIndex={0}
          aria-label="Files"
          onKeyDown={onListKeyDown}
        >
          {filtered.map((item, i) => (
            <FilesRow
              key={item.id}
              item={item}
              index={i}
              focused={i === focusIndex}
              selected={selected.has(item.id)}
              showCheckbox={selected.size > 0}
              draggable
              dropHover={dropTargetId === item.id}
              onOpen={onOpen}
              onDelete={onDelete}
              onStar={onStar}
              onToggleSelect={(e) => toggleSelect(item, e)}
              onContextMenu={onRowContextMenu(item)}
              onDragStart={onRowDragStart(item)}
              onDragEnd={onRowDragEnd}
              onDragOver={item.type === 'folder' ? onFolderDragOver(item) : undefined}
              onDragLeave={item.type === 'folder' ? onFolderDragLeave(item) : undefined}
              onDrop={item.type === 'folder' ? onFolderDrop(item) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
