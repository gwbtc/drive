import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import { HttpProvider } from '../providers/HttpProvider';
import { renameDoc, deleteDoc, type DocSummary } from '../api';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import {
  DEFAULT_META,
  NOTE_META_KEY,
  type NoteColor,
  type NoteMeta,
  addLabel,
  cacheNoteMeta,
  normLabels,
  readNoteMeta,
  removeLabel,
} from '../notes/meta';
import { NoteColorPicker } from './NoteColorPicker';
import { NoteLabels } from './NoteLabels';

type Props = {
  note: DocSummary;
  ship: string;
  onDeleted: () => void;
  // Reports this note's metadata up to NotesView so it can sort (pinned first),
  // filter (by label) and hide (archived). Called on mount and whenever the
  // note's `note-meta` Y.Map changes (i.e. after the provider syncs).
  onMeta: (id: string, meta: NoteMeta) => void;
  // Click a label chip on the card to filter the grid to that label.
  onSelectLabel: (label: string) => void;
};

export function NoteCard({ note, ship: _ship, onDeleted, onMeta, onSelectLabel }: Props) {
  const [provider] = useState(() => new HttpProvider(note.id, 'ship', null));
  const [title, setTitle] = useState(note.title);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<NoteMeta>(DEFAULT_META);
  const editorRef = useRef<HTMLDivElement>(null);
  const tiptapRef = useRef<TiptapEditor | null>(null);

  // Keep onMeta out of the observe effect's deps (it changes identity across
  // NotesView renders) so we don't tear down / re-attach the observer.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  useEffect(() => {
    const unsub = provider.ready.subscribe((v) => setReady(v));
    return () => {
      unsub();
      provider.destroy();
    };
  }, [provider]);

  // Live-read the note's metadata off its own Y.Doc. The card's OWN rendering
  // (color, label chips) tracks the map immediately; but we only lift meta UP
  // to NotesView once the provider has synced (`ready`). A card can unmount and
  // remount when a note moves between the Pinned/Others grids — the fresh
  // provider starts with an empty map, and reporting that transient default
  // would clobber NotesView's known meta and bounce the card back. Waiting for
  // `ready` (idb/server state applied) means the first report reflects real
  // data; NotesView keeps the persisted meta in the meantime.
  useEffect(() => {
    const map = provider.ydoc.getMap<unknown>(NOTE_META_KEY);
    const report = () => {
      const m = readNoteMeta(map);
      cacheNoteMeta(note.id, m); // instant partitioning on the next load
      onMetaRef.current(note.id, m);
    };

    setMeta(readNoteMeta(map));
    const onChange = () => {
      setMeta(readNoteMeta(map));
      if (provider.ready.value) report();
    };
    map.observe(onChange);

    // Fires synchronously with the current value (false on a fresh provider),
    // then again when the provider becomes ready — the first upward report.
    const unsubReady = provider.ready.subscribe((r) => {
      if (r) report();
    });

    return () => {
      map.unobserve(onChange);
      unsubReady();
    };
  }, [provider, note.id]);

  useEffect(() => {
    if (!ready || !editorRef.current) return;
    const editor = new TiptapEditor({
      element: editorRef.current,
      extensions: [
        StarterKit.configure({
          history: false,
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
        }),
        Placeholder.configure({ placeholder: 'A quick note…' }),
        Collaboration.configure({ document: provider.ydoc }),
      ],
      editable: true,
    });
    tiptapRef.current = editor;
    return () => {
      editor.destroy();
      tiptapRef.current = null;
    };
  }, [ready, provider]);

  const onTitleBlur = async () => {
    if (title !== note.title) {
      try {
        await renameDoc(note.id, title || 'Untitled note');
      } catch (e) {
        toast.error(e);
      }
    }
  };

  const onDelete = async () => {
    const ok = await confirmDialog({
      title: 'Delete this note?',
      message: 'This note will be moved to the trash.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(note.id);
      toast.success('Moved to trash');
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  };

  // --- metadata writes (all ride the note's Yjs update pipeline) ------------
  // Read the current value straight off the map so concurrent observers never
  // hand us a stale toggle base.
  const metaMap = () => provider.ydoc.getMap<unknown>(NOTE_META_KEY);

  const setColor = (color: NoteColor) => metaMap().set('color', color);
  const togglePin = () => {
    const m = metaMap();
    m.set('pinned', m.get('pinned') !== true);
  };
  const toggleArchive = () => {
    const m = metaMap();
    const next = m.get('archived') !== true;
    m.set('archived', next);
    toast.success(next ? 'Archived' : 'Unarchived');
  };
  const onAddLabel = (raw: string) => {
    const m = metaMap();
    m.set('labels', addLabel(normLabels(m.get('labels')), raw));
  };
  const onRemoveLabel = (label: string) => {
    const m = metaMap();
    m.set('labels', removeLabel(normLabels(m.get('labels')), label));
  };

  return (
    <div class={`note-card note-color-${meta.color}`}>
      <header class="note-card-h">
        <input
          class="note-card-title"
          aria-label="Note title"
          value={title}
          placeholder="Title"
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <button
          class={`btn-icon note-card-pin ${meta.pinned ? 'active' : ''}`}
          data-testid="note-pin"
          title={meta.pinned ? 'Unpin' : 'Pin'}
          aria-label={meta.pinned ? 'Unpin note' : 'Pin note'}
          aria-pressed={meta.pinned}
          onClick={togglePin}
        >
          📌
        </button>
        <button
          class="btn-icon note-card-x"
          title="Delete"
          aria-label="Delete note"
          onClick={onDelete}
        >
          ×
        </button>
      </header>

      <div class="note-card-body" ref={editorRef} />

      {meta.labels.length > 0 && (
        <div class="note-card-labels">
          {meta.labels.map((l) => (
            <button
              key={l}
              type="button"
              class="note-label-chip note-label-chip-btn"
              title={`Filter by ${l}`}
              onClick={() => onSelectLabel(l)}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <footer class="note-card-tools">
        <NoteColorPicker value={meta.color} onPick={setColor} />
        <NoteLabels labels={meta.labels} onAdd={onAddLabel} onRemove={onRemoveLabel} />
        <button
          class={`note-tool-btn ${meta.archived ? 'active' : ''}`}
          data-testid="note-archive"
          title={meta.archived ? 'Unarchive' : 'Archive'}
          aria-label={meta.archived ? 'Unarchive note' : 'Archive note'}
          aria-pressed={meta.archived}
          onClick={toggleArchive}
        >
          {meta.archived ? '📤' : '📥'}
        </button>
      </footer>
    </div>
  );
}
