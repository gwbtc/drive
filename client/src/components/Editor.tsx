import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor as TiptapEditor, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import CharacterCount from '@tiptap/extension-character-count';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Typography from '@tiptap/extension-typography';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { FontSize } from '../extensions/FontSize';
import { HttpProvider } from '../providers/HttpProvider';
import type { DocProvider, Status, SaveState } from '../providers/types';
import { ConnectionPip } from './ConnectionPip';
import { ShareDialog } from './ShareDialog';
import { Toolbar } from './Toolbar';
import { SheetEditor } from './SheetEditor';
import { FileView } from './FileView';
import { CommentsPane } from './CommentsPane';
import { PresenceStack } from './PresenceStack';
import { CommentMark } from '../extensions/CommentMark';
import { SearchHighlight } from '../extensions/SearchHighlight';
import { FindReplace } from './FindReplace';
import { HistoryPanel } from './HistoryPanel';
import { downloadMarkdown } from '../export/markdown';
import { downloadHtml } from '../export/html';
import { sanitizePastedHtml } from '../paste/sanitize';
import { DocLink, type DocLinkState } from '../extensions/DocLink';
import { OutlinePane } from './OutlinePane';
import { TemplatePicker } from './TemplatePicker';
import { DocLinkPicker } from './DocLinkPicker';
import { Dropdown } from './toolbar/Dropdown';
import { renameDoc, listDocs, subscribeRemote, uploadFile, type DocSummary } from '../api';
import { toast } from '../ui/toast';

type Props = {
  docId: string;
  viaToken: boolean;
  ship: string;
  navigate: (path: string) => void;
  tokenInfo?: {
    type: 'text' | 'sheet' | 'note' | 'image' | 'file' | 'folder';
    role: 'owner' | 'editor' | 'commenter' | 'viewer';
    title: string;
  };
};

