# Resuming the note at A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note still sounding when playback enters — at loop point A, on every lap, or at a seek target — continues for the rest of its duration at the amplitude its envelope had already reached, and is cut at B instead of ringing across the loop restart.

**Architecture:** Every scheduled event gains two numbers: `skip` (seconds of the note already elapsed at the entry point) and `until` (the lap's B in audio-clock time). Collection filters change from *"starts after the entry point"* to *"is still sounding at the entry point"*. `spawn()` solves the envelope's exponential curve for the amplitude at `skip` and clamps the end to `until`. Ordinary notes get `skip = 0` and an `until` they never reach, so they take the identical path with no branch.

**Tech Stack:** Vanilla JS, no build step, no dependencies. Tests are the existing browser harness.

**Spec:** [`docs/superpowers/specs/2026-08-31-loop-note-resume-design.md`](../specs/2026-08-31-loop-note-resume-design.md)
**Background:** [`docs/behaviour.md`](../../behaviour.md) rows R1, N16, N36.

**Branch:** `feat/loop-note-resume` (already created off `main` after #17 merged; the spec is committed on it).

---

## The one thing to understand before starting

**`envLen` is not the note's length.** The envelope runs `dur * decay + release` from the note's
*start*, and for a piano note that is **longer** than the note itself:

```
dur = max(0.05, end - start)
envLen = dur * 0.85 + 0.04          # piano

an 80 ms note  ->  envLen = 0.068 + 0.04 = 108 ms
```

So today every note already rings ~28 ms past its written end, and that is correct, existing
behaviour. **`until` must never shorten an ordinary note.** If you find yourself clamping the
end to `note.end`, you have changed every note in the song rather than the ones touching B.

## File structure

| File | Responsibility |
|---|---|
| `lib/sonify.js` (modify) | All of it. `envelopeAmplitude()`, `skip`, `until`, the two collection loops, `spawn()`, `nextEvent()`. |
| `tests/sonify.test.js` (modify) | Fourteen new tests. |
| `docs/behaviour.md`, `docs/transcription.md`, `docs/devlog.md` (modify) | Rows, status, learnings. |
| `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`, `tests/notes.test.js` (modify) | `?v=` bump. Task 7 only. |

**No `?v=` bump before Task 7.** That is the release step. No new file is added, so the tally
stays **23** — `lib/sonify.js` is imported by `notes.js`, it is not a URL in `index.html`.

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read `window.__testResults`.
**Baseline before you start: 185 passing, 0 failing.**

Counts per task are expectations, not assertions. If a review round adds tests they drift;
trust what you measure and report a discrepancy rather than adjusting a test to match.

**Navigate afresh each time.** `scripts/serve.sh` sends `Cache-Control: no-store` precisely
because Chrome otherwise serves a stale ES module and the page silently checks the old code.

### The existing tests must not move

Before you change anything, know that **all eleven existing `sonify:` tests are expected to
keep passing untouched**, and that this was checked against the arithmetic rather than assumed:

| test | why it is unaffected |
|---|---|
| `a looped note sounds once per lap` | note 0.1–0.25 in loop [0, 0.5]; `envLen` = 0.1675, ends at 0.2675 — well short of B |
| `a note outside the loop never sounds` | note 0.1–0.3; ends at 0.31, short of B. The 1.2–1.4 note is still dropped by `n.start >= boundary` |
| `an empty loop region does not spin forever` | note 5–6 against loop [0, 0.5] is still dropped by `n.start >= boundary`, so `loopBase` stays empty |
| `a schedule whose t0 is in the past…` | `when = -3`, all `skip = 0`, every `at` still negative, still dropped by `pump()` |
| `offset skips notes that already finished` | note 0.0–0.4 against `offset = 2.0` is still dropped by `n.end <= entry` |

**If one of them breaks, stop and report it.** It means an ordinary note changed, which this
change is explicitly not allowed to do.

---

## Task 1: `envelopeAmplitude()` — the curve, as a pure function

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

No behaviour change in this task. It exports the maths so it can be pinned precisely, rather
than inferred from RMS later.

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/sonify.test.js`, and extend the import on line 2 to include
`envelopeAmplitude, ATTACK, FLOOR`:

```js
import { TIMBRES, midiToHz, timbreWave, scheduleNotes,
         envelopeAmplitude, ATTACK, FLOOR } from '../lib/sonify.js';
```

```js
test('sonify: envelopeAmplitude reproduces the two ramps it models', () => {
  /* The envelope is 1e-4 -> peak over [0, ATTACK], then peak -> 1e-4 over [ATTACK, envLen].
   * These are the three points the Web Audio ramps themselves pin, so if this function
   * disagrees at them it will disagree everywhere in between too. */
  const peak = 0.5;
  const envLen = 0.5;
  assertClose(envelopeAmplitude(0, envLen, peak), FLOOR, 1e-12, 'starts at the floor');
  assertClose(envelopeAmplitude(ATTACK, envLen, peak), peak, 1e-9, 'attack reaches the peak');
  assertClose(envelopeAmplitude(envLen, envLen, peak), FLOOR, 1e-9, 'decays to the floor');
});

test('sonify: envelopeAmplitude falls monotonically through the decay', () => {
  const peak = 0.5;
  const envLen = 0.4;
  let prev = Infinity;
  for (let tau = ATTACK; tau <= envLen; tau += 0.005) {
    const a = envelopeAmplitude(tau, envLen, peak);
    assert(a <= prev + 1e-12, `amplitude never rises during decay (at tau=${tau.toFixed(3)})`);
    prev = a;
  }
});

test('sonify: envelopeAmplitude is clamped at both ends', () => {
  /* A `skip` past the envelope's own length is reachable: a long note entered very late,
   * or a short note whose envLen is shorter than the remainder. Neither may produce a
   * negative amplitude or NaN — exponentialRampToValueAtTime rejects both. */
  const peak = 0.5;
  assert(envelopeAmplitude(-1, 0.4, peak) === FLOOR, 'a negative tau is the floor');
  assert(envelopeAmplitude(99, 0.4, peak) >= FLOOR, 'a tau past the end never goes below the floor');
  assert(Number.isFinite(envelopeAmplitude(99, 0.4, peak)), 'and never NaN');
  assert(Number.isFinite(envelopeAmplitude(0.1, 0, peak)), 'a zero-length envelope is survivable');
});
```

- [ ] **Step 2: Run them and watch them fail**

Navigate afresh to `http://localhost:8777/tests/test.html`.
Expected: three `FAIL`, on `envelopeAmplitude is not a function` (or the import throwing).
If `window.__testResults` is `undefined` the whole module failed to load — read the console.

- [ ] **Step 3: Write the implementation**

In `lib/sonify.js`, after the `TIMBRES` block (around line 29) and before `midiToHz`:

```js
/* The percussive envelope, as a function rather than only as a pair of scheduled ramps.
 *
 * spawn() schedules `1e-4 -> peak` over [0, ATTACK] then `peak -> 1e-4` over [ATTACK, envLen].
 * To ENTER that envelope partway along — a note already sounding when playback reaches it —
 * we need its value at an arbitrary point, so the same curve is written once here and the
 * ramps are driven from it.
 *
 * Web Audio's exponential ramp is v(t) = v0 * (v1/v0)^((t-t0)/(t1-t0)), which is what the
 * two Math.pow calls are. FLOOR exists because an exponential ramp cannot touch zero from
 * either side. */
export const ATTACK = 0.005;
export const FLOOR = 1e-4;

export function envelopeAmplitude(tau, envLen, peak) {
  if (tau <= 0) return FLOOR;
  if (tau < ATTACK) return FLOOR * Math.pow(peak / FLOOR, tau / ATTACK);
  const f = Math.min(1, (tau - ATTACK) / Math.max(1e-6, envLen - ATTACK));
  return Math.max(FLOOR, peak * Math.pow(FLOOR / peak, f));
}
```

- [ ] **Step 4: Run them and watch them pass**

Expected: three new `PASS` beginning `sonify: envelopeAmplitude`, suite at **188**, 0 failing.
The eleven existing `sonify:` tests must still pass — nothing they touch has changed yet.

- [ ] **Step 5: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: express the envelope as a function of elapsed time"
```

---

## Task 2: Resume at a seek point

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

The non-looping path. Its filter is already correct (`n.end <= offset`); what silences the
note is `at` landing in the past, where `pump()` drops it.

- [ ] **Step 1: Write the failing tests**

```js
test('sonify: seeking into the middle of a note plays the rest of it', async () => {
  /* The lane draws this note across the seek point, so silence reads as a detection
   * failure rather than a scheduling one. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Enter 0.25 s into a 0.5 s note: 0.25 s of it remains.
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0.25, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.01 * SR), Math.round(0.2 * SR)) > 0.001,
         'the remainder of the straddled note sounds');
});

test('sonify: a resumed note enters the envelope partway, it does not re-attack', async () => {
  /* THE assertion that distinguishes the two designs. "Re-attack with a shortened
   * envelope" passes every other test in this file; only the amplitude at the entry
   * point tells them apart. */
  const render = async (offset) => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const notes = [{ start: 0.0, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 0; i < Math.round(0.01 * SR); i++) peak = Math.max(peak, Math.abs(out[i]));
    return peak;
  };
  const fromStart = await render(0);
  const fromMiddle = await render(0.25);
  assert(fromMiddle > 0.0005, `the resumed note is audible (${fromMiddle.toFixed(5)})`);
  assert(fromMiddle < fromStart * 0.9,
         `and quieter than a fresh attack (${fromMiddle.toFixed(5)} vs ${fromStart.toFixed(5)})`);
});
```

- [ ] **Step 2: Run them and watch them fail**

Expected: `the remainder of the straddled note sounds` FAILS (the render is silent), and
`a resumed note enters the envelope partway` FAILS on `the resumed note is audible`.
Suite 190 total, 2 failing.

- [ ] **Step 3: Carry `skip` from collection to spawn**

In `lib/sonify.js`, replace the `lap0` collection loop:

```js
  const lap0 = [];
  for (const n of notes) {
    if (n.fix && n.fix.state === 'doubt') continue;   // untrusted: visible, but silent
    if (looping ? (n.start < offset || n.start >= loopB) : n.end <= offset) continue;
    lap0.push({ note: n, at: when + (n.start - offset) });
  }
```

with:

```js
  const lap0 = [];
  for (const n of notes) {
    if (n.fix && n.fix.state === 'doubt') continue;   // untrusted: visible, but silent
    if (looping ? (n.start < offset || n.start >= loopB) : n.end <= offset) continue;
    /* `at` is pinned to the entry point rather than the note's own start, so a note we
     * are entering partway is scheduled NOW and not in the past. That is what keeps
     * pump()'s past-drop intact: it still throws away genuinely elapsed notes. */
    lap0.push({
      note: n,
      at: when + Math.max(0, n.start - offset),
      skip: Math.max(0, offset - n.start),
    });
  }
```

- [ ] **Step 4: Teach `spawn()` to enter partway**

Replace the opening of `spawn` and its gain block:

```js
  function spawn(note, at) {
    const dur = Math.max(0.05, note.end - note.start);
    const end = at + dur * spec.decay + spec.release;
```

with:

```js
  function spawn(note, at, skip = 0) {
    const dur = Math.max(0.05, note.end - note.start);
    const envLen = dur * spec.decay + spec.release;
    const end = at + (envLen - skip);
    // An exponential ramp to a time at or before its start point misbehaves.
    if (end - at < 0.001) return;
```

and replace:

```js
    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
    g.gain.exponentialRampToValueAtTime(1e-4, end);
```

with:

```js
    /* Enter the envelope at `skip` seconds in. At skip = 0 this is exactly the original
     * three lines: envelopeAmplitude(0) is FLOOR and the attack ramp still runs in full.
     *
     * The attack is handled separately rather than folded into the decay because a note
     * caught 2 ms in would otherwise start near-silent and immediately fade — losing the
     * attack and sounding duller than its neighbours. */
    const g = ctx.createGain();
    g.gain.setValueAtTime(envelopeAmplitude(skip, envLen, gain), at);
    if (skip < ATTACK) g.gain.exponentialRampToValueAtTime(gain, at + (ATTACK - skip));
    g.gain.exponentialRampToValueAtTime(FLOOR, end);
```

Then update the single call site in `pump()`:

```js
      if (e.at >= ctx.currentTime) spawn(e.note, e.at);
```

becomes:

```js
      if (e.at >= ctx.currentTime) spawn(e.note, e.at, e.skip);
```

- [ ] **Step 5: Run them and watch them pass**

Expected: **190 passing, 0 failing.** All eleven original `sonify:` tests still green — check
that explicitly, especially `a schedule whose t0 is in the past does not dump elapsed notes at
once`, which is the one this task could plausibly break.

- [ ] **Step 6: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: seeking into a note plays the rest of it"
```

---

## Task 3: Resume at A on the first pass

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('sonify: a note straddling the loop start sounds on the first pass', async () => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  // The note runs 0.0-0.4; the loop starts at 0.2, so 0.2 s of it is inside the region.
  const notes = [{ start: 0.0, end: 0.4, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.6, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.01 * SR), Math.round(0.15 * SR)) > 0.001,
         'the part of the note inside the loop sounds');
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: 1 new FAIL — the looping branch of the lap-0 filter drops the note because
`n.start < offset`. Suite 191 total, 1 failing.

- [ ] **Step 3: Change the looping filter**

In the `lap0` loop, replace:

```js
    if (looping ? (n.start < offset || n.start >= loopB) : n.end <= offset) continue;
```

with:

```js
    /* "Still sounding at the entry point", not "starts after it". The two branches now
     * differ only in whether there is a right-hand bound at all. */
    if (n.end <= offset) continue;
    if (looping && n.start >= loopB) continue;
```

- [ ] **Step 4: Run it and watch it pass**

Expected: **191 passing, 0 failing.** `a note outside the loop never sounds` and `an empty
loop region does not spin forever` both depend on the `n.start >= loopB` half surviving —
confirm both are still green.

- [ ] **Step 5: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: resume the note straddling A on the first pass"
```

---

## Task 4: Resume on every lap

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('sonify: the note straddling A resumes on every lap, not just the first', async () => {
  /* Sounding once and then never again is the shape this bug takes if only lap 0 is
   * fixed — and it reads as "the loop stopped working" rather than as a missing note. */
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.0, end: 0.4, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Loop [0.2, 0.6): 0.4 s laps starting at context time 0, 0.4, 0.8, 1.2, 1.6.
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.6, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  for (const lapStart of [0, 0.4, 0.8, 1.2]) {
    const from = Math.round((lapStart + 0.01) * SR);
    const to = Math.round((lapStart + 0.15) * SR);
    assert(rms(out, from, to) > 0.001, `the note sounds on the lap starting at ${lapStart}s`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: 1 FAIL, on `the note sounds on the lap starting at 0.4s` — lap 0 works after Task 3,
later laps do not. Suite 192 total, 1 failing.

- [ ] **Step 3: Change the `loopBase` filter**

Replace the `loopBase` collection loop:

```js
  const loopBase = [];
  if (looping) {
    for (const n of notes) {
      if (n.fix && n.fix.state === 'doubt') continue;   // same rule on every lap
      if (n.start < loopA || n.start >= loopB) continue;
      loopBase.push({ note: n, at: when + (loopB - offset) + (n.start - loopA) });
    }
  }
```

with:

```js
  const loopBase = [];
  if (looping) {
    /* Lap 1 begins at the audio time lap 0's B falls on. Later laps are this plus
     * (lap - 1) * period, applied in nextEvent(). */
    const lapStart = when + (loopB - offset);
    for (const n of notes) {
      if (n.fix && n.fix.state === 'doubt') continue;   // same rule on every lap
      if (n.end <= loopA || n.start >= loopB) continue;
      loopBase.push({
        note: n,
        at: lapStart + Math.max(0, n.start - loopA),
        skip: Math.max(0, loopA - n.start),
      });
    }
  }
```

- [ ] **Step 4: Carry `skip` through the lap mapping**

In `nextEvent()`, replace:

```js
      events = loopBase.map((e) => ({ note: e.note, at: e.at + (lap - 1) * period }));
```

with:

```js
      events = loopBase.map((e) => ({
        note: e.note,
        at: e.at + (lap - 1) * period,
        skip: e.skip,
      }));
```

Dropping `skip` here is silent: every lap after the first would re-attack at full volume
while lap 0 resumed correctly, so the first pass would sound right and the rest would not.

- [ ] **Step 5: Run it and watch it pass**

Expected: **192 passing, 0 failing.** `a looped note sounds once per lap` is the regression
guard for this task — confirm it is still green.

- [ ] **Step 6: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: resume the straddling note on every lap"
```

---

## Task 5: Cut at B

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('sonify: a note is cut at B rather than ringing across the loop restart', async () => {
  /* The stems hard-cut at loopEnd, so a tone overhanging B desynchronises from the audio
   * it exists to be compared against.
   *
   * The loop deliberately holds NOTHING in its first 150 ms. Without that silence the
   * overhang would be indistinguishable from the next lap's own content, and the test
   * would pass against code that never truncates at all. */
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.45, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Loop [0, 0.5): the note starts 50 ms before B and its envelope would run ~85 ms past it.
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0, loopA: 0, loopB: 0.5, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);

  assert(rms(out, Math.round(0.46 * SR), Math.round(0.5 * SR)) > 0.001,
         'the note still sounds up to B');
  assert(rms(out, Math.round(0.52 * SR), Math.round(0.62 * SR)) < 1e-3,
         'and is silent after B, where the next lap has no notes of its own');
});

test('sonify: cutting at B does not shorten a note that ends mid-lap', async () => {
  /* envLen exceeds the note's own length by design — a 0.2 s note rings ~0.21 s. Clamping
   * the end to note.end instead of to B would change EVERY note in the song, which is the
   * likeliest way to get this task wrong and the hardest to notice by ear. */
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.1, end: 0.3, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0, loopA: 0, loopB: 1.5, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  // 0.30-0.31 s is past the note's written end but inside its envelope tail.
  assert(rms(out, Math.round(0.30 * SR), Math.round(0.31 * SR)) > 0.001,
         'the envelope tail past the note end survives');
});
```

- [ ] **Step 2: Run them and watch one fail**

Expected: `cut at B` FAILS on `and is silent after B` (the tone rings past). `does not
shorten a note that ends mid-lap` PASSES already — it is a guard against the fix, not a
driver for it. Suite 194 total, 1 failing.

- [ ] **Step 3: Carry `until` on every event**

In the `lap0` loop, add `until` to the pushed object:

```js
    lap0.push({
      note: n,
      at: when + Math.max(0, n.start - offset),
      skip: Math.max(0, offset - n.start),
      until: looping ? when + (loopB - offset) : Infinity,
    });
```

In the `loopBase` loop, add it there too — lap 1 runs `period` seconds from `lapStart`:

```js
      loopBase.push({
        note: n,
        at: lapStart + Math.max(0, n.start - loopA),
        skip: Math.max(0, loopA - n.start),
        until: lapStart + period,
      });
```

- [ ] **Step 4: Shift `until` with the lap**

In `nextEvent()`, replace the map body with:

```js
      events = loopBase.map((e) => ({
        note: e.note,
        at: e.at + (lap - 1) * period,
        skip: e.skip,
        until: e.until + (lap - 1) * period,
      }));
```

**`until` shifts per lap exactly as `at` does.** Leaving it un-shifted cuts every lap at lap
1's B, so everything after the first pass is silent — which looks like the loop breaking, not
like a truncation bug.

- [ ] **Step 5: Clamp the end in `spawn()`**

Change the signature and the `end` calculation:

```js
  function spawn(note, at, skip = 0) {
    const dur = Math.max(0.05, note.end - note.start);
    const envLen = dur * spec.decay + spec.release;
    const end = at + (envLen - skip);
```

to:

```js
  function spawn(note, at, skip = 0, until = Infinity) {
    const dur = Math.max(0.05, note.end - note.start);
    const envLen = dur * spec.decay + spec.release;
    /* `until` is the lap's B, never the note's own end. envLen routinely OUTLASTS the note
     * — an 80 ms note has a 108 ms envelope — and that tail is existing behaviour. Clamping
     * to note.end here would silently reshape every note in the song. */
    const end = Math.min(at + (envLen - skip), until);
    if (end - at < 0.001) return;
```

And the call site in `pump()`:

```js
      if (e.at >= ctx.currentTime) spawn(e.note, e.at, e.skip, e.until);
```

- [ ] **Step 6: Run them and watch them pass**

Expected: **194 passing, 0 failing.**

- [ ] **Step 7: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: cut a note at B instead of ringing across the restart"
```

---

## Task 6: The audibility floor, and the guards that must not regress

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('sonify: a remainder too short to be a pitch is dropped', async () => {
  /* Entering a note 5 ms before it ends gives a transient, not a note — and one
   * oscillator per lap for it. The floor is 10 ms. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 0.2, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0.195, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  const peak = Math.max(...Array.from(out, Math.abs));
  assert(peak < 1e-3, `a 5 ms remainder makes no sound (peak ${peak.toFixed(6)})`);
});

test('sonify: the audibility floor never drops a whole note', async () => {
  /* interpret() enforces minDurationMs >= 20, so no real note is shorter than the 10 ms
   * floor. This pins that relationship: if the floor is ever raised above the shortest
   * note the interpreter can emit, notes start vanishing from the playback entirely. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.1, end: 0.12, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.11 * SR), Math.round(0.16 * SR)) > 0.001,
         'the shortest note the interpreter can produce still sounds');
});

test('sonify: a note spanning the whole loop region resumes at A and is cut at B', async () => {
  /* Both boundaries at once: the note starts before A and ends after B, so it is entered
   * partway AND truncated. The lap should be one continuous tone with nothing after it. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 2.0, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Loop [0.1, 0.3): a 0.2 s window entirely inside a 2 s note.
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.1, loopA: 0.1, loopB: 0.3, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.01 * SR), Math.round(0.18 * SR)) > 0.001,
         'the lap sounds throughout');
});

test('sonify: a region with no note onsets but one sustained note still generates laps', async () => {
  /* This case used to leave loopBase EMPTY, which trips the guard that stops lap
   * generation — so the region was silent for ever. It now yields one event per lap.
   *
   * The guard itself must still work: this test would hang rather than fail if lap
   * generation ran away, so a timeout here is the signal, not an assertion failure. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 5.0, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.4, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  for (const lapStart of [0, 0.2, 0.4, 0.6]) {
    assert(rms(out, Math.round((lapStart + 0.01) * SR), Math.round((lapStart + 0.15) * SR)) > 0.001,
           `the sustained note sounds on the lap at ${lapStart}s`);
  }
});

test('sonify: a doubtful note straddling A is still silent', async () => {
  /* N36 on the new path. Folding marks a note it cannot justify; sounding it would
   * re-introduce the wrong-octave shriek folding exists to remove — and "it was already
   * playing when we got here" is not an exception to that. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 0.4, midi: 84, cents: 8400, name: 'C6', confidence: 0.9,
                   fix: { from: 84, state: 'doubt', doubt: true } }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.6, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  const peak = Math.max(...Array.from(out, Math.abs));
  assert(peak < 1e-3, `an untrusted note stays silent when straddled (peak ${peak.toFixed(6)})`);
});
```

- [ ] **Step 2: Run them and watch one fail**

Expected: `a remainder too short to be a pitch is dropped` FAILS (a 5 ms sliver currently
sounds). The other four PASS already — they are regression guards, and all should be green before
you touch anything. Suite 199 total, 1 failing.

**If `a doubtful note straddling A is still silent` fails, stop.** It means the `doubt` guard
was lost from one of the collection loops in Tasks 3–5, which is a correctness bug rather than
a missing feature.

- [ ] **Step 3: Add the floor**

Beside the other constants near the top of `lib/sonify.js` (after `MAX_LAPS`):

```js
/* Below this, a resumed remainder is a transient rather than a pitch — and it costs an
 * oscillator on every lap. No whole note is ever dropped by it: interpret() enforces
 * minDurationMs >= 20, so the shortest note that can reach here is twice this. */
const MIN_AUDIBLE = 0.01;
```

Add the check to the `lap0` loop, immediately after the two filter lines:

```js
    if (n.end <= offset) continue;
    if (looping && n.start >= loopB) continue;
    const boundary0 = looping ? loopB : Infinity;
    if (Math.min(n.end, boundary0) - Math.max(n.start, offset) < MIN_AUDIBLE) continue;
```

And to the `loopBase` loop, immediately after its filter line:

```js
      if (n.end <= loopA || n.start >= loopB) continue;
      if (Math.min(n.end, loopB) - Math.max(n.start, loopA) < MIN_AUDIBLE) continue;
```

- [ ] **Step 4: Run them and watch them pass**

Expected: **199 passing, 0 failing.**

- [ ] **Step 5: Verify in the real player, not just offline**

Everything so far is `OfflineAudioContext`. Confirm the feature works against the live graph.

Start the server, load a song, run detection, then in the console:

```js
const res = await fetch('/stems/' + encodeURIComponent('6 南國的風 (test).zip'));
const f = new File([await res.blob()], 'x.zip', { type: 'application/zip' });
const dt = new DataTransfer(); dt.items.add(f);
const inp = document.getElementById('file-input');
inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
await new Promise(r => setTimeout(r, 7000));
document.getElementById('notes-go').click();
await new Promise(r => setTimeout(r, 14000));
// Pick a note and set A one third of the way into it.
const n = ribbon.notes.find(x => x.end - x.start > 0.3);
JSON.stringify({ note: n.name, start: n.start, end: n.end, A: n.start + (n.end - n.start) / 3 });
```

Then set the A–B loop around it and confirm by ear that the tone sounds on each lap with the
notes lane unmuted. **`AudioContext` stays suspended until a real user gesture** — a synthetic
click on play will not unlock it; press `space` yourself. If the clock reads 0 while `playing`
is true, that is why.

Record what you heard in the commit message. "The tests pass" is not evidence the audio
resumed; this project's docs record property assertions passing against a silent panel.

- [ ] **Step 6: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: drop remainders too short to be a pitch"
```

---

## Task 7: Docs, version, and the PR

**Files:**
- Modify: `docs/behaviour.md`, `docs/transcription.md`, `docs/devlog.md`
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`, `tests/notes.test.js`

- [ ] **Step 1: Behaviour rows**

In `docs/behaviour.md`, under the **A–B repeat** table (after R1), continuing the R numbering
from whatever is currently last:

```markdown
| R2 | A note **still sounding at A** plays its remainder rather than being skipped, on every lap. | Set A one third into a held note: the tone sounds each lap. Offline, `tests/sonify.test.js` renders three laps and asserts RMS > 0 after each lap's A. |
| R3 | It **resumes** the envelope rather than re-attacking — quieter at A than the same note played from its start. | Render from `offset = 0` and from mid-note; the peak in the first 10 ms is strictly lower for the mid case. This is the only assertion separating "resume" from "re-attack, shortened". |
| R4 | A note is **cut at B**, not left ringing across the restart. | Loop with a note starting 50 ms before B and nothing in the next lap's first 150 ms: the window after B is silent. The stems hard-cut at `loopEnd`, so a tone overhanging B desynchronises from them. |
| R5 | **Seeking** into a note does the same thing as entering at A. | `offset` mid-note, no loop: the remainder sounds. One rule for every entry point. |
| R6 | A remainder under **10 ms** is dropped, and no whole note ever is. | Entering 5 ms before a note ends makes no sound. `interpret()` enforces `minDurationMs >= 20`, so the shortest real note is twice the floor — pinned by a test. |
| R7 | An untrusted note straddling A stays **silent**, as N36 requires. | A `fix.state === 'doubt'` note spanning A renders to silence. "It was already playing" is not an exception to the fold's judgement. |
```

- [ ] **Step 2: Transcription status**

In `docs/transcription.md`, the sonification row currently reads:

```
| sonification | built — `lib/sonify.js`, with lap generation for A–B repeat | the notes lane plays it, muted by default |
```

Change it to:

```
| sonification | built — `lib/sonify.js`, with lap generation for A–B repeat and mid-note entry | the notes lane plays it, muted by default; a note straddling A resumes, and is cut at B |
```

- [ ] **Step 3: Bump the asset version**

```bash
sed -i '' 's/?v=1\.14\.0/?v=1.15.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js tests/notes.test.js
grep -rn '1\.14\.0' index.html separate.js separate.worker.js notes.js notes.worker.js   # expect none
```

No file is added, so the tally stays **23** — `index.html` 15, `separate.js` 3,
`separate.worker.js` 1, `notes.js` 3, `notes.worker.js` 1. The comment in `index.html` and the
sentence in `CLAUDE.md` already say 23 and need no edit; change only `Currently v1.14.0.` to
`v1.15.0` in `CLAUDE.md`.

- [ ] **Step 4: Verify the whole suite**

Navigate afresh to `http://localhost:8777/tests/test.html`.
Expected: **199 passing, 0 failing**, with both `versions:` tests green.

Then load the app and confirm it boots (`typeof window.sansBass === 'object'`) with no console
errors — `app.js` is a classic script and a throw at the top level silently kills every
listener below it.

- [ ] **Step 5: Devlog**

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row and a `v1.15.0` entry in the house format, newest-first, with a matching
GitHub-style anchor. Learnings worth recording:

- `[insight]` The envelope **outlasts the note**: `envLen = dur * decay + release`, so an 80 ms
  piano note rings 108 ms. Any "clamp the note's end" change therefore has to clamp to the loop
  boundary, never to `note.end`, or it reshapes every note in the song while looking like a
  bug fix.
- `[insight]` One symptom, three causes. The looping filter dropped the note, `loopBase`
  dropped it again on later laps, and without a loop it survived collection only to be dropped
  by `pump()` for being in the past. Fixing any one of them alone would have left the bug
  looking half-fixed.
- `[gotcha]` `at` for a resumed note is pinned to the entry point with `Math.max(0, …)`
  specifically so `pump()`'s past-drop still works. Scheduling it at the note's true start
  would re-open the defect that once fired every elapsed note on one sample at 7× full scale.
- `[gotcha]` `until` has to be shifted per lap alongside `at`. Computing it once cuts every lap
  at lap 1's B — silence after the first pass, which reads as the loop breaking rather than as
  a truncation bug.
- `[note]` `MIN_AUDIBLE` is safe only because `interpret()` enforces `minDurationMs >= 20`.
  The two numbers are coupled and a test now says so.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A -- lib/ index.html separate.js separate.worker.js notes.js notes.worker.js CLAUDE.md docs/ tests/
git commit -m "Docs: v1.15.0 devlog, behaviour rows, asset version"
git push -u origin feat/loop-note-resume
gh pr create --title "Resume the note sounding at A, and cut at B (v1.15.0)" --body "$(cat <<'EOF'
## Summary

Set an A–B loop with A in the middle of a held note and that note never sounded — not on the
first pass, not on any lap. Seeking into a note was silent too. The lane drew the note
throughout, so it read as a detection failure rather than a scheduling one.

A note still sounding when playback enters now plays its remainder, at the amplitude its
envelope had already reached. It is cut at B rather than ringing across the restart.

## One symptom, three causes

| site | what it did |
|---|---|
| lap-0 filter | `n.start < offset` dropped any note that began before the entry point |
| `loopBase` filter | `n.start < loopA` dropped it again on every later lap |
| `pump()` | without a loop the note survived collection, but `at` landed in the past |

The third is not a bug — dropping past events fixed a real defect where every elapsed note
fired on one sample at 7× full scale. This change keeps it working by pinning a resumed note's
`at` to the entry point rather than to the note's own start.

## Why resume rather than re-attack

Re-attacking at A would be louder and simpler, but it puts an accent at A that the singer does
not have. The stems wrap mid-note; the tone exists to be compared against them, so it enters
the envelope where the stem is. `envelopeAmplitude()` solves the exponential ramp in closed
form, and at `skip = 0` reproduces the original envelope exactly.

## Why cut at B

`src.loop` hard-cuts the stems at `loopEnd`. A tone overhanging B both desynchronises from
them and, on a tight loop, collides with the same note re-sounding at A.

Note this clamps to the **loop boundary**, never to `note.end` — the envelope legitimately
outlasts the note (an 80 ms note rings 108 ms) and that tail is unchanged.

## Verifying

- `./scripts/serve.sh`, then `/tests/test.html` — 185 → **199**, all green.
- In the player: **Find notes**, unmute the lane, set A a third of the way into a held note,
  press `space`. The tone sounds on every lap and stops at B.

## Not in this PR

Cross-fading the cut at B rather than letting the exponential ramp finish early; making the
10 ms audibility floor configurable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01A6WFXJwx8FRRbAdSkXpJZK
EOF
)"
```

- [ ] **Step 7: Check the workflow's conclusion**

```bash
gh pr checks <N>
```

Check the **conclusion**, not that a run exists. Two workflows sharing a concurrency group let
GitHub cancel one as "pending"; the v1.2.0 merge deployed nothing and reported no failure
anywhere. Then confirm the preview at `/pr-<N>/` actually serves the new code — GitHub Pages
pins `max-age=600`, so add a cache-busting query when you check, or you will read a stale copy
and think the deploy failed.

---

## Deferred

Cross-fading at B; a configurable audibility floor; applying the same rule to the stems
(they already wrap correctly, so there is nothing to fix).
