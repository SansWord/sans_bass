/* Pure playback-speed math, factored out of app.js so it is unit-testable — app.js is a
 * classic script with no test harness of its own, the same reason lib/ribbon.js and
 * lib/jianpu.js exist. Loaded as a classic script, exactly like those two. */
window.SansTransportMath = (function () {
  const RATE_MIN = 50;
  const RATE_MAX = 150;
  const RATE_STEP = 5;
  const RATE_DEFAULT = 100;

  /** Clamp to [RATE_MIN, RATE_MAX] and snap to the nearest RATE_STEP. */
  function clampRatePercent(n) {
    const snapped = Math.round(n / RATE_STEP) * RATE_STEP;
    return Math.max(RATE_MIN, Math.min(RATE_MAX, snapped));
  }

  /** ratePercent nudged by deltaPercent (e.g. ±5 for [ / ]), clamped and snapped. */
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

  return { RATE_MIN, RATE_MAX, RATE_STEP, RATE_DEFAULT,
           clampRatePercent, nudgeRatePercent, currentTimeAtRate };
})();