const userColor = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 60%, 50%)`;
};

export function Editor({ docId, viaToken, ship, navigate, tokenInfo }: Props) {
  const [provider, setProvider] = useState<DocProvider | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [title, setTitle] = useState(tokenInfo?.title ?? '');
  const [meta, setMeta] = useState<DocSummary | null>(null);
  const metaRef = useRef<DocSummary | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [providerDocType, setProviderDocType] = useState<string | undefined>(undefined);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [role, setRole] = useState<string>(tokenInfo?.role ?? 'viewer');
  const [tiptapEditor, setTiptapEditor] = useState<TiptapEditor | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleFocusedRef = useRef<boolean>(false);
  const prevRoleRef = useRef<string>(tokenInfo?.role ?? 'viewer');
  const [roleBanner, setRoleBanner] = useState<string | null>(null);
  const [findMode, setFindMode] = useState<null | 'find' | 'replace'>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [docLinkState, setDocLinkState] = useState<DocLinkState | null>(null);
  const docLinkKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  // Sync the browser tab title with the doc title.
  useEffect(() => {
    const t = title?.trim();
    document.title = t ? `${t} — Drive` : 'Drive';
    return () => {
      document.title = 'Drive';
    };
  }, [title]);

  // Cmd+F / Cmd+H opens find / replace. Only activates inside a text doc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'f' || e.key === 'F') {
        if (!tiptapEditor) return;
        e.preventDefault();
        setFindMode('find');
      }
      if (e.key === 'h' || e.key === 'H') {
        if (!tiptapEditor) return;
        // Don't hijack Cmd+H on macOS hide-window; only when an alt is also held.
        if (!e.altKey && !e.shiftKey) return;
        e.preventDefault();
        setFindMode('replace');
      }
      if (e.key === 'Escape' && findMode) {
        setFindMode(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tiptapEditor, findMode]);

  // Watch for role demotion (any change away from owner/editor toward a less-
  // privileged role) and show an 8s banner so the user knows their saves may
  // start silently failing.
  useEffect(() => {
    const rank = (r: string) =>
      r === 'owner' ? 4 : r === 'editor' ? 3 : r === 'commenter' ? 2 : 1;
    const prev = rank(prevRoleRef.current);
    const curr = rank(role);
    if (prev > curr && prev > 1) {
      setRoleBanner(`Your access changed to ${role}`);
      const t = setTimeout(() => setRoleBanner(null), 8000);
      prevRoleRef.current = role;
      return () => clearTimeout(t);
    }
    prevRoleRef.current = role;
  }, [role]);

  // Token users get type/title from whoami; ship users get them from
  // listDocs, with the provider's live %meta doc-type (v8+) as fallback —
  // that's what tells a mirror it's really a sheet before any local
  // listing knows about it.
  const docType =
    (viaToken ? tokenInfo?.type : meta?.type ?? providerDocType) ?? 'text';

  // Display name in collaboration cursors. Token users are anonymized as
  // "Guest" so the doc owner doesn't see "~zod" labels for share-link users.
  const displayName = viaToken ? 'Guest' : ship;

  // Pull meta (only for ship-authed users; tokens infer from whoami).
  useEffect(() => {
    if (viaToken) return;
    void listDocs().then((l) => {
      // Shared entries (owner-pushed invites) matter for docs we've never
      // opened: they carry the owner ship, which drives subscribe-remote.
      const found =
        l.owned?.find((d) => d.id === docId) ||
        (l.mirrored?.find((d) => d.id === docId) as unknown as DocSummary | undefined) ||
        (l.shared?.find((d) => d.id === docId) as unknown as DocSummary | undefined);
      if (found) {
        setMeta(found);
        metaRef.current = found;
        if (!titleFocusedRef.current) setTitle(found.title);
      }
    });
  }, [docId, viaToken]);

  // Provider is mounted ONCE per docId/viaToken — not when meta loads.
  // This avoids ghost cursors caused by tearing down + remounting the
  // Y.Doc (each Y.Doc has its own clientID, so a remount registers a
  // second cursor in peers' awareness maps).
  useEffect(() => {
    const p: DocProvider = new HttpProvider(docId, viaToken ? 'token' : 'ship');
    setProvider(p);
    setProviderReady(false);
    const unsubStatus = p.status.subscribe((v) => setStatus(v));
    const unsubSave = p.saveState.subscribe((v) => setSaveState(v));
    const unsubComments = p.commentsVersion.subscribe((v) => setCommentsVersion(v));
    const unsubRole = p.role.subscribe((v) => setRole(v));
    const unsubReady = p.ready.subscribe((v) => setProviderReady(v));
    const unsubMeta = p.meta.subscribe((m) => {
      // Don't clobber the title input while the user is editing it.
      if (m.title && !titleFocusedRef.current) setTitle(m.title);
      if (m.docType) setProviderDocType(m.docType);
    });
    return () => {
      unsubStatus();
      unsubSave();
      unsubComments();
      unsubRole();
      unsubReady();
      unsubMeta();
      p.destroy();
    };
  }, [docId, viaToken]);

  // Once meta loads and we know the doc is on a remote ship, ask our local
  // agent to mirror it. Idempotent.
  useEffect(() => {
    if (viaToken || !meta) return;
    if (meta.owner === ship) return;
    void subscribeRemote(meta.owner, docId).catch(() => {});
  }, [viaToken, meta?.owner, docId, ship]);

  const isEditable = viaToken
    ? tokenInfo?.role === 'editor' || tokenInfo?.role === 'owner'
    : (role === 'owner' ||
        role === 'editor' ||
        meta?.role === 'owner' ||
        meta?.role === 'editor');

  const isText = docType === 'text';
  const isNote = docType === 'note';
  const isSheet = docType === 'sheet';
  const isImage = docType === 'image';
  const isFile = docType === 'file';

  // Mount Tiptap once provider is ready. Don't re-mount on isEditable change.
  useEffect(() => {
    if (!provider || !providerReady || !editorRef.current) return;
    if (isSheet || isImage || isFile) return;

    const placeholder = isNote ? 'A quick note…' : 'Start typing…';
    const extensions: AnyExtension[] = [
      StarterKit.configure({
        history: false,
        heading: isNote ? false : { levels: [1, 2, 3] },
        codeBlock: isNote ? false : {},
        blockquote: isNote ? false : {},
        horizontalRule: isNote ? false : {},
      }),
      Placeholder.configure({ placeholder }),
      Collaboration.configure({ document: provider.ydoc }),
      CollaborationCursor.configure({
        // Awareness identity. `ship` is the trusted axis (server stamps
        // src.bowl on awareness facts); name/color are display-only.
        provider: { awareness: provider.awareness },
        user: { name: displayName, color: userColor(displayName), ship },
      }),
      Underline,
      Subscript,
      Superscript,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Typography,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Highlight.configure({ multicolor: false }),
    ];
    if (!isNote) {
      extensions.push(
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Image.configure({ inline: false, allowBase64: false }),
        Table.configure({ resizable: false, HTMLAttributes: { class: 'doc-table' } }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({ nested: true }),
        CharacterCount,
        CommentMark,
        SearchHighlight,
        DocLink.configure({
          onStateChange: setDocLinkState,
          keyHandler: docLinkKeyRef,
        }),
      );
    }
    const editor = new TiptapEditor({
      element: editorRef.current,
      extensions,
      editable: isEditable,
      editorProps: {
        // Clean Word / Google Docs / web HTML before it becomes a transaction.
        // Runs BEFORE the ProseMirror/Yjs transaction, so it's fully
        // compatible with the Collaboration binding.
        transformPastedHTML: (html) => sanitizePastedHtml(html),
        handleDrop(view, event) {
          const dt = (event as DragEvent).dataTransfer;
          const file = dt?.files?.[0];
          if (!file || !file.type.startsWith('image/')) return false;
          event.preventDefault();
          const coords = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          toast
            // Parent the image doc under this doc: keeps it out of the Files
            // root and lets link viewers of this doc fetch its blob.
            .promise(uploadFile(file, docId), {
              loading: 'Uploading image…',
              success: 'Image inserted',
            })
            .then((newDocId) => {
              const url = `/drive/blob?id=${newDocId}`;
              const node = view.state.schema.nodes.image?.create({ src: url, alt: file.name });
              if (!node) return;
              const tr = view.state.tr.insert(coords?.pos ?? view.state.selection.from, node);
              view.dispatch(tr);
            })
            .catch(() => {});
          return true;
        },
        handlePaste(view, event) {
          const items = (event as ClipboardEvent).clipboardData?.items;
          if (!items) return false;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === 'file' && it.type.startsWith('image/')) {
              const file = it.getAsFile();
              if (!file) continue;
              event.preventDefault();
              toast
                .promise(uploadFile(file, docId), {
                  loading: 'Uploading image…',
                  success: 'Image inserted',
                })
                .then((newDocId) => {
                  const url = `/drive/blob?id=${newDocId}`;
                  const node = view.state.schema.nodes.image?.create({ src: url, alt: 'pasted image' });
                  if (!node) return;
                  const tr = view.state.tr.replaceSelectionWith(node);
                  view.dispatch(tr);
                })
                .catch(() => {});
              return true;
            }
          }
          return false;
        },
      },
    });
    setTiptapEditor(editor);
    return () => {
      editor.destroy();
      setTiptapEditor(null);
    };
  }, [provider, providerReady, displayName, isSheet, isImage, isFile, isNote]);

  // Templates are chosen explicitly from the ⋯ menu ("New from template…").
  // We deliberately do NOT auto-open a chooser on an empty doc: a doc can be
  // transiently empty for reasons other than "brand new" — a collaborator's
  // view before first sync, an offline reload loading from cache, a remote
  // doc whose content lands async — and auto-opening then covers the editor.

  // Navigate internal doc links (e.g. inserted `@`-mentions) SPA-internally
  // rather than triggering a full page load. External links keep their
  // existing behavior.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !tiptapEditor) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('/drive/')) {
        e.preventDefault();
        navigate(href);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [tiptapEditor, navigate]);

  useEffect(() => {
    if (!tiptapEditor) return;
    if (tiptapEditor.isEditable !== isEditable) {
      tiptapEditor.setEditable(isEditable);
    }
  }, [tiptapEditor, isEditable]);


  const saveTitle = async () => {
    if (viaToken) return;
    if (!isEditable) return;
    const trimmed = (title || '').trim();
    const next = trimmed || 'Untitled';
    const cur = metaRef.current;
    if (cur && next === cur.title) return;
    try {
      await renameDoc(docId, next);
      if (cur) metaRef.current = { ...cur, title: next };
    } catch (e) {
      toast.error(e);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate('/drive');
  };

  const renderBody = () => {
    if (isSheet) {
      return provider && providerReady ? (
        <SheetEditor provider={provider} editable={isEditable} />
      ) : (
        <div class="loading-skel">Loading…</div>
      );
    }
    if (isImage) {
      return (
        <div class="image-view">
          <img src={`/drive/blob?id=${docId}`} alt={meta?.title || title || 'Image'} />
        </div>
      );
    }
    if (isFile) {
      return <FileView docId={docId} meta={meta} />;
    }
    if (!providerReady) {
      return <div class="loading-skel">Loading…</div>;
    }
    return <div class={`prose ${isNote ? 'prose-note' : ''}`} ref={editorRef} />;
  };

  const supportsComments = isText;

  return (
    <div class="editor-shell">
      <header class="editor-header">
        <button class="back-btn" onClick={goBack} title="Back" aria-label="Back to files">
          <span class="back-arrow">←</span>
        </button>
        <input
          class="title-input"
          aria-label="Document title"
          value={title}
          placeholder="Untitled"
          readOnly={viaToken || !isEditable}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onFocus={() => {
            titleFocusedRef.current = true;
          }}
          onBlur={async () => {
            titleFocusedRef.current = false;
            await saveTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <div class="editor-header-actions">
          {provider && (
            <PresenceStack
              awareness={provider.awareness}
              me={provider.awareness.clientID}
              ship={ship}
            />
          )}
          <ConnectionPip status={status} save={isEditable ? saveState : undefined} />
          {isText && tiptapEditor && (
            <button
              class={`icon-btn ${outlineOpen ? 'active' : ''}`}
              data-testid="outline-toggle"
              title="Outline"
              aria-label="Toggle outline"
              aria-pressed={outlineOpen}
              onClick={() => setOutlineOpen((v) => !v)}
            >
              ☰
            </button>
          )}
          {supportsComments && (
            <button
              class={`icon-btn ${showComments ? 'active' : ''}`}
              title="Comments"
              aria-label="Toggle comments"
              aria-pressed={showComments}
              onClick={() => setShowComments((v) => !v)}
            >
              💬
            </button>
          )}
          {(isSheet || isNote) && provider && providerReady && (
            <button
              class="icon-btn"
              title="Version history"
              aria-label="Version history"
              onClick={() => setShowHistory(true)}
            >
              🕘
            </button>
          )}
          {isText && tiptapEditor && (
            <Dropdown label="⋯" title="More actions" align="right">
              {(close) => (
                <ul class="tb-drop-list">
                  <li>
                    <button class="tb-drop-item" onClick={() => { setOutlineOpen((v) => !v); close(); }}>
                      {outlineOpen ? 'Hide outline' : 'Show outline'}
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" data-testid="templates-menu" onClick={() => { setShowTemplates(true); close(); }}>
                      New from template…
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" onClick={() => { setFindMode('find'); close(); }}>
                      Find & replace (⌘F)
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" onClick={() => { setShowHistory(true); close(); }}>
                      Version history
                    </button>
                  </li>
                  <li class="tb-drop-sep" aria-hidden="true" />
                  <li>
                    <button class="tb-drop-item" onClick={() => { window.print(); close(); }}>
                      Print / Save as PDF
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" onClick={() => {
                      downloadMarkdown(tiptapEditor, title || 'untitled');
                      close();
                    }}>
                      Download Markdown
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" onClick={() => {
                      downloadHtml(tiptapEditor, title || 'untitled');
                      close();
                    }}>
                      Download as HTML
                    </button>
                  </li>
                  <li>
                    <button class="tb-drop-item" onClick={() => {
                      close();
                      // Lazy-load the exporter so its code only parses on use.
                      void import('../export/docx').then((m) =>
                        m.downloadDocx(tiptapEditor, title || 'untitled'),
                      );
                    }}>
                      Download as Word (.docx)
                    </button>
                  </li>
                </ul>
              )}
            </Dropdown>
          )}
          {!viaToken && meta?.role === 'owner' && (
            <button class="btn primary pill" onClick={() => setShowShare(true)}>
              Share
            </button>
          )}
        </div>
      </header>
      {(isText || isNote) && isEditable && (
        <Toolbar editor={tiptapEditor} variant={isNote ? 'note' : 'text'} />
      )}
      {findMode && tiptapEditor && (
        <FindReplace
          editor={tiptapEditor}
          onClose={() => setFindMode(null)}
          initialMode={findMode}
        />
      )}
      <main
        class={`editor-layout ${
          outlineOpen && isText && tiptapEditor ? 'with-outline' : ''
        } ${showComments && supportsComments ? 'with-comments' : ''}`}
      >
        {outlineOpen && isText && tiptapEditor && (
          <OutlinePane editor={tiptapEditor} onClose={() => setOutlineOpen(false)} />
        )}
        <div
          class={`editor-body ${isNote ? 'note-body' : ''} ${
            isImage ? 'image-body' : ''
          } ${isFile ? 'file-body' : ''}`}
        >
          {renderBody()}
        </div>
        {showComments && supportsComments && (
          <CommentsPane
            docId={docId}
            ship={ship}
            editor={tiptapEditor}
            commentsVersion={commentsVersion}
          />
        )}
        {showHistory && (isText || isSheet || isNote) && provider && (
          <HistoryPanel
            docId={docId}
            provider={provider}
            editor={tiptapEditor}
            docType={docType}
            onClose={() => setShowHistory(false)}
          />
        )}
      </main>
      {showShare && meta && (
        <ShareDialog doc={meta} onClose={() => setShowShare(false)} ship={ship} />
      )}
      {showTemplates && isText && tiptapEditor && isEditable && (
        <TemplatePicker editor={tiptapEditor} onClose={() => setShowTemplates(false)} />
      )}
      {docLinkState?.active && tiptapEditor && (
        <DocLinkPicker
          editor={tiptapEditor}
          state={docLinkState}
          keyHandler={docLinkKeyRef}
          onClose={() => setDocLinkState(null)}
        />
      )}
      {status === 'revoked' && (
        <div class="banner error">Access has been revoked.</div>
      )}
      {(status === 'offline' || status === 'reconnecting') && (
        <div class="banner warning">Reconnecting…</div>
      )}
      {roleBanner && <div class="banner warning">{roleBanner}</div>}
      {isText && tiptapEditor && (
        <WordCountFooter editor={tiptapEditor} />
      )}
    </div>
  );
}

function WordCountFooter({ editor }: { editor: TiptapEditor }) {
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force((n) => n + 1);
    editor.on('update', tick);
    editor.on('selectionUpdate', tick);
    return () => {
      editor.off('update', tick);
      editor.off('selectionUpdate', tick);
    };
  }, [editor]);
  const cc = editor.storage.characterCount;
  if (!cc) return null;
  const { from, to, empty } = editor.state.selection;
  let selection: { words: number; chars: number } | null = null;
  if (!empty) {
    const text = editor.state.doc.textBetween(from, to, ' ', ' ');
    selection = {
      words: (text.trim().match(/\S+/g) || []).length,
      chars: text.length,
    };
  }
  return (
    <footer class="editor-footer" data-testid="word-count">
      <span>
        {cc.words()} words · {cc.characters()} characters
        {selection && (
          <span class="word-count-sel">
            {' '}
            ({selection.words} selected {selection.words === 1 ? 'word' : 'words'} ·{' '}
            {selection.chars} {selection.chars === 1 ? 'char' : 'chars'})
          </span>
        )}
      </span>
    </footer>
  );
}
