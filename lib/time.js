/* The one place a seconds value gets rounded to millisecond precision — every note's
 * start/end (lib/pitch.js, lib/ribbon.js) and every edit-event time field (app.js's
 * dispatchEdit/tempoRange) goes through this, so drag/arithmetic-derived floating-point
 * noise (207.45864999999998) never reaches note storage, the edit list, or the exported
 * edits JSON. */
export function roundSeconds(v) {
  return Math.round(v * 1000) / 1000;
}

/** Whole-second transport time, preserving the player's established m:ss presentation. */
export function formatClockTime(value) {
  let seconds = value;
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/** Hundredth-second time used by the overview and zoom readouts. */
export function formatClockTimeCentiseconds(value) {
  let seconds = value;
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalCentiseconds = Math.round(seconds * 100);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const remainder = ((totalCentiseconds % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${minutes}:${remainder}`;
}
