import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { resolveStatusParams } from '../lib/separation-state.js';
import { separation } from '../separate.js';
import { useLocale } from './useLocale.js';

/** React ownership of the #sep panel (Phase 5a): availability/gating, start/progress/cancel/
 * error/save presentation. `separate.js` keeps the Worker lifecycle, model/session, and the
 * state machine this component only reads through `separation`'s subscribe/getSnapshot/
 * commands — see docs/react-phase-5a-separation-panel-plan.md for the ownership audit.
 * Element ids match the legacy markup exactly so styles.css (class-selector only) and the
 * existing Chromium regression assertions keep working unmodified. */
export function SeparationPanel() {
  useLocale();
  const view = useSyncExternalStore(separation.subscribe, separation.getSnapshot, separation.getSnapshot);
  const statusText = view.status ? t(view.status.key, resolveStatusParams(view.status.params)) : '';

  return <section id="sep" className="sep" hidden={!view.panel}>
    <p id="sep-handheld" className="dim" hidden={!view.handheld}>{t('sep.handheld')}</p>
    <div className="sep-row">
      <button type="button" id="sep-go" className="btn" hidden={!view.go} disabled={view.goDisabled}
        onClick={separation.commands.start}>{t('sep.go')}</button>
      <span id="sep-status" className="dim">{statusText}</span>
    </div>
    <div id="sep-bar" className="sep-bar" hidden={view.progress === null}>
      <div id="sep-fill" style={{ width: `${Math.round((view.progress ?? 0) * 100)}%` }} />
    </div>
    <div className="sep-row">
      <button type="button" id="sep-save" className="btn ghost" hidden={!view.save} disabled={view.saveDisabled}
        onClick={separation.commands.save}>{t('sep.save')}</button>
      <button type="button" id="sep-cancel" className="btn ghost" hidden={!view.cancel}
        onClick={separation.commands.cancel}>{t('sep.cancel')}</button>
    </div>
  </section>;
}
