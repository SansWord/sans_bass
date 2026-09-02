# The note that is already sounding — resuming at A, cutting at B

**Status:** design, approved 2026-08-31
**Phase:** C4. Follows 簡譜 (v1.14.0, merged as #17).
**Scope:** `lib/sonify.js` only. No UI, no strings, no note data.

## Motivation

Set an A–B loop with A in the middle of a held note and the synthesised tone for that note
never sounds — not on the first pass, not on any lap. The stems do not behave this way: a
`BufferSource` with `loop = true` simply wraps, so the singer is heard mid-note while the tone
that is supposed to be compared against them is missing.

The same silence appears without a loop. Seeking into the middle of a note is silent too, by a
different mechanism, so this is one symptom with two causes.

The lane draws the note throughout. Only the sound is absent, which makes it read as a
detection failure rather than a scheduling one.

### The three causes

| # | site | what it does |
|---|---|---|
| 1 | `lib/sonify.js:85` (lap 0, looping) | `n.start < offset` drops any note that began before the entry point |
| 2 | `lib/sonify.js:92` (`loopBase`) | `n.start < loopA` drops it again on every subsequent lap |
| 3 | `lib/sonify.js:155` (`pump`) | without a loop the note survives collection, but `at` lands in the past and the event is dropped |

Cause 3 is not a bug in that line. Dropping past events fixed a real defect — every elapsed
note firing on the same sample, measured at 7× full scale — and the comment there says so. The
fix must not disturb it.

## Goals

1. A note still sounding at the point playback enters continues, for the remainder of its
   duration, at the amplitude its envelope had already reached.
2. The same rule at every entry point: loop point A, every lap, and a plain seek.
3. A note is cut at B rather than ringing across the loop restart.

## Non-goals

- Changing detection, interpretation, or any note data. This is scheduling only.
- Any UI, control, or string. Nothing here is user-configurable.
- Changing how ordinary notes sound. A note wholly inside the lap must render identically to
  today, including the envelope tail that outlasts its written end.

## Success criteria

- With A 30 ms into an 80 ms note, the remaining 50 ms sounds.
- It sounds on every lap, not only the first.
- Its amplitude at A is **lower** than the same note's peak when played from its start —
  it resumes the envelope rather than re-attacking.
- A note starting before B is silent after B.
- Seeking into a note sounds, on the same rule.
- Every existing `tests/sonify.test.js` assertion about notes that do not touch a boundary
  still passes unchanged.

## Design

### Two numbers describe every lap

Laps differ only in where they begin and where they end:

| lap | entry | boundary |
|---|---|---|
| 0, not looping | `offset` | `Infinity` |
| 0, looping | `offset` | `loopB` |
| *k* ≥ 1 | `loopA` | `loopB` |

Given those, one collection rule serves all three:

```js
// audible in this lap if still sounding at `entry` and started before `boundary`
if (n.end <= entry || n.start >= boundary) continue;

const audible = Math.min(n.end, boundary) - Math.max(n.start, entry);
if (audible < MIN_AUDIBLE) continue;          // 10 ms; a sliver is a click, not a pitch

events.push({
  note: n,
  at:    lapStart + Math.max(0, n.start - entry),
  skip:  Math.max(0, entry - n.start),        // seconds of the note already elapsed
  until: boundary === Infinity ? Infinity : lapStart + (boundary - entry),
});
```

Three properties this has, each load-bearing:

**The ordinary case falls out unchanged.** A note wholly inside the lap gets `skip = 0` and an
`until` it never reaches, so it takes the identical path. No branch, nothing to keep in sync.

**Only one filter actually changes.** The non-looping filter is already `n.end <= offset` and
was always right; cause 3 was what silenced it. The looping filter changes from
`n.start < offset` to `n.end <= offset`.

**`at` is never in the past for a resumed note.** `Math.max(0, n.start - entry)` pins it to the
lap start, so `pump()`'s past-drop keeps working untouched and the 7× defect stays guarded.

### Resuming the envelope

The envelope in note-relative time τ is two exponential ramps: `1e-4 → gain` over
`[0, ATTACK]`, then `gain → 1e-4` over `[ATTACK, envLen]`, where
`envLen = dur * spec.decay + spec.release`.

Web Audio's exponential ramp is `v(t) = v₀·(v₁/v₀)^((t−t₀)/(t₁−t₀))`, so the amplitude at any
τ is solvable in closed form:

```js
const ATTACK = 0.005, FLOOR = 1e-4;

function ampAt(tau) {
  if (tau <= 0)     return FLOOR;
  if (tau < ATTACK) return FLOOR * Math.pow(gain / FLOOR, tau / ATTACK);
  const f = Math.min(1, (tau - ATTACK) / Math.max(1e-6, envLen - ATTACK));
  return Math.max(FLOOR, gain * Math.pow(FLOOR / gain, f));
}

g.gain.setValueAtTime(ampAt(skip), at);
if (skip < ATTACK) g.gain.exponentialRampToValueAtTime(gain, at + (ATTACK - skip));
g.gain.exponentialRampToValueAtTime(FLOOR, end);
```

At `skip = 0` this reproduces today's envelope exactly: `ampAt(0)` is `FLOOR`, the attack ramp
survives, the decay ramp is unchanged.

**Why the attack phase is handled separately.** Catch a note 2 ms in, treat it as mid-decay,
and it starts near-silent and immediately fades — the attack is lost and the note sounds duller
than its neighbours. Rare, and two lines to do properly.

**The alternative that was rejected.** Re-attacking at A with a shortened envelope would be
louder and easier, but it puts an accent at A that the singer does not have, and the point of
the synth is to sit against the stem. Resuming matches what the stem does when it wraps.

### Where the note ends

```js
const end = Math.min(at + (envLen - skip), until);
```

`envLen` routinely **exceeds** the note's own length — an 80 ms piano note has a 108 ms
envelope — so today every note rings past its written end. That is kept. `until` is the lap's
B in audio time, so **B is the only new cut**; a note ending naturally mid-lap is untouched.

Cutting at B is the same principle as resuming at A: the stems hard-cut at `loopEnd`, and a
tone overhanging into the restart both desynchronises from them and can collide with the same
note re-sounding at A on a tight loop.

**`until` shifts per lap** and must be mapped alongside `at` in `nextEvent()`'s
`loopBase.map(...)`. Computing it once would cut every lap at lap 1's B — silence after the
first pass, which looks exactly like the feature not working.

Two guards: do not spawn if `end - at` is under a millisecond, since an exponential ramp to a
time at or before its start point misbehaves; and clamp `f` to 1 so a `skip` past `envLen`
cannot produce a negative amplitude.

### Approaches considered

**Schedule the note at its real (past) time and let the AudioParam timeline clip it.** Elegant
for lap 0 — the automation curve evaluates to the correct mid-decay amplitude with no
arithmetic. It breaks on laps: a note starting before A has no position inside lap *k*, so its
natural time falls before the lap boundary and the tone would ring during the previous lap's
tail. It also re-opens the `:155` scar. Half the cases, two mechanisms.

**A third collection pass emitting synthetic resume events.** The file has two collection loops
and `docs/behaviour.md` N36 already warns that only one runs without a loop. A third deepens
that trap for no gain.

## Edge cases

| case | behaviour |
|---|---|
| Note spans the whole region (`start < A`, `end > B`) | Resumes at A, cut at B — one continuous decaying tone across the lap |
| Note ends before A | Filtered by `n.end <= entry`, as today |
| `fix.state === 'doubt'` straddling A | Still silent, on every lap. N36 must not regress |
| Remainder under `MIN_AUDIBLE` (10 ms) | Dropped |
| `entry` exactly on `n.start` | `skip = 0`; the ordinary path |
| Offline render (`aheadSeconds = Infinity`) | `until = Infinity` when not looping; `renderEnd` still bounds lap generation |

One quiet consequence: a loop region with **no note onsets** but covered by one long sustained
note used to leave `loopBase` empty, tripping the `!loopBase.length` guard that stops lap
generation. It now yields one event per lap. That is the fix working, and it makes the guard
fire less often rather than more.

## Testing

`tests/sonify.test.js` already renders offline and measures RMS; all of these fit that harness.

1. **Seek into a note sounds.** Note at 0–0.5 s, `offset = 0.25`. RMS > 0. Silent today.
2. **The resume is mid-envelope, not a fresh attack.** Same note rendered from `offset = 0` and
   from mid-note; peak in the first 10 ms after entry must be **strictly lower** for the mid
   case. Without this assertion, "re-attack, shortened" passes every other test in this list.
3. **It resumes on every lap.** Three laps; RMS > 0 in the window after each lap's A. Catches
   both the `loopBase` filter and the `until`-not-shifted trap.
4. **B truncates.** A note starting just before B with a long tail, and no notes in the first
   100 ms after A. The window after B must be silent. The deliberate silence at the lap start
   is what makes the overhang observable — with the next lap's content there, it would not be.
5. **Ordinary notes are untouched.** A note wholly inside a lap still rings past its own end
   for its envelope tail, and every existing assertion in the file passes unchanged.
6. **Doubtful notes stay silent** when straddling A.

Existing assertions about audio *after* B are expected to need updating — that is the
truncation landing, not a regression. Each one is to be flagged rather than quietly edited.

## Documentation and versioning

- `docs/behaviour.md` — new rows under **A–B repeat** for resume-at-A, resume-on-every-lap,
  cut-at-B, the seek case, and the 10 ms floor.
- `docs/transcription.md` — the sonification row gains a clause.
- `docs/devlog.md` — `v1.15.0` entry, newest-first, TL;DR row with a matching anchor.
- `?v=` bump `1.14.0 → 1.15.0` across `index.html`, `separate.js`, `separate.worker.js`,
  `notes.js`, `notes.worker.js` and `tests/notes.test.js`. The tally stays **23**:
  `lib/sonify.js` is imported by `notes.js`, not a new URL in `index.html`.

## Deferred

Cross-fading the cut at B rather than letting the exponential ramp finish early; making
`MIN_AUDIBLE` configurable; applying the same resume rule to the stems themselves (they already
wrap correctly, so there is nothing to fix).
