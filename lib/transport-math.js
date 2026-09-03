/* Pure playback-speed math, factored out of app.js so it is unit-testable. */
const RATE_MIN = 10;
const RATE_MAX = 150;
const RATE_STEP = 5;       // coarse step: the slider (native HTML step) and plain [ / ]
const RATE_FINE_STEP = 1;  // fine step: Shift+[ / Shift+], for landing between multiples of 5
const RATE_DEFAULT = 100;

/** Clamp to [RATE_MIN, RATE_MAX], rounded to a whole percent. Deliberately does NOT snap
 *  to RATE_STEP — Shift+[ / Shift+] relies on this to land on values like 97 or 101 that
 *  a coarse round-to-5 would erase. The slider's own multiples-of-5 come from its native
 *  HTML `step` attribute at drag time, not from this function re-snapping afterward. */
function clampRatePercent(n) {
  return Math.max(RATE_MIN, Math.min(RATE_MAX, Math.round(n)));
}

/** ratePercent nudged by deltaPercent (±RATE_STEP for [ / ], ±RATE_FINE_STEP for the
 *  Shift-held fine variant), clamped to range. */
function nudgeRatePercent(ratePercent, deltaPercent) {
  return clampRatePercent(ratePercent + deltaPercent);
}

/** Mirrors app.js's currentTime(), with the rate applied to elapsed real time. At
 *  ratePercent === 100 this is exactly the pre-existing (unscaled) formula — no branch
 *  needed, the same way the design spec describes it. */
function currentTimeAtRate({ offset, elapsed, ratePercent, loopA, loopB, duration }) {
  const scaled = elapsed * (ratePercent / 100);
  if (loopA !== null && loopB !== null) {
    const span = loopB - loopA;
    return loopA + ((offset - loopA + scaled) % span);
  }
  return Math.min(duration, offset + scaled);
}

export { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };

window.SansTransportMath = { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };
