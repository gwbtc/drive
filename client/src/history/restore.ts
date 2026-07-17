// Version-restore mechanics.
//
// Restoring cannot be done by replaying an old snapshot into the live Y.Doc:
// Yjs updates are monotonic, so the live state vector already subsumes any
// older state and re-applying it is a no-op. Instead we compute ONE forward
// transaction on the LIVE doc that makes its content equal a target version's
// content. That transaction flows through the provider's normal
// `ydoc.on('update')` pipeline, so a restore is just another authored edit —
// nothing is lost and the history stays intact by construction.

import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
import { SheetModel } from '../sheets/model';

// Decode a stored version blob (full encoded Y.Doc state) into a fresh scratch
// doc. The scratch doc is disconnected from any provider.
export function decodeVersion(blob: number[]): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(blob));
  return doc;
}

// Plaintext of a rich-text doc's 'default' XmlFragment — used for the preview
// modal (and as the readable body when a live editor isn't a rich-text one).
export function extractPlainText(doc: Y.Doc): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node instanceof Y.XmlText) {
      const delta = node.toDelta() as Array<{ insert?: unknown }>;
      for (const op of delta) if (typeof op.insert === 'string') parts.push(op.insert);
    } else if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      for (const child of (node as Y.XmlFragment).toArray()) walk(child);
      parts.push('\n'); // block boundary
    }
  };
  for (const child of doc.getXmlFragment('default').toArray()) walk(child);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// Human-readable dump of a spreadsheet version for the preview modal.
export function extractSheetText(doc: Y.Doc): string {
  const cells = doc.getMap<string>('cells');
  const rows: string[] = [];
  cells.forEach((value, key) => {
    if (value !== '') rows.push(`${key}\t${value}`);
  });
  rows.sort();
  return rows.length ? rows.join('\n') : '(empty spreadsheet)';
}

// TEXT/NOTE restore. Render the scratch doc's rich content to ProseMirror JSON
// and replace the live editor's whole document in ONE transaction. The
// Collaboration plugin observes the replace and writes the diff back into the
// live Y.Doc, emitting a normal authored update.
export function restoreTextInto(editor: TiptapEditor, scratch: Y.Doc): void {
  const json = yXmlFragmentToProsemirrorJSON(scratch.getXmlFragment('default'));
  editor.commands.setContent(json as JSONContent, true);
}

// SHEET restore. Reconcile the live doc to equal the scratch (version) doc
// across EVERY sheet-related structure — the meta sheet list (order + names)
// AND each sheet's cells / style / geom maps — all inside ONE transaction on
// the live doc (one authored update). A version blob holds the FULL doc (all
// sheets), so restoring must reproduce it exactly: recreate deleted sheets,
// drop sheets added after the version, and revert cells/styles/geometry.
//
// We enumerate sheets and resolve their backing map names through SheetModel
// itself (reusing its cellsMap/styleMap/geomMap + the s0<->legacy aliasing)
// rather than hardcoding names here, so restore can't drift from the model.
export function restoreSheetInto(live: Y.Doc, scratch: Y.Doc): void {
  const liveModel = new SheetModel(live);
  const scratchModel = new SheetModel(scratch);
  const scratchIds = scratchModel.order();
  // Every sheet in EITHER doc: those only in scratch get recreated; those only
  // in live get their maps cleared (scratch's are empty) and dropped from order.
  const ids = new Set<string>([...scratchIds, ...liveModel.order()]);
  live.transact(() => {
    for (const id of ids) {
      syncMap(liveModel.cellsMap(id), scratchModel.cellsMap(id));
      syncMap(liveModel.styleMap(id), scratchModel.styleMap(id));
      syncMap(liveModel.geomMap(id), scratchModel.geomMap(id));
    }
    // Reconcile the tab list / order / names last (also fires the meta observer
    // so SheetEditor reseeds the engine over the recreated/removed sheets).
    liveModel.setList(scratchIds, scratchModel.nameEntries());
  });
}

// Make `live` hold exactly the keys/values of `scratch`: delete absent keys,
// set changed/new ones. Assumes it runs inside a transaction on live's doc.
export function syncMap<T>(live: Y.Map<T>, scratch: Y.Map<T>): void {
  for (const key of Array.from(live.keys())) {
    if (!scratch.has(key)) live.delete(key);
  }
  scratch.forEach((value, key) => {
    if (live.get(key) !== value) live.set(key, value);
  });
}
