export const MIN_LOOP_SECONDS = 0.1;

export function clearLoop() {
  return { a: null, b: null, rejected: false };
}

export function setLoopPoint(state, which, time, minimum = MIN_LOOP_SECONDS) {
  let a = state.a;
  let b = state.b;
  if (which === 'a') a = time;
  else b = time;
  if (a !== null && b !== null && a > b) [a, b] = [b, a];
  if (a !== null && b !== null && b - a < minimum) {
    if (which === 'a') a = null;
    else b = null;
    return { a, b, rejected: true };
  }
  return { a, b, rejected: false };
}

export function isLoopActive({ a, b }, minimum = MIN_LOOP_SECONDS) {
  return a !== null && b !== null && b - a >= minimum;
}

export function loopPlan(durations, state, minimum = MIN_LOOP_SECONDS) {
  const active = isLoopActive(state, minimum);
  return durations.map((duration) => active && duration >= state.b
    ? { loop: true, loopStart: state.a, loopEnd: state.b }
    : { loop: false, loopStart: null, loopEnd: null });
}
