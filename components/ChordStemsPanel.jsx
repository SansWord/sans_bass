import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { chordStems } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of the new `#notes-chord-stems` row: two checkboxes letting the user opt
 *  vocals/other into the harmonic mix chord detection runs against, on top of the fixed
 *  guitar/piano/bass baseline. Mirrors components/TempoPanel.jsx's shape exactly, reading
 *  notes.js's `chordStems` store instead of `tempoGrid` — see
 *  docs/superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md. */
export function ChordStemsPanel() {
  useLocale();
  const view = useSyncExternalStore(chordStems.subscribe, chordStems.getSnapshot, chordStems.getSnapshot);

  return <section id="notes-chord-stems" className="notes" hidden={!view.visible}>
    <div className="notes-row">
      <span>{t('notes.chordStemsLabel')}</span>
      <label className="notes-ctl">
        <input type="checkbox" checked={view.vocals}
          onChange={(e) => chordStems.commands.setVocals(e.target.checked)} />
        <span>{t('stem.vocals')}</span>
      </label>
      <label className="notes-ctl">
        <input type="checkbox" checked={view.other}
          onChange={(e) => chordStems.commands.setOther(e.target.checked)} />
        <span>{t('stem.other')}</span>
      </label>
    </div>
  </section>;
}
