import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { PITCH_CLASS_NAMES } from '../lib/pitch.js';
import { detection } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of the shared #notes-detect button/spinner/status (Phase 5b): `notes.js`
 * keeps the per-channel state machine and the Worker lifecycle, this component only reads it
 * through `detection`'s subscribe/getSnapshot/commands — see
 * docs/react-phase-5b-detection-controls-plan.md for the ownership audit. */
export function DetectionControls() {
  useLocale();
  const view = useSyncExternalStore(detection.subscribe, detection.getSnapshot, detection.getSnapshot);
  const busyStems = view.detect.busyStems;
  const status = busyStems.length
    ? t('notes.detecting', { stems: busyStems.map((stem) => t('stem.' + stem)).join(', ') })
    : '';

  return <section id="notes-detect" className="notes" hidden={!view.detect.sectionVisible}>
    <div className="notes-row">
      <button type="button" id="notes-go-all" className="btn" disabled={view.detect.buttonDisabled}
        onClick={detection.commands.findNotes}>{t('notes.find')}</button>
      <span id="notes-detect-spinner" className="notes-spinner" hidden={!view.detect.spinnerVisible} />
      <span id="notes-detect-status" className="notes-count">{status}</span>
    </div>
  </section>;
}

/** React ownership of one channel's meta row (Phase 5b): count, Show/Hide, 簡譜, and the key
 * tonic/mode/relative-key span. The tune/edit-list/list-export rows in the same legacy
 * `<section id="notes-{stem}">` stay legacy-owned (Phase 6) — only this row moves. */
export function NotesChannelPanel({ stem }) {
  useLocale();
  const view = useSyncExternalStore(detection.subscribe, detection.getSnapshot, detection.getSnapshot);
  const channel = view.channels[stem];
  const keyDisabled = !channel.jianpuOn;

  return <div id={`notes-meta-${stem}`} className="notes-row" hidden={!channel.visible}>
    <span id={`notes-count-${stem}`} className="notes-count">{t('notes.count', { n: channel.count })}</span>
    <button type="button" id={`notes-show-${stem}`} className="btn ghost"
      onClick={() => detection.commands.toggleShow(stem)}>
      {t(channel.showOn ? 'notes.hide' : 'notes.show')}
    </button>
    <label className="notes-ctl" title={t('notes.jianpuTip')}>
      <input id={`notes-jianpu-${stem}`} type="checkbox" checked={channel.jianpuOn}
        onChange={(e) => detection.commands.setJianpuOn(stem, e.target.checked)} />
      <span>{t('notes.jianpu')}</span>
    </label>
    <span className="notes-ctl notes-key">
      <span>{t('notes.keyIs')}</span>
      <select id={`notes-key-tonic-${stem}`} disabled={keyDisabled} value={channel.tonic}
        onChange={(e) => detection.commands.setKey(stem, Number(e.target.value), channel.mode)}>
        {PITCH_CLASS_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
      </select>
      <select id={`notes-key-mode-${stem}`} disabled={keyDisabled} value={channel.mode}
        onChange={(e) => detection.commands.setKey(stem, channel.tonic, e.target.value)}>
        <option value="major">{t('notes.major')}</option>
        <option value="minor">{t('notes.minor')}</option>
      </select>
      <button type="button" id={`notes-key-rel-${stem}`} className="mini" disabled={keyDisabled}
        title={t('notes.relativeTip')} onClick={() => detection.commands.useRelativeKey(stem)}>⇄</button>
    </span>
  </div>;
}
