import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { detection } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of one channel's interpretation row (Phase 6a): the shortest-note slider
 * and the Advanced disclosure (fit-to-melody/clip, whole-phrase/hmm, fix-octave-outliers/fold
 * + its tolerance slider, and the folded/muted stats). `notes.js` keeps the interpretation
 * state and the re-derivation itself (interpret()/applyEdits()); this component only reads it
 * through the same `detection` store Phase 5b's meta row already established — see
 * docs/react-phase-6a-interpretation-controls-plan.md for the ownership audit and the
 * decision to extend that store rather than add a second one. The edit list and list-export
 * row in the same legacy `<section id="notes-{stem}">` stay legacy-owned (a later Phase 6
 * sub-slice) — only this row moves. */
export function InterpretationPanel({ stem }) {
  useLocale();
  const view = useSyncExternalStore(detection.subscribe, detection.getSnapshot, detection.getSnapshot);
  const channel = view.channels[stem];

  return <div id={`notes-tune-${stem}`} className="notes-row" hidden={!channel.visible}>
    <label className="notes-ctl">
      <span>{t('notes.shortest')}</span>
      <input id={`notes-min-${stem}`} type="range" min="20" max="300" step="5"
        value={channel.minDurationMs}
        onChange={(e) => detection.commands.setMinDurationMs(stem, Number(e.target.value))} />
      <output id={`notes-min-out-${stem}`} className="notes-val">{channel.minDurationMs} ms</output>
    </label>
    <details className="notes-adv">
      <summary>{t('notes.advanced')}</summary>
      <label className="notes-ctl" title={t('notes.clipTip')}>
        <input id={`notes-clip-${stem}`} type="checkbox" checked={channel.clip}
          onChange={(e) => detection.commands.setClip(stem, e.target.checked)} />
        <span>{t('notes.clip')}</span>
      </label>
      <label className="notes-ctl" title={t('notes.hmmTip')}>
        <input id={`notes-hmm-${stem}`} type="checkbox" checked={channel.hmm}
          onChange={(e) => detection.commands.setHmm(stem, e.target.checked)} />
        <span>{t('notes.hmm')}</span>
      </label>
      <div className="notes-ctl">
        <label className="notes-ctl" title={t('notes.foldTip')}>
          <input id={`notes-fold-${stem}`} type="checkbox" checked={channel.fold}
            onChange={(e) => detection.commands.setFold(stem, e.target.checked)} />
          <span>{t('notes.fold')}</span>
        </label>
        <span id={`notes-fold-stats-${stem}`} className="notes-stats" hidden={!channel.fold}>
          <span className="n-fold">{t('notes.foldStatsFolded', { n: channel.foldedCount })}</span>
          {' · '}
          <span className="n-mute">{t('notes.foldStatsMuted', { n: channel.mutedCount })}</span>
        </span>
      </div>
      <label className="notes-ctl notes-sub" title={t('notes.foldTolTip')}>
        <span>{t('notes.foldTol')}</span>
        <input id={`notes-fold-tol-${stem}`} type="range" min="0.5" max="8" step="0.25"
          value={channel.foldTol} disabled={!channel.fold}
          onChange={(e) => detection.commands.setFoldTol(stem, Number(e.target.value))} />
        <output id={`notes-fold-tol-out-${stem}`}
          className={channel.foldTol >= 2.5 ? 'notes-val risky' : 'notes-val'}>
          {t('notes.foldTolVal', { n: channel.foldTol })}
        </output>
      </label>
    </details>
  </div>;
}
