import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { detection } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of one channel's edit list (Phase 6c): the summary count, Undo button,
 * and the `<ol>` of edit-group rows (orphan warning, label, time label, remove button).
 * `notes.js` keeps the edit-group state itself and the re-derivation it feeds
 * (reinterpret()/applyEdits()); this component only reads it through the same `detection`
 * store Phase 5b/6a's own rows already established — see
 * docs/react-phase-6c-editor-export-controls-plan.md for the ownership audit and the decision
 * to extend that store rather than add a second one. The Edit-notes toggle and the shared
 * Export/Import edits JSON buttons in app.js's zoomed pane stay legacy-owned this slice (see
 * that plan's scope decision) — only the edit list and list-export row move. */
export function EditListPanel({ stem }) {
  useLocale();
  const view = useSyncExternalStore(detection.subscribe, detection.getSnapshot, detection.getSnapshot);
  const channel = view.channels[stem];
  const groups = channel.editGroups;
  const detailsRef = useRef(null);

  // The one behavior beyond native <details> semantics the legacy markup added: clicking
  // anywhere outside the open disclosure closes it.
  useEffect(() => {
    const onPointerDown = (e) => {
      const el = detailsRef.current;
      if (el && el.open && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return <details id={`notes-edits-${stem}`} className="notes-edit-list" ref={detailsRef}
    hidden={groups.length === 0}>
    <summary id={`notes-edits-summary-${stem}`}>{t('notes.editsSummary', { n: groups.length })}</summary>
    <div className="notes-row notes-edit-panel">
      <button id={`notes-edit-undo-${stem}`} className="mini" type="button" disabled={groups.length === 0}
        title={t('notes.editUndoTip')} onClick={() => detection.commands.undoEdit(stem)}>&#8630;</button>
      <ol id={`notes-edit-rows-${stem}`} className="edit-rows">
        {groups.map((g) => <li key={g.id} className="edit-row">
          {g.orphaned && <span className="edit-warn" title={t('notes.editOrphanTip')}>&#9888;</span>}
          <span>{t(g.labelKey)} &middot; {g.timeLabel}</span>
          <button className="mini edit-remove" type="button" title={t('notes.editRemoveTip')}
            onClick={() => detection.commands.removeEditGroup(stem, g.id)}>&#10005;</button>
        </li>)}
      </ol>
    </div>
  </details>;
}

/** React ownership of one channel's list-export row (Phase 6c): the "Bars per line" number
 * input and the "Export list" (簡譜 HTML) button. Bars-per-line is component-local state —
 * a user preference the legacy DOM element never reset either, the same "user preference, not
 * song state" reasoning Phase 6a's `interp` state already established. */
export function ListExportPanel({ stem }) {
  useLocale();
  const view = useSyncExternalStore(detection.subscribe, detection.getSnapshot, detection.getSnapshot);
  const channel = view.channels[stem];
  const [barsPerLine, setBarsPerLine] = useState('4');

  return <div id={`notes-list-io-${stem}`} className="notes-row">
    <label className="notes-ctl">
      <span>{t('notes.listBars')}</span>
      <input id={`notes-list-bars-${stem}`} type="number" min="1" max="16" step="1"
        value={barsPerLine} onChange={(e) => setBarsPerLine(e.target.value)} />
    </label>
    <button id={`notes-list-export-${stem}`} className="mini" type="button" disabled={!channel.count}
      onClick={() => detection.commands.exportList(stem, barsPerLine)}>{t('notes.exportList')}</button>
  </div>;
}
