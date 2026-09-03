/* The one place a seconds value gets rounded to millisecond precision — every note's
 * start/end (lib/pitch.js, lib/ribbon.js) and every edit-event time field (app.js's
 * dispatchEdit/tempoRange) goes through this, so drag/arithmetic-derived floating-point
 * noise (207.45864999999998) never reaches note storage, the edit list, or the exported
 * edits JSON. */
export function roundSeconds(v) {
  return Math.round(v * 1000) / 1000;
}
