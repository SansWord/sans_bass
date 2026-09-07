import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { PHASE_NUDGE_MS, tempoGrid } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of the shared `#notes-tempo` panel (Phase 6b): Show-grid checkbox, BPM
 * field, ×½/×2, phase field + nudge buttons, beats-per-bar select, "Select BPM range" toggle,
 * Re-detect button, and status line. `notes.js` keeps the tempo state itself, both channels'
 * live re-derivation, and the Re-detect Worker lifecycle; this component only reads it through
 * `tempoGrid`'s subscribe/getSnapshot/commands — a store of its own rather than an extension of
 * `detection`, since tempo is module-level/shared state with no per-channel shape — see
 * docs/react-phase-6b-tempo-chord-controls-plan.md for the ownership audit and the decision to
 * leave the capo control and the zoomed pane's chord display/editing legacy-owned this slice. */
export function TempoPanel() {
  useLocale();
  const view = useSyncExternalStore(tempoGrid.subscribe, tempoGrid.getSnapshot, tempoGrid.getSnapshot);
  const disabled = !view.hasDrums;

  return <section id="notes-tempo" className="notes" hidden={!view.visible}>
    <div className="notes-row">
      <label className="notes-ctl">
        <input id="notes-tempo-on" type="checkbox" checked={view.on}
          onChange={(e) => tempoGrid.commands.setOn(e.target.checked)} />
        <span>{t('notes.tempoOn')}</span>
      </label>
      <label className="notes-ctl">
        <span>{t('notes.tempoBpm')}</span>
        <input id="notes-tempo-bpm" type="number" min="20" max="400" step="0.1"
          value={view.bpmValue} disabled={disabled}
          onChange={(e) => tempoGrid.commands.setBpm(Number(e.target.value))} />
      </label>
      <span className="notes-ctl">
        <button id="notes-tempo-half" className="mini" type="button" disabled={disabled}
          title={t('notes.tempoHalfTip')} onClick={tempoGrid.commands.halveBpm}>&times;&#189;</button>
        <button id="notes-tempo-double" className="mini" type="button" disabled={disabled}
          title={t('notes.tempoDoubleTip')} onClick={tempoGrid.commands.doubleBpm}>&times;2</button>
      </span>
      <label className="notes-ctl">
        <span>{t('notes.tempoPhase')}</span>
        <button id="notes-tempo-phase-back" className="mini" type="button" disabled={disabled}
          title={t('notes.tempoPhaseBackTip')}
          onClick={() => tempoGrid.commands.nudgePhase(-PHASE_NUDGE_MS)}>&#9664;</button>
        <input id="notes-tempo-phase" type="number" step="1" value={view.phaseMs} disabled={disabled}
          onChange={(e) => tempoGrid.commands.setPhase(Number(e.target.value))} />
        <button id="notes-tempo-phase-fwd" className="mini" type="button" disabled={disabled}
          title={t('notes.tempoPhaseFwdTip')}
          onClick={() => tempoGrid.commands.nudgePhase(PHASE_NUDGE_MS)}>&#9654;</button>
      </label>
      <label className="notes-ctl">
        <span>{t('notes.tempoBeats')}</span>
        <select id="notes-tempo-beats" disabled={disabled} value={String(view.beatsPerBar)}
          onChange={(e) => tempoGrid.commands.setBeatsPerBar(Number(e.target.value))}>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="6">6</option>
        </select>
      </label>
      <button id="notes-tempo-range" type="button" disabled={disabled}
        className={view.rangeArmed ? 'mini note-tbtn-armed' : 'mini'}
        title={t('notes.tempoRangeTip')} onClick={tempoGrid.commands.toggleRangeArmed}>
        {t('notes.tempoRange')}
      </button>
      <button id="notes-tempo-redetect" className="mini" type="button"
        disabled={disabled || view.redetecting} onClick={tempoGrid.commands.redetect}>
        {t('notes.tempoRedetect')}
      </button>
      <span id="notes-tempo-status" className="notes-stats">
        {view.confidence > 0
          ? t('notes.tempoStatus', { bpm: view.bpmValue.toFixed(1), pct: Math.round(view.confidence * 100) })
          : t('notes.tempoStatusNone')}
      </span>
    </div>
  </section>;
}
