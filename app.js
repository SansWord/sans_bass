/* sans_bass — multitrack stem player
 * All decoding happens locally via Web Audio. Stems stay perfectly in sync
 * because every track is started from one AudioContext clock at the same time.
 */

import { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } from './lib/stems.js';
import { extract } from './lib/unzip.js';
import { parseNoteName } from './lib/pitch.js';
import { formatClockTime, formatClockTimeCentiseconds, roundSeconds } from './lib/time.js';
import * as SansI18n from './lib/i18n.js';
import * as SansAnalytics from './lib/analytics.js';
import * as SansRibbon from './lib/ribbon.js';
import * as SansJianpu from './lib/jianpu.js';
import * as SansTransportMath from './lib/transport-math.js';
import { allToggleLabel, initialRouting, route } from './lib/routing-state.js';
import * as SansLoopState from './lib/loop-state.js';
import { commandState, wholeSong } from './lib/editor-state.js';
import { transposeChordLabel, transposePitchClass } from './lib/chords.js';
import { playerApplication } from './lib/player-application.js';
import { mountPlayerShell } from './components/PlayerShell.jsx';

const BUCKETS = 1400;   // waveform resolution
const LOOKAHEAD = 0.06; // seconds of scheduling headroom before playback starts

// ---------------------------------------------------------------- state

let audio = null;          // AudioContext (created on first user gesture)
let master = null;         // master GainNode
let masterVolume = 1;      // 0-1.5; independent of every routing and lane-mute value
let tracks = [];           // loaded tracks
const RIBBON_H_KEY = 'sans_bass.ribbonHeight';
const RIBBON_H_MIN = 96;
const RIBBON_H_MAX = 600;
const RIBBON_H_DEFAULT = 220;

const clampRibbonH = (n) => Math.max(RIBBON_H_MIN, Math.min(RIBBON_H_MAX, Math.round(n)));

const ZOOM_SEC_KEY = 'sans_bass.zoomSeconds';
const ZOOM_SEC_MIN = 2;
const ZOOM_SEC_MAX = 60;
const ZOOM_SEC_DEFAULT = 10;
const ZOOM_BPS = 80;              // peak buckets per second — see SansRibbon.zoomPeaks
const ZOOM_H_KEY = 'sans_bass.zoomHeight';
const ZOOM_H_DEFAULT = 240;      // the reading view: tall enough for a label per semitone
const RIBBON_SHOW_KEY = 'sans_bass.ribbonVisible';

// Rounded: this value is persisted and shown, and 22.24662355096794 is neither.
const clampZoomSec = (n) =>
  Math.round(Math.max(ZOOM_SEC_MIN, Math.min(ZOOM_SEC_MAX, n)) * 100) / 100;

const NOTE_STEMS = ['vocals', 'bass'];   // vocals-priority order — anchors the zoomed pane,
                                          // and breaks the (practically unreachable) exact-tie
                                          // in setNotes() below
let noteLanes = {};        // stem -> { ribbon, el: {lane,canvas,txt,grip}, gain, muted, rangeHint }
                            // (volume lives in ribbonVolume[stem] below, not snapshotted here)
let zoomNotesStem = null;  // which channel's notes the zoomed pane currently shows: 'vocals' | 'bass' | null
let zoomNotesChipEls = {}; // stem -> { chip, select, spk } for the zoomed pane's "Notes: <lane>" chip pair
                            // — chip is the wrapping element, hidden until that stem has notes;
                            // see syncNotesChipsVisibility.
/* The Edit-notes toggle and shared Export/Import-edits buttons are React-owned since Phase 6e
 * (components/PlayerShell.jsx's EditModeToggle/EditIoControls) — no module-level DOM
 * references remain here. Their visibility/enablement/checked state is published through
 * applicationSnapshot()'s `notesEdit` field (see syncNotesChipsVisibility/syncEditToggle
 * below); their actions are playerApplication.commands.setEditMode/exportEdits/importEdits. */
let ribbonVolume = { vocals: 1, bass: 1 };
let ribbonHeight = { vocals: readStoredNumber(`${RIBBON_H_KEY}.vocals`, RIBBON_H_DEFAULT, clampRibbonH),
                      bass: readStoredNumber(`${RIBBON_H_KEY}.bass`, RIBBON_H_DEFAULT, clampRibbonH) };
let zoomSeconds = readZoomSeconds();
let zoomEl = null;         // { lane, canvas, out }
/* The React-owned Overview lane's canvas and Phase-6 range-hint hosts, populated by
 * attachOverviewCanvas/attachOverviewExtra below. Unlike per-track lanes (fresh objects each
 * song, repopulated because React mounts a fresh keyed <Lane> whenever a track's stem-derived
 * id is new), the Overview lane is a single unkeyed component: whenever a reloaded song keeps
 * a vocals/bass stem, React has no reason to unmount/remount it, so its canvas/host nodes
 * persist across song loads. Resetting this to null on every buildUI() call (as the legacy
 * DOM-rebuilding code safely did) would go stale after the very first song, since nothing
 * would ever call the attach hooks again to repopulate it — so buildUI() must never touch
 * this; only the attach/detach hooks below do, tied to the host's real mount/unmount. */
let overviewEl = { canvas: null, rangeHint: null };
let zoomPeaksByStem = {};  // stem id -> hi-res envelope, computed lazily, once per song
let zoomCenter = 0;        // seconds; follows the playhead while playing
let zoomHeight = readStoredNumber(ZOOM_H_KEY, ZOOM_H_DEFAULT, clampRibbonH);
/* What the zoomed pane shows as plain waveforms: any mix of stem ids (their waveform, gray
 * while a Notes chip is also selected — see zoomNotesStem above — in their own colour when
 * none is). Not persisted — every fresh page load starts back at the default. A stem id it
 * contains that the current song doesn't have is simply never drawn. */
let zoomLaneSel = new Set(['vocals']);
let zoomChipEls = [];      // [{ stem, select, label, spk }] for the current song's lane chips
let chordTimeline = [];    // half-bar results supplied by notes.js after Find notes
let chordDetectionPhase = null; // null | 'waiting' | 'detecting'
/* The capo control and chord display/editing are React-owned since Phase 6f
 * (components/PlayerShell.jsx's CapoSelect/ChordInput/ChordCandidatesSelect/ChordRow) — no
 * module-level DOM references remain here. Their presentation is published through
 * applicationChordSnapshot() (see draw()'s playerApplication.publishChord() call below); their
 * actions are playerApplication.commands.setCapo/commitChord/redetectChord. chordSegmentStart
 * is the one piece applicationChordSnapshot() computes that no component reads — only the
 * commitChord command handler does, to address the commit at the right timeline position,
 * the same role chordEditor.segmentStart used to play. */
let chordSegmentStart = null;
let capo = 0;
let detectedKey = null;
/* Sub-beat dotted lines in the zoomed pane, off by default — the beat/bar grid is the
 * reference most songs need, and quarter-beat ticks are clutter until asked for. Not
 * persisted, same as zoomLaneSel: every fresh page load starts back at the default. */
let showHalfBeat = false;
let showQuarterBeat = false;
let halfBeatBtn = null;
let quarterBeatBtn = null;
let editMode = false;       // mirrors the notes.js toggle — see 'sansbass:editmode'
let selectedNote = null;    // { at, midi } — at is a time point inside the note, midi is its
                             // pitch at selection time; both identify one specific note
let fieldsShownFor = null;  // { at, midi } of the note last written into the inline fields,
                             // or null — lets syncNoteFields skip a rewrite that would
                             // clobber an in-progress keystroke (see the design spec's
                             // "Refresh vs. typing")
let zoomToolbar = null;     // built in Task 4; guarded with `if (zoomToolbar)` until then
let zoomRangeHint = null;   // the "drag along the bottom" caption under the zoomed canvas
let noteDrag = null;   // { mode: 'move'|'resize-start'|'resize-end', note, startT, origStart, origEnd, previewStart, previewEnd }
let addArmed = false;      // "+ Add note" pressed — the next drag places a note
let addDrag = null;        // { startT, midi, curT }
let rangeDrag = null;        // { startT, curT } — actively dragging
let rangeSelection = null;   // { from, to } — committed, awaiting the delete button
let tempoRangeDrag = null;      // { startT, curT } — actively dragging on the drums lane
let tempoRange = null;          // { from, to } committed selection, or null = whole song
let tempoRangeArmed = false;    // mirrors notes.js's "Select BPM range" toggle
let tempoHintEl = null;         // caption text node under the drums lane
let tempoClearBtn = null;       // the Clear button beside it
let tempoDrumsCanvas = null;    // the drums stem's own waveform canvas — the drag surface
const RULER_BAND_PX = 16;    // bottom band of the zoomed canvas reserved for range-select
const WHEEL_SEEK_FRACTION = 0.05;  // fraction of the zoom span a single wheel tick seeks
const ARROW_SEEK_FRACTION = 0.15;  // fraction of the zoom span a single Arrow Left/Right seeks
const FINE_SEEK_STEP = 0.001;      // seconds — Shift+Arrow Left/Right, an absolute value: this
                                    // is for placing a cut inside a word, not view navigation,
                                    // so it stays fixed rather than scaling with the zoom span
let ribbonVisible = { vocals: readStoredFlag(`${RIBBON_SHOW_KEY}.vocals`, true),
                       bass: readStoredFlag(`${RIBBON_SHOW_KEY}.bass`, true) };
let duration = 0;          // longest track length, seconds
let offset = 0;            // playhead position when stopped, seconds
let startedAt = 0;         // audio.currentTime at which playback began
let playing = false;
let sources = [];
let stretchNodes = [];     // AudioWorkletNodes, one per stem — populated only while
                            // ratePercent !== 100 and playing; empty otherwise
let ratePercent = 100;     // 10-150, step 5 (1 with Shift); never persisted — see loadFiles/loadSeparated
let tempoInfo = null;      // last { bpmValue, confidence } from notes.js's sansbass:tempo
                            // broadcast; null until a song with a drums stem has one
let playGen = 0;           // bumped by play()/stop() so a stale in-flight play() can bail
let scrubbing = false;
let raf = 0;
let loopA = null;          // A-B repeat start, seconds (null = unset)
let loopB = null;          // A-B repeat end, seconds
let routingState = initialRouting([]);
let workletReady = null;   // Promise: resolves once lib/stretch-processor.js is registered
let loading = false;
let currentTitle = '';
let acceptedSongToken = 0;
let playerShell = null;
let primarySeekCanvas = null; // React-owned DOM; app.js retains only imperative waveform painting

const $ = (id) => document.getElementById(id);
const el = {
  player: $('player'), title: $('title'), lanes: $('lanes'),
  noteLanesRoot: $('note-lanes-root'), zoomLaneRoot: $('zoom-lane-root'), buildSha: $('build-sha'),
};

const BUILD_SHA = typeof __COMMIT_SHA__ === 'undefined' ? 'dev' : __COMMIT_SHA__;
if (el.buildSha) el.buildSha.textContent = BUILD_SHA;

/* Null-safe wiring. Every listener in this file is registered from one flat run of
 * top-level statements, so a single missing element used to abort the whole script at its
 * first `.addEventListener` and silently take every listener below it with it — including
 * drag & drop, which is what made the browser navigate to the dropped file instead of
 * loading it (see the v1.4.0 devlog entry). Warn and keep going instead. */
function on(node, ev, fn, opts) {
  if (!node) { console.warn(`sans_bass: no element for the "${ev}" handler — skipped`); return; }
  node.addEventListener(ev, fn, opts);
}

function ignoreReportedCommandError(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

const tr = (key, params) => SansI18n.t(key, params);

/* Analytics must never be able to break the player. try/catch guards against track()
 * itself throwing — a missing or failed lib/analytics.js module now fails app.js's whole
 * import graph instead of degrading here; see the ESM design spec's accepted trade-off. */
const gcTrack = (n) => { try { SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { SansAnalytics?.once(n);  } catch (e) { /* never */ } };
const gcBump  = (n) => { try { SansAnalytics?.bump(n);  } catch (e) { /* never */ } };

/** The lane's display name. Recognised stems translate; an unrecognised file keeps the
 *  label assignStems derived from its filename, which is not translatable. */
function laneLabel(t) {
  return t.stem ? tr('stem.' + t.stem) : t.label;
}

/** Stable identity for the mode dropdown — never the label, which changes with language.
 *  `i` is the track's index in the sorted `tracks` array, the same index 1-6 use. */
function laneKey(t, i) {
  return t.stem || `lane:${i}`;
}

// ---------------------------------------------------------------- helpers

function ensureAudio() {
  if (!audio) {
    // MUST be 44100: decodeAudioData resamples to the context rate, and the separation
    // model requires 44.1 kHz. A default 48 kHz context on macOS would feed it stretched
    // audio and produce quietly wrong stems with no error anywhere.
    audio = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    master = audio.createGain();
    master.gain.value = masterVolume;
    master.connect(audio.destination);
    // Each stem's synthesised-notes gain node is created per lane, in buildUI() — no lane
    // exists yet the first time ensureAudio() runs, before any song is loaded.
    // AudioWorklet's addModule() has no Vite-native import-bundling support (unlike
    // new Worker(new URL(...))), so the production build pins the worklet to a fixed,
    // unhashed output filename (see vite.config.js) that this branch points at directly —
    // the dev server needs no such workaround, since it transforms every module request
    // (including addModule's) through its own resolver regardless of which API asked.
    const stretchProcessorUrl = import.meta.env.DEV
      ? new URL('./lib/stretch-processor.js', import.meta.url)
      : new URL('./stretch-processor.js', import.meta.url);
    workletReady = audio.audioWorklet.addModule(stretchProcessorUrl);
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

/* Pane heights and the zoom width survive a reload the way the language toggle does.
 * Storage can throw outright in a private window, so every read and write is guarded: a
 * pane that refuses to render because localStorage is disabled would be a poor trade for
 * remembering a number. */
function readStoredNumber(key, fallback, clamp) {
  try {
    const v = parseFloat(localStorage.getItem(key));
    return Number.isFinite(v) ? clamp(v) : fallback;
  } catch (_) { return fallback; }
}

function readStoredFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch (_) { return fallback; }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) { /* private window */ }
}

/* Function declarations, NOT const arrows: the state at the top of this file calls these
 * before this point in the source, and only declarations hoist. A const arrow here throws
 * in the temporal dead zone — and because app.js is one flat run of top-level statements,
 * that throw takes out every listener below it and the page loads doing nothing at all.
 * That has now happened twice; the shape is the fix. */
function readZoomSeconds() {
  return readStoredNumber(ZOOM_SEC_KEY, ZOOM_SEC_DEFAULT, clampZoomSec);
}

/** '#rrggbb' -> 'rgba(r,g,b,a)'. Stem colours are always this 6-digit hex form (lib/stems.js). */
function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const fmt = formatClockTime;

/** Like fmt(), but to the hundredth of a second — for the overview/zoom time-code, where the
 *  playhead visibly moves within a single displayed second and whole-second precision would
 *  look frozen. */
const fmtCs = formatClockTimeCentiseconds;

/** Like fmt(), but to the millisecond — fmt()'s whole-second precision is too coarse for a
 *  note boundary, which is meaningful down to the 20ms floor (MIN_DUR). */
function fmtPrecise(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const totalMs = Math.round(t * 1000);
  const m = Math.floor(totalMs / 60000);
  const s = ((totalMs % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

/** Inverse of fmtPrecise() — returns null on anything else, including bare seconds with no
 *  ':'. The field always displays and expects m:ss.mmm, so round-tripping that one format is
 *  what matters, not accepting everything a user might type. */
function parseTimeMmSs(str) {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(str.trim());
  if (!m) return null;
  const mins = +m[1], secs = +m[2];
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

/* What is on the status line right now, as a key rather than rendered text, so a language
 * switch can re-render it. Without this a visible error would freeze in the old language. */
let lastSay = null;

/**
 * Put a message on the status line.
 * @param {string} key   dictionary key, or '' to clear. An unknown key renders as itself,
 *                       which is how already-rendered text still works if it ever appears.
 * @param {Object} [params] interpolation values
 * @param {boolean} [isErr]
 */
function say(key, params, isErr) {
  lastSay = key ? { key, params, isErr } : null;
  playerApplication.publish();
}

/* Last resort. A script error here is nearly always a stale cached asset paired with a
 * fresh one, and the symptom is a page that looks fine and does nothing — the worst kind
 * of failure to debug from the user's side. Name the fix rather than fail mutely. */
window.addEventListener('error', (e) => {
  console.error('sans_bass:', e.error || e.message);
  say('status.crash', null, true);
});

// ---------------------------------------------------------------- loading

function finishLoading(token) {
  if (!playerApplication.isCurrentSongToken(token)) return false;
  loading = false;
  return true;
}

async function loadFiles(fileList, fallbackName, source, token) {
  const files = [...fileList].filter(f => AUDIO_RE.test(f.name));
  if (!files.length) {
    finishLoading(token);
    gcTrack('load-error'); say('status.noAudioFiles', null, true); return;
  }

  loading = true;
  playerApplication.publish();
  ensureAudio();
  stop(true);
  ({ a: loopA, b: loopB } = SansLoopState.clearLoop());
  ratePercent = SansTransportMath.resetRatePercent();
  tempoInfo = null;   // belongs to the previous song; notes.js's own poll re-broadcasts fresh
  syncSpeedUI();
  say(files.length > 1 ? 'status.decodingMany' : 'status.decodingOne', { n: files.length });

  // Decode in parallel: decodeAudioData runs off the main thread, so six stems
  // decode in roughly the time of the slowest one instead of the sum of all six.
  let done = 0;
  const failed = [];
  const settled = await Promise.all(files.map(async (file) => {
    try {
      const buf = await audio.decodeAudioData(await file.arrayBuffer());
      if (playerApplication.isCurrentSongToken(token)) {
        say('status.decodingProgress', { done: ++done, total: files.length });
      }
      return { file, buffer: buf };
    } catch (e) {
      done++;
      failed.push(file.name);
      console.error(file.name, e);
      return null;
    }
  }));

  if (!playerApplication.isCurrentSongToken(token)) return;
  finishLoading(token);

  const loaded = settled.filter(Boolean);
  if (!loaded.length) {
    gcTrack('load-error');
    say('status.decodeFailAll', { names: failed.join(', ') }, true);
    return;
  }

  const items = loaded.map((l) => ({ name: l.file.name, buffer: l.buffer }));
  buildTracks(items, commonName(files, fallbackName), token);
  gcTrack(source === 'zip' ? 'zip-load' : 'song-load');

  if (failed.length) {
    say('status.decodeSkipped', { names: failed.join(', ') }, true);
  } else if (tracks.length > 1 && tracks.every((t) => !t.stem)) {
    say('status.noStemNames');
  } else {
    say('');
  }
}

/**
 * Load a zip of stems. The entries are mapped to the duck-typed shape loadFiles already
 * consumes — `webkitRelativePath` in particular, because commonName reads it to title the
 * song from the folder inside the zip, and a real File cannot carry one (it is read-only
 * and always empty).
 */
async function loadZip(file, token) {
  if (!file) return;
  say('status.readingZip');
  let entries;
  try {
    entries = await extract(file);
  } catch (err) {
    if (!finishLoading(token)) return;
    console.error(err);
    gcTrack('load-error');
    /* lib/unzip.js tags every error with a stable `code` and an English `message`. Keying
     * on the code translates them without modifying that file. Three different messages
     * share the code 'not-zip', so the translation is slightly less specific than the
     * English original — the trade for not reaching into lib/unzip.js. Any code without a
     * key falls through to the original message rather than printing "zipError.whatever". */
    const key = `zipError.${err.code}`;
    say(SansI18n.has(key) ? key : err.message, null, true);
    return;
  }
  if (!playerApplication.isCurrentSongToken(token)) return;
  if (!entries.length) {
    finishLoading(token);
    gcTrack('load-error');
    say('status.noAudioInZip', null, true);
    return;
  }
  return loadFiles(entries.map((e) => ({
    name: e.name,
    webkitRelativePath: e.webkitRelativePath,
    arrayBuffer: async () => e.bytes.buffer,
  })), file.name.replace(/\.zip$/i, ''), 'zip', token);
}

const isZip = (f) => /\.zip$/i.test(f.name);

/**
 * The one entry point behind the single Load button and behind a drop of one file.
 * There is still exactly one question — song or zip — but the extension answers it, so the
 * user is never asked to classify the file before the file dialog even opens.
 */
function loadAny(file, token) {
  if (!file) return;
  loading = true;
  playerApplication.publish();
  return isZip(file) ? loadZip(file, token) : loadSong(file, token);
}

/**
 * Load one unseparated song. Deliberately single-file: this is the separation entry point,
 * and a set of loose stem files is what a zip is for. `loadFiles` still takes many, because
 * loadZip hands it six.
 */
function loadSong(file, token) {
  if (!file) return;
  if (!AUDIO_RE.test(file.name)) {
    finishLoading(token);
    gcTrack('load-error');
    say('status.notAudioFile', { name: file.name }, true);
    return;
  }
  return loadFiles([file], undefined, 'song', token);
}

/**
 * Build lanes from decoded audio, whatever its origin.
 * @param {{name: string, buffer: AudioBuffer, stem?: string}[]} items
 * @param {string} title
 */
function buildTracks(items, title, token) {
  tracks = assignStems(items).map((t) => ({
    name: t.name,          // source filename — the ZIP folder name is derived from it
    stem: t.stem,
    label: t.label,
    color: t.color,
    order: t.order,
    buffer: t.buffer,
    muted: false,
    volume: 1,
    gain: null, peaks: null, canvas: null, layers: null,
  }));

  tracks.sort((a, b) => a.order - b.order);
  duration = Math.max(...tracks.map((t) => t.buffer.duration));
  offset = 0;
  currentTitle = title;
  acceptedSongToken = token;

  tracks.forEach((t) => {
    t.gain = audio.createGain();
    t.gain.connect(master);
    t.peaks = computePeaks(t.buffer, duration);
  });

  window.__hasStems = hasMixPlusStems(tracks);
  routingState = initialRouting(tracks.map(laneKey), {
    hasMixPlusStems: window.__hasStems,
  });

  buildUI(title);
  syncRoutingState(routingState);
  playerApplication.publish();
}

/**
 * Entry point for stems produced in-browser rather than loaded from disk.
 * @param {{name: string, buffer: AudioBuffer}} original
 * @param {Object<string, {left: Float32Array, right: Float32Array}>} stems
 */
function loadSeparated(original, stems, token) {
  // The original is deliberately dropped: the six stems already sum to it, and keeping
  // it would either double the audio or need permanent suppression. Its name still
  // becomes the title. (assignStems' explicit-'mix' path still guards the disk case,
  // where a folder genuinely holds a mix file alongside its stems.)
  const items = [];

  for (const [stem, ch] of Object.entries(stems)) {
    const buf = audio.createBuffer(2, ch.left.length, audio.sampleRate);
    buf.copyToChannel(ch.left, 0);
    buf.copyToChannel(ch.right, 1);
    items.push({ name: `${stem}.wav`, buffer: buf, stem });
  }

  // Separation runs in a worker, so the mix may still be playing when the stems land.
  // Its BufferSources are not in `tracks` and would keep sounding over the new lanes with
  // a stale startedAt. stop(false) silences them and returns the playhead to the start.
  stop(false);

  ({ a: loopA, b: loopB } = SansLoopState.clearLoop());
  ratePercent = SansTransportMath.resetRatePercent();
  tempoInfo = null;   // belongs to the previous song; notes.js's own poll re-broadcasts fresh
  syncSpeedUI();
  // No mix track means hasMixPlusStems() is false, so setMode('mix') inside buildTracks
  // leaves every stem unmuted — all six lanes on by default.
  buildTracks(items, original.name.replace(AUDIO_RE, ''), token);
  say('');
}

/**
 * Title the player. The folder inside the zip is the best name, because that is what
 * prep-stems.sh names after the song. A flat zip has no folder, so fall back to the zip's
 * own filename — `fallbackName`, supplied by loadZip. Only if there is neither do we count
 * files, and that last resort is deliberately not translated: it is a debugging artefact,
 * not copy a user is meant to read. See docs/behaviour.md.
 */
function commonName(files, fallbackName) {
  const paths = files.map(f => f.webkitRelativePath || f.name);
  if (paths.length === 1) return paths[0].replace(AUDIO_RE, '');
  const dir = paths[0].split('/').slice(0, -1).pop();
  return dir || fallbackName || `${files.length} tracks`;
}

/** Peak envelope on a fixed time grid so lanes of differing length stay aligned. */
function computePeaks(buffer, totalDuration) {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const perBucket = (totalDuration / BUCKETS) * buffer.sampleRate;
  const mins = new Float32Array(BUCKETS);
  const maxs = new Float32Array(BUCKETS);
  for (let b = 0; b < BUCKETS; b++) {
    const s = Math.floor(b * perBucket);
    const e = Math.min(ch0.length, Math.floor((b + 1) * perBucket));
    let mn = 0, mx = 0;
    for (let i = s; i < e; i++) {
      const v = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    mins[b] = mn; maxs[b] = mx;
  }
  return { mins, maxs };
}

/** Summed stem peaks approximate the full mix for the overview waveform. */
function mixPeaks() {
  const stems = tracks.filter(t => t.stem !== 'mix');
  const src = stems.length ? stems : tracks;
  const mins = new Float32Array(BUCKETS);
  const maxs = new Float32Array(BUCKETS);
  for (const t of src) {
    for (let b = 0; b < BUCKETS; b++) { mins[b] += t.peaks.mins[b]; maxs[b] += t.peaks.maxs[b]; }
  }
  return { mins, maxs };
}

// ---------------------------------------------------------------- UI

function buildUI(title) {
  el.player.hidden = false;
  el.title.textContent = title;

  // lanes
  /* The previous song's frames describe the previous song's audio; drawn against the new
   * duration they would be silently wrong. Drop them before the lanes are rebuilt. */
  zoomPeaksByStem = {};
  chordTimeline = [];
  chordDetectionPhase = null;
  capo = 0;
  detectedKey = null;
  tempoRangeDrag = null;
  tempoRange = null;
  tempoRangeArmed = false;
  // notes.js owns its own copy of the same three things (tempo, tempoRange, tempoRangeArmed)
  // plus the BPM/phase grid itself — none of it is derived from THIS song otherwise, so it
  // must not survive into a new one. See notes.js's resetTempo() and its 'sansbass:songload'
  // listener.
  window.dispatchEvent(new CustomEvent('sansbass:songload'));
  tempoHintEl = null;
  tempoClearBtn = null;
  tempoDrumsCanvas = null;
  /* Standard lanes (name/canvas/volume) are React's — see components/PlayerShell.jsx's
   * StemLanes/Lane — rendered from the `tracks` snapshot published below. This module only
   * clears/rebuilds its OWN #note-lanes-root subtree (ribbon/zoom/overview), never touching
   * #standard-lanes-root: two owners of one DOM region is exactly what this migration's
   * architecture rules forbid. Visual order between the two subtrees is recovered purely
   * with CSS `order` (see styles.css), computed independently on each side from the same
   * `tracks` order — no cross-owner DOM references remain. */
  el.noteLanesRoot.innerHTML = '';
  // The drums lane's tempo-range hint nests INSIDE that lane's own card (grid-column: 1/-1
  // spans its React-owned grid), so it cannot live in #note-lanes-root as a sibling card —
  // it is built lazily by attachLaneExtra() into a host `<Lane>` renders just for the drums
  // track, the same "React owns the stable host, app.js owns its content" split as
  // attachLaneCanvas. tempoHintEl/tempoClearBtn/tempoDrumsCanvas are populated there.

  /* Built here rather than parked in index.html: el.noteLanesRoot.innerHTML = '' above
   * destroys anything inside it, so a static element would vanish on the second song. Built
   * with the lanes it survives by construction, and lands directly under vocals via `order`. */
  noteLanes = {};
  /* zoomNotesStem must reset here too, not just noteLanes — it is module-level state that
   * otherwise survives across buildUI() calls (song loads). Left stale (e.g. still 'bass'
   * from the previous song), the new song's vocals channel finishing first would never
   * auto-claim the selection: setNotes()'s `if (zoomNotesStem === null && lane.ribbon)`
   * guard would see a non-null (but now meaningless) value and skip the assignment — the
   * pane would show plain waveforms only, silently missing the pitch overlay N56a promises. */
  zoomNotesStem = null;
  // overviewEl is deliberately NOT reset here — see its own declaration comment. React owns
  // the Overview lane's mount/unmount lifecycle now, not this per-song rebuild. zoomEl,
  // zoomToolbar, halfBeatBtn, quarterBeatBtn, zoomChipEls, and zoomNotesChipEls
  // get the same treatment as of Phase 6d (see docs/react-phase-6d-zoomed-pane-mount-refactor-
  // plan.md): they are NOT unconditionally reset here. The zoomed pane's own DOM (built into
  // #zoom-lane-root, a root separate from #note-lanes-root precisely so this teardown above
  // cannot reach it) survives a song replacement that keeps a vocals/bass stem, exactly like
  // the Overview lane has since Phase 4b — see the `if (anchorTrack)` block below for the
  // first-time/reuse/teardown branching that replaces the old unconditional null-and-rebuild.
  let anchorTrack = null;   // the first (vocals-priority) stem with a note lane — the zoomed
                             // pane's DOM anchor
  for (const stem of NOTE_STEMS) {
    const track = tracks.find((t) => t.stem === stem);
    if (!track) continue;
    if (!anchorTrack) anchorTrack = track;

    const lane = document.createElement('div');
    lane.className = 'lane ribbon';
    lane.hidden = true;

    const name = document.createElement('div');
    name.className = 'lane-name';
    name.title = tr('notes.muteTip');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const txt = document.createElement('span');
    txt.className = 'txt';
    // Same pattern as the zoomed pane's two Notes chips ("Vocals notes"/"Bass notes") — with
    // both channels populated, two identical "Notes" rows give no way to tell which lane
    // controls which channel. See retranslate() for the language-switch half of this.
    txt.textContent = tr('notes.zoomNotesChipFor', { lane: tr('stem.' + stem) });
    name.append(dot, txt);
    name.addEventListener('click', () => toggleRibbon(stem));

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const vol = document.createElement('div');
    vol.className = 'lane-vol';
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min: 0, max: 1.5, step: 0.01, value: ribbonVolume[stem] });
    slider.addEventListener('input', () => { ribbonVolume[stem] = parseFloat(slider.value); applyRibbonGain(stem); });
    vol.appendChild(slider);

    /* Drag the bottom edge to grow the lane. Height is the only way to read pitch: at the
     * default the range can span 27 semitones, and note names need roughly 9 px each. */
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = tr('notes.resizeTip');
    attachResize(grip, () => ribbonHeight[stem], (v) => { ribbonHeight[stem] = v; }, `${RIBBON_H_KEY}.${stem}`,
      () => {
        const l = noteLanes[stem];
        if (l && l.ribbon) renderRibbon(l.el.canvas, l.ribbon, l.el.canvas.clientWidth, ribbonHeight[stem]);
        draw();
      });

    /* Names the bottom range-select band, same reasoning as the zoomed pane's equivalent
     * caption (see 'sansbass:editmode' listener) — the band alone doesn't say what it's for.
     * Shown only while THIS stem is the one currently selected for editing — see
     * syncRangeHints(). */
    const rHint = document.createElement('div');
    rHint.className = 'note-range-hint';
    rHint.textContent = tr('notes.rangeTip');
    rHint.hidden = true;

    lane.append(name, canvas, rHint, vol, grip);
    // Visual position (immediately after its own stem's standard lane) comes from `order`
    // alone — both owners derive it from the same shared `tracks` order, so no reference to
    // the other owner's DOM node is needed. See the ownership note above buildUI()'s
    // `el.noteLanesRoot.innerHTML = ''`.
    lane.style.order = String(2 * tracks.indexOf(track) + 1);
    el.noteLanesRoot.appendChild(lane);
    attachSeek(canvas, { rangeBand: true, stem });

    noteLanes[stem] = {
      ribbon: null, el: { lane, canvas, txt, grip }, gain: null,
      muted: true, rangeHint: rHint,
    };
    // Volume itself is NOT snapshotted onto the lane object: applyRibbonGain(stem) reads
    // ribbonVolume[stem] directly, so the slider's live updates to that module-level map
    // are what it always sees — a copy here would go stale the moment the slider moved.
    if (audio) {
      const gain = audio.createGain();
      gain.connect(master);
      noteLanes[stem].gain = gain;
    }
    applyRibbonGain(stem);
  }

  if (anchorTrack && !zoomEl) {
    /* The zoomed pane. It shares the lane grid so its canvas starts on the same pixel as
     * every waveform, but NOT the time mapping — it shows a window, which is the whole
     * point. One shared instance, docked above the first (vocals-priority) note lane that
     * exists — see docs/superpowers/specs/2026-09-01-bass-notes-design.md. Always visible
     * (as long as a vocals/bass stem exists at all) rather than gated on note detection, so
     * it's useful as a plain-waveform inspector before "Find notes" has ever run — only the
     * Notes chips and Edit toggle inside it wait for detection (syncNotesChipsVisibility).
     *
     * Built once and reused across a song replacement that keeps a vocals/bass stem — see
     * the `else if (anchorTrack)` reuse branch and the `else if (zoomEl)` teardown branch
     * below, and docs/react-phase-6d-zoomed-pane-mount-refactor-plan.md for why: this mirrors the
     * Overview lane's own persistence fix from Phase 4b, applied to the much larger zoomed
     * pane so its capo/chord/Edit-toggle/Export-Import controls can eventually become a
     * stable React host (Phase 6e) without losing their DOM identity on every song load. */
    const zLane = document.createElement('div');
    zLane.className = 'lane ribbon-zoom';

    const zName = document.createElement('div');
    zName.className = 'lane-name';
    const zTxt = document.createElement('span');
    zTxt.className = 'txt';
    zTxt.textContent = tr('notes.zoom');

    const zTime = document.createElement('span');
    zTime.className = 'time-code';

    const zOut = document.createElement('span');
    zOut.className = 'zoom-secs';

    /* Buttons as well as the wheel: a trackpad wheel is easy to overshoot, and on a
     * touch device there is no wheel at all. Both routes go through zoomBy. */
    const zBtns = document.createElement('span');
    zBtns.className = 'zoom-btns';
    const mkBtn = (label, factor, key) => {
      const b = document.createElement('button');
      b.className = 'zoom-btn';
      b.textContent = label;
      b.title = tr(key);
      b.addEventListener('click', () => zoomBy(factor));
      return b;
    };
    zBtns.append(mkBtn('−', 1.5, 'notes.zoomOut'), mkBtn('+', 1 / 1.5, 'notes.zoomIn'));

    /* Sub-beat dotted-line toggles — view options for this pane, same family as the zoom
     * level buttons beside them, not a lane selection (which is why they sit here rather
     * than in zLaneSel below). */
    const zSubBtns = document.createElement('span');
    zSubBtns.className = 'zoom-btns zoom-sub-btns';
    halfBeatBtn = document.createElement('button');
    halfBeatBtn.type = 'button';
    halfBeatBtn.className = 'mini zoom-sub-btn';
    halfBeatBtn.classList.toggle('active', showHalfBeat);
    halfBeatBtn.textContent = '½';
    halfBeatBtn.title = tr('notes.zoomHalfBeatTip');
    halfBeatBtn.addEventListener('click', toggleHalfBeat);
    quarterBeatBtn = document.createElement('button');
    quarterBeatBtn.type = 'button';
    quarterBeatBtn.className = 'mini zoom-sub-btn';
    quarterBeatBtn.classList.toggle('active', showQuarterBeat);
    quarterBeatBtn.textContent = '¼';
    quarterBeatBtn.title = tr('notes.zoomQuarterBeatTip');
    quarterBeatBtn.addEventListener('click', toggleQuarterBeat);
    zSubBtns.append(halfBeatBtn, quarterBeatBtn);

    /* The label stays with what it actually names — the seconds readout and the zoom
     * buttons — on one row. It used to sit alone above a second row of lane chips, which
     * read as if it were labelling THEM instead. */
    const zTopRow = document.createElement('div');
    zTopRow.className = 'zoom-top-row';
    const zSecsGroup = document.createElement('span');
    zSecsGroup.className = 'zoom-secs-group';
    zSecsGroup.append(zOut, zBtns, zSubBtns);
    zTopRow.append(zTxt, zTime, zSecsGroup);

    /* Which stem(s) — as plain waveforms — the pane below draws, plus the two Notes chips
     * below. One chip per stem actually in this song: a coloured dot AND its stem name,
     * toggling it into the pane, plus a speaker glyph that mutes/unmutes the lane exactly
     * like clicking its row in the main list does. Nested in their own `zChipHost` (kept
     * `display: contents` in styles.css so it doesn't affect zLaneSel's flex layout) so a
     * later song's differing stem set can be rebuilt here alone via rebuildZoomChipHost(),
     * without touching the permanent `zEditHost` sibling appended after it below — see
     * docs/react-phase-6d-zoomed-pane-mount-refactor-plan.md and, for that host itself,
     * docs/react-phase-6e-edit-toggle-export-import-plan.md. */
    const zLaneSel = document.createElement('span');
    zLaneSel.className = 'zoom-lane-sel';
    const zChipHost = document.createElement('span');
    zChipHost.className = 'zoom-chip-host';
    zLaneSel.appendChild(zChipHost);
    rebuildZoomChipHost(zChipHost);
    /* The Edit-notes toggle and shared Export/Import-edits buttons that used to be built here
     * (beside the stem/Notes chip host) are React-owned since Phase 6e — see
     * components/PlayerShell.jsx's EditModeToggle/EditIoControls. Unlike every other
     * React-owned region, there is no static index.html root to portal into: `zLaneSel` is
     * itself legacy DOM built here, not static markup, so React has nothing to attach to at
     * page-load time. Instead `app.js` creates one stable, `display: contents` host span,
     * appends it into `zLaneSel` right after the chip host (preserving flex/gap layout exactly
     * as if these were direct children), and hands it to React via
     * `playerApplication.publishEditHost()` — the mirror image of `attachLaneCanvas`/
     * `attachOverviewCanvas` (where REACT creates the node and hands it to app.js), needed
     * because here the PARENT the node must live in is legacy-owned, not the node's own
     * content. Created once, alongside the rest of this first-time-construction branch, and
     * persists across song loads exactly like `zChipHost` (Phase 6d) — never recreated on
     * reuse, only torn down (see the `else if (zoomEl)` teardown branch below). */
    const zEditHost = document.createElement('span');
    zEditHost.className = 'zoom-edit-host';
    zLaneSel.appendChild(zEditHost);
    playerApplication.publishEditHost(zEditHost);

    /* The capo control and chord display/editing that used to be built here (as `chordGroup`,
     * a sibling of `zTopRow`/`zLaneSel` inside `zName`) are React-owned since Phase 6f — see
     * components/PlayerShell.jsx's CapoSelect/ChordInput/ChordCandidatesSelect/ChordRow. Same
     * plumbing shape as `zEditHost` just above (a legacy-created, `display: contents` host
     * handed to React via `playerApplication.publishChordHost()`, since `zName` is legacy DOM
     * with no static index.html root to portal into), at the exact position `chordGroup` used
     * to occupy — see docs/react-phase-6f-capo-chord-editor-plan.md. Created once, alongside
     * the rest of this first-time-construction branch, and persists across song loads exactly
     * like `zEditHost`/`zChipHost` — never recreated on reuse, only torn down (see the
     * `else if (zoomEl)` teardown branch below). */
    const zChordHost = document.createElement('span');
    zChordHost.className = 'zoom-chord-host';
    playerApplication.publishChordHost(zChordHost);

    syncZoomChips();

    zName.append(zTopRow, zChordHost, zLaneSel);

    const zCanvas = document.createElement('canvas');
    zCanvas.className = 'wave zoomwave';
    zCanvas.title = tr('notes.zoomTip');

    /* Names the bottom range-select band for anyone who hasn't found it by trial and error —
     * the band itself is hinted on-canvas (see renderZoom's idle strip), but a highlighted
     * strip alone doesn't say what it's FOR. Hidden while edit mode is off, alongside the
     * toolbar (see the 'sansbass:editmode' listener). */
    const zRangeHint = document.createElement('div');
    zRangeHint.className = 'note-range-hint';
    zRangeHint.textContent = tr('notes.rangeTip');
    zRangeHint.hidden = !editMode;
    zoomRangeHint = zRangeHint;

    const zSpacer = document.createElement('div');
    const zGrip = document.createElement('div');
    zGrip.className = 'ribbon-grip';
    zGrip.title = tr('notes.resizeTip');
    attachResize(zGrip, () => zoomHeight, (v) => { zoomHeight = v; }, ZOOM_H_KEY, () => draw());

    /* The edit toolbar. Hidden while edit mode is off (see the 'sansbass:editmode' listener);
     * each button disabled until a note is selected. */
    const zToolbar = document.createElement('div');
    zToolbar.className = 'note-toolbar';
    zToolbar.hidden = !editMode;

    const mkEditBtn = (label, titleKey, fn) => {
      const b = document.createElement('button');
      b.className = 'mini note-tbtn';
      b.type = 'button';
      b.textContent = label;
      b.title = tr(titleKey);
      b.disabled = true;
      b.addEventListener('click', fn);
      return b;
    };

    const octUp = mkEditBtn('↑ 8ve', 'notes.editOctUpTip', () => editOctave(1));
    const octDown = mkEditBtn('↓ 8ve', 'notes.editOctDownTip', () => editOctave(-1));
    const pitchUp = mkEditBtn('♯', 'notes.editPitchUpTip', () => editPitchNudge(1));
    const pitchDown = mkEditBtn('♭', 'notes.editPitchDownTip', () => editPitchNudge(-1));
    const timeBack = mkEditBtn('◄t', 'notes.editTimeBackTip', () => editTimeNudge(-1));
    const timeFwd = mkEditBtn('▶t', 'notes.editTimeFwdTip', () => editTimeNudge(1));
    const split = mkEditBtn('✂', 'notes.editSplitTip', editSplit);
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');
    const addBtn = mkEditBtn('+ ' + tr('notes.editAdd'), 'notes.editAddTip', toggleAddArmed);
    addBtn.disabled = false;   // always available while edit mode is on, selection or not

    const snapNote = mkEditBtn('⊞', 'notes.editSnapTip', editSnapNote);

    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');
    const rangeSnap = mkEditBtn(tr('notes.editRangeSnap'), 'notes.editRangeSnapTip', editSnapRange);
    const wholeSong = mkEditBtn(tr('notes.editWholeSong'), 'notes.editWholeSongTip', setWholeSongRange);
    wholeSong.disabled = false;   // always available while edit mode is on, range or not

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, snapNote,
                     split, del, rangeDel, rangeSnap, wholeSong);

    /* Inline Start/End/Pitch fields, next to the toolbar. Same hidden-until-edit-mode and
     * disabled-until-selected rules as the toolbar buttons above — see docs/superpowers/
     * specs/2026-09-01-note-inline-fields-design.md and its labels/flat-pitch follow-up. */
    const zFields = document.createElement('div');
    zFields.className = 'note-fields';
    zFields.hidden = !editMode;

    const mkFieldInput = (titleKey) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'note-field';
      inp.title = tr(titleKey);
      inp.setAttribute('aria-label', tr(titleKey));
      inp.disabled = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFields();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          inp.blur();
          fieldsShownFor = null;
          syncEditToolbar();
        }
      });
      return inp;
    };

    /* Wraps a field in a <label> so the visible caption also focuses the control on click —
     * no id/for plumbing needed, this project doesn't put ids on dynamically-built elements. */
    const mkFieldGroup = (titleKey, control) => {
      const label = document.createElement('label');
      label.className = 'note-field-group';
      const span = document.createElement('span');
      span.className = 'note-field-label';
      span.textContent = tr(titleKey);
      label.append(span, control);
      return label;
    };

    const fieldStart = mkFieldInput('notes.editFieldStart');
    const fieldEnd = mkFieldInput('notes.editFieldEnd');
    const startGroup = mkFieldGroup('notes.editFieldStart', fieldStart);
    const endGroup = mkFieldGroup('notes.editFieldEnd', fieldEnd);

    /* Pitch is three selects, not a text field — a flat accidental is an explicit choice here,
     * not a guess a free-text parser would have to interpret. Auto-commits on change (see
     * commitPitchDropdown), so it never joins Start/End's Enter/Apply-staged path. */
    const mkFieldSelect = (options, titleKey) => {
      const sel = document.createElement('select');
      sel.className = 'note-field note-field-select';
      sel.title = tr(titleKey);
      sel.setAttribute('aria-label', tr(titleKey));
      sel.disabled = true;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.append(o);
      }
      sel.addEventListener('change', commitPitchDropdown);
      return sel;
    };

    const PITCH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const PITCH_ACCIDENTALS = [
      { value: '#', label: '♯' },
      { value: '', label: '♮' },
      { value: 'b', label: '♭' },
    ];
    const PITCH_OCTAVES = Array.from({ length: 11 }, (_, i) => String(i - 1));   // "-1".."9"

    const fieldPitchLetter = mkFieldSelect(PITCH_LETTERS.map((l) => ({ value: l, label: l })), 'notes.editFieldPitch');
    const fieldPitchAccidental = mkFieldSelect(PITCH_ACCIDENTALS, 'notes.editFieldPitch');
    const fieldPitchOctave = mkFieldSelect(PITCH_OCTAVES.map((o) => ({ value: o, label: o })), 'notes.editFieldPitch');

    const pitchGroupInner = document.createElement('div');
    pitchGroupInner.className = 'note-field-pitch-group';
    pitchGroupInner.append(fieldPitchLetter, fieldPitchAccidental, fieldPitchOctave);

    const pitchLabel = document.createElement('span');
    pitchLabel.className = 'note-field-label';
    pitchLabel.textContent = tr('notes.editFieldPitch');

    const pitchGroup = document.createElement('div');
    pitchGroup.className = 'note-field-group';
    pitchGroup.append(pitchLabel, pitchGroupInner);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini note-tbtn';
    applyBtn.type = 'button';
    applyBtn.textContent = tr('notes.editFieldApply');
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', commitFields);

    zFields.append(startGroup, endGroup, pitchGroup, applyBtn);

    zoomToolbar = { root: zToolbar, fields: zFields, add: addBtn, octUp, octDown, pitchUp,
                     pitchDown, timeBack, timeFwd, snapNote, split, del, rangeDel, rangeSnap,
                     wholeSong, fieldStart, fieldEnd, fieldPitchLetter, fieldPitchAccidental,
                     fieldPitchOctave, applyBtn };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
    // Always pinned above every standard/ribbon lane (order 0, 1, 2, … above), same as before.
    zLane.style.order = '-1';
    // Appended into its own #zoom-lane-root, not #note-lanes-root — see that root's comment
    // in index.html and the module-level note above this block for why: this DOM must survive
    // the per-song `el.noteLanesRoot.innerHTML = ''` teardown above, which only ever needs to
    // reach the genuinely per-stem ribbon lanes.
    el.zoomLaneRoot.appendChild(zLane);
    // attachZoom(zCanvas) above and attachResize(zGrip, ...) earlier in this block are both
    // registered exactly once, here at first construction — not on every reuse below. Both
    // closures read module-level state dynamically at event time, so re-registering them on
    // an already-listening, persisted zCanvas/zGrip would stack a second set of listeners and
    // double-fire every wheel/drag gesture after the pane survives its first song replacement.
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut, time: zTime, chipHost: zChipHost };

    // The overview lane (React-owned since Phase 4b: label, master-volume-mirroring slider,
    // canvas host) is rendered by PlayerShell.jsx into #overview-lane-root whenever a
    // vocals/bass stem exists, pinned above the zoomed pane via the same order: -2 convention
    // this block used to set directly. Its canvas and range-hint host are populated by
    // attachOverviewCanvas/attachOverviewExtra below, not here — see overviewEl's own comment.
  } else if (anchorTrack) {
    /* Reuse: the pane built for a previous song is still attached (anchorTrack persisted
     * across this song replacement). Only the stem/Notes chips genuinely vary per song and
     * need rebuilding (different songs can have different stem sets) — capo's displayed value
     * no longer needs an imperative reset here: `capo` itself was already reset to 0 above,
     * and the React-controlled capo <select> (Phase 6f) reflects that on its own next
     * publishChord() tick, unlike the legacy <select> node this replaced, which needed its own
     * stale `.value` reset by hand once it stopped being recreated every song. */
    rebuildZoomChipHost(zoomEl.chipHost);
  } else if (zoomEl) {
    /* Teardown: this song has no vocals/bass stem where a previous one did. Matches today's
     * "no anchor → no zoomed pane" state exactly; a later replacement that reintroduces a
     * vocals/bass stem re-enters the first-time branch above and builds a fresh pane. */
    zoomEl.lane.remove();
    zoomEl = null;
    chordSegmentStart = null;
    zoomToolbar = null;
    halfBeatBtn = null;
    quarterBeatBtn = null;
    zoomChipEls = [];
    zoomNotesChipEls = {};
    playerApplication.publishEditHost(null);
    playerApplication.publishChordHost(null);
  }

  /* Forces the zoomed pane's detection-gated controls (Notes chips, Edit-notes toggle,
   * Export/Import buttons) back to their "nothing ready yet" state for the new song. Cheap
   * and correct to call unconditionally (each is already null-safe): construction already
   * gave the right initial state before Phase 6d, but a REUSED pane needs this explicit call
   * — without it, a completed previous song's visible/enabled state would otherwise leak into
   * a new song that has not run detection yet. See the plan doc's lifecycle-hazards section. */
  syncNotesChipsVisibility();
  syncZoomChips();
  syncEditToggle();

  syncRangeHints();
  renderAll();
}

/** Rebuilds the zoomed pane's stem chips and "Notes: <lane>" chips inside `chipHost` to match
 *  the current song's `tracks`/`noteLanes` — called once at the pane's first construction and
 *  again, in place, whenever an existing pane is reused for a song replacement that keeps the
 *  anchor stem (see buildUI()'s `if (anchorTrack)` branching). `chipHost` stays `display:
 *  contents` in styles.css so its children act as direct flex items of `zLaneSel`, identical
 *  to how these chips laid out before this host existed. */
function rebuildZoomChipHost(chipHost) {
  chipHost.innerHTML = '';
  zoomChipEls = tracks.filter((t) => t.stem).map((t) => {
    const chip = document.createElement('span');
    chip.className = 'zoom-chip';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'zoom-chip-select';
    select.style.setProperty('--chip-color', t.color);
    select.title = tr('notes.zoomLaneShowTip', { lane: laneLabel(t) });
    const dot2 = document.createElement('span');
    dot2.className = 'zoom-chip-dot';
    const label = document.createElement('span');
    label.className = 'zoom-chip-label';
    label.textContent = laneLabel(t);
    select.append(dot2, label);
    select.addEventListener('click', () => toggleZoomLane(t.stem));
    const spk = document.createElement('button');
    spk.type = 'button';
    spk.className = 'zoom-chip-mute';
    spk.textContent = '♪';
    spk.title = tr('notes.zoomLaneMuteTip', { lane: laneLabel(t) });
    spk.addEventListener('click', () => toggleTrack(t));
    chip.append(select, spk);
    chipHost.appendChild(chip);
    return { stem: t.stem, select, label, spk };
  });

  /* One "Notes: <lane>" chip per stem that actually has a note lane this song — mutually
   * exclusive on select (picking one clears the other, see toggleZoomNotes), independent on
   * mute (each mutes only its own lane). Built the same way the stem chips above are. Hidden
   * until that stem actually has notes — see syncNotesChipsVisibility — since the zoomed pane
   * itself is visible from song load, before "Find notes" has ever run. */
  zoomNotesChipEls = {};
  for (const stem of NOTE_STEMS) {
    if (!noteLanes[stem]) continue;
    const chip = document.createElement('span');
    chip.className = 'zoom-chip';
    chip.hidden = true;
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'mini zoom-notes-chip';
    select.textContent = tr('notes.zoomNotesChipFor', { lane: tr('stem.' + stem) });
    select.title = tr('notes.zoomNotesChipForTip', { lane: tr('stem.' + stem) });
    select.addEventListener('click', () => toggleZoomNotes(stem));
    const spk = document.createElement('button');
    spk.type = 'button';
    spk.className = 'zoom-chip-mute';
    spk.textContent = '♪';
    spk.title = tr('notes.zoomNotesMuteTipFor', { lane: tr('stem.' + stem) });
    spk.addEventListener('click', () => toggleRibbon(stem));
    chip.append(select, spk);
    chipHost.appendChild(chip);
    zoomNotesChipEls[stem] = { chip, select, spk };
  }
}

/** The channel the zoomed pane's PITCH OVERLAY and the editing toolbar currently operate
 *  on, or null when no chip is selected (or the selected channel has no notes yet). Editing
 *  always needs this exact channel — there is no "any" fallback for it. */
function currentRibbon() {
  const lane = zoomNotesStem && noteLanes[zoomNotesStem];
  return lane ? lane.ribbon : null;
}

/** Any channel that currently has notes, vocals first — used ONLY for the zoomed pane's
 *  beat/bar grid, which is a tempo reference for whatever waveform(s) are on screen and
 *  must keep drawing even while no Notes chip is selected (see renderZoom). Tempo is the
 *  same shared object mirrored into every channel's payload, so it does not matter which
 *  channel answers as long as one exists. */
function anyRibbon() {
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) return lane.ribbon;
  }
  return null;
}

/* The interpretation layer hands its result over here, per stem. Called again on every
 * change of a detection parameter — see docs/transcription.md — so it must be cheap and
 * idempotent. */
function setNotes(stem, payload) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.ribbon = payload && payload.notes && payload.frames ? payload : null;
  /* First channel to finish analysis claims the zoomed pane; vocals wins only because it
   * tends to finish first in practice — see docs/superpowers/specs/2026-09-01-bass-notes-design.md.
   * Guarded on visibility too: a channel whose own lane is currently hidden must not silently
   * claim the pane's overlay — see setRibbonVisible for the matching guard on the other side
   * (clearing the selection when the SELECTED channel's lane is hidden). */
  if (zoomNotesStem === null && lane.ribbon && ribbonVisible[stem]) zoomNotesStem = stem;
  applyRibbonVisibility(stem);
  syncNotesChipsVisibility();
  syncZoomChips();
  syncEditToggle();
  renderOverview();
  if (!lane.ribbon) { lane.el.canvas.__layers = null; draw(); return; }
  zoomCenter = currentTime();
  renderRibbon(lane.el.canvas, lane.ribbon, lane.el.canvas.clientWidth, ribbonHeight[stem]);
  draw();
}

/** Hi-res peak envelope for one stem's waveform in the zoomed pane, computed on first use
 *  and cached for the rest of the song — see zoomPeaksByStem. */
function ensureZoomPeaks(stem) {
  if (zoomPeaksByStem[stem]) return zoomPeaksByStem[stem];
  const t = tracks.find((tr) => tr.stem === stem);
  if (!t || !t.buffer) return null;
  const peaks = SansRibbon.zoomPeaks(t.buffer.getChannelData(0), t.buffer.sampleRate, ZOOM_BPS);
  zoomPeaksByStem[stem] = peaks;
  return peaks;
}

function renderAll() {
  const mp = mixPeaks();
  // The overview keeps true relative dynamics; it only ever shrinks, never boosts.
  if (primarySeekCanvas) {
    renderWave(primarySeekCanvas, mp, '#ffffff', primarySeekCanvas.clientWidth, 'main',
               Math.min(1, laneScale(mp)));
  }
  tracks.forEach(t => {
    // t.canvas is null until React mounts the lane and calls attachLaneCanvas (which
    // performs this exact same render for that one lane) — same race as primarySeekCanvas
    // above, since this synchronous pass runs before the song publication React reacts to.
    if (!t.canvas) return;
    t.layers = renderWave(t.canvas, t.peaks, t.color, t.canvas.clientWidth, 'lane', laneScale(t.peaks));
  });
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) renderRibbon(lane.el.canvas, lane.ribbon, lane.el.canvas.clientWidth, ribbonHeight[stem]);
  }
  renderOverview();
  draw();
}

/** React owns the primary seek canvas node and its listeners; this is the explicit
 * imperative-renderer attachment allowed by the migration architecture. */
function attachPrimarySeekCanvas(canvas) {
  primarySeekCanvas = canvas;
  if (tracks.length) {
    const mp = mixPeaks();
    renderWave(canvas, mp, '#ffffff', canvas.clientWidth, 'main', Math.min(1, laneScale(mp)));
    paint(canvas, duration ? Math.min(1, currentTime() / duration) : 0);
  }
  return () => {
    if (primarySeekCanvas === canvas) primarySeekCanvas = null;
  };
}

/** Stable-id lookup into `tracks`, shared by the id-addressed commands and attach hook below —
 *  React never holds a track object or DOM reference, only the same `laneKey` id the snapshot
 *  already publishes. */
function trackById(id) {
  return tracks.find((t, i) => laneKey(t, i) === id);
}

/** React owns each standard lane's DOM (name/canvas/volume host); this is the explicit
 *  imperative-renderer attachment allowed by the migration architecture, one per lane,
 *  mirroring attachPrimarySeekCanvas. Peak generation, painting, resize, and lane-canvas
 *  seek/scrub (attachSeek) remain entirely app.js's. */
function attachLaneCanvas(trackId, canvas) {
  const t = trackById(trackId);
  if (!t) return () => {};
  t.canvas = canvas;
  if (t.stem === 'drums') tempoDrumsCanvas = canvas;
  attachSeek(canvas, { tempoLane: t.stem === 'drums' });
  if (t.peaks) {
    t.layers = renderWave(canvas, t.peaks, t.color, canvas.clientWidth, 'lane', laneScale(t.peaks));
    paint(canvas, duration ? Math.min(1, currentTime() / duration) : 0);
  }
  return () => {
    if (t.canvas === canvas) t.canvas = null;
    if (tempoDrumsCanvas === canvas) tempoDrumsCanvas = null;
  };
}

/** The drums lane's tempo-range hint (caption + Clear button) is notes/tempo feature UI, not
 *  lane presentation — a permanent, settled split from the React-owned lane chrome (Phase 6
 *  completed without moving this content, and no further migration of it is planned) — but
 *  its host div is only ever rendered by React for the drums `<Lane>` (see PlayerShell.jsx),
 *  so it is populated the same explicit-attach way as attachLaneCanvas rather than being
 *  built inside buildUI() the way it used to be. A no-op for any other lane. */
function attachLaneExtra(trackId, node) {
  const t = trackById(trackId);
  if (!t || t.stem !== 'drums' || !node) return () => {};
  const hintTxt = document.createElement('span');
  hintTxt.className = 'txt';
  const hintClear = document.createElement('button');
  hintClear.className = 'mini';
  hintClear.type = 'button';
  hintClear.textContent = tr('notes.tempoRangeClear');
  hintClear.addEventListener('click', () => {
    tempoRange = null;
    syncTempoRangeHint();
    window.dispatchEvent(new CustomEvent('sansbass:temporange', { detail: null }));
    draw();
  });
  node.append(hintTxt, hintClear);
  tempoHintEl = hintTxt;
  tempoClearBtn = hintClear;
  syncTempoRangeHint();
  return () => {
    if (tempoHintEl === hintTxt) tempoHintEl = null;
    if (tempoClearBtn === hintClear) tempoClearBtn = null;
  };
}

/** React owns the shared Overview lane's DOM (label/time-code/canvas/volume host) since
 *  Phase 4b; this is the explicit imperative-renderer attachment for its canvas, mirroring
 *  attachLaneCanvas — but unlike a per-track lane, the Overview lane isn't keyed to any one
 *  `song.tracks[]` entry, so it never remounts across a song replacement that keeps a
 *  vocals/bass stem. That is exactly why overviewEl is not reset in buildUI(): this function
 *  (and attachOverviewExtra below) are the only things that ever populate or clear it. Peak
 *  combination (overviewStems), painting, resize, and seek/scrub (attachSeek) remain
 *  entirely app.js's. */
function attachOverviewCanvas(canvas) {
  overviewEl.canvas = canvas;
  attachSeek(canvas, { rangeBand: true, overview: true });
  if (tracks.length) {
    renderOverview();
    paint(canvas, duration ? Math.min(1, currentTime() / duration) : 0);
  }
  return () => {
    if (overviewEl.canvas === canvas) overviewEl.canvas = null;
  };
}

/** The Overview lane's full-song range-select caption is notes/edit feature UI, not lane
 *  presentation — a permanent, settled split from the React-owned lane chrome (Phase 6
 *  completed without moving this content, and no further migration of it is planned) — but
 *  its host div is only ever rendered by React (see PlayerShell.jsx), so it is populated the
 *  same explicit-attach way as attachLaneExtra rather than being built inside buildUI() the
 *  way it used to be. Content and visibility stay exactly as syncRangeHints() computes them;
 *  only the DOM host moved. Its own translation-refresh gap (never retranslated on language
 *  switch until the next edit changes it) predates this migration and is an explicitly
 *  accepted pre-existing tradeoff — see docs/react-migration-evidence.md's Phase 7 section —
 *  not something this migration introduced or is expected to fix. */
function attachOverviewExtra(node) {
  if (!node) return () => {};
  node.textContent = tr('notes.rangeTip');
  overviewEl.rangeHint = node;
  syncRangeHints();
  return () => {
    if (overviewEl.rangeHint === node) overviewEl.rangeHint = null;
  };
}

/**
 * Lanes are normalised to their own loudest moment, otherwise a naturally quiet
 * stem (bass, room mics) draws as an unreadable flat line. Capped so a nearly
 * silent stem doesn't get amplified into visual noise.
 */
function laneScale(peaks) {
  let peak = 0;
  for (let b = 0; b < BUCKETS; b++) {
    peak = Math.max(peak, Math.abs(peaks.maxs[b]), Math.abs(peaks.mins[b]));
  }
  if (peak < 1e-4) return 1;
  return Math.min(8, 0.95 / peak);
}

/** Pre-render idle + active versions of a waveform so per-frame drawing is a blit. */
function renderWave(canvas, peaks, color, cssWidth, kind, scale) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round((cssWidth || canvas.clientWidth || 600)));
  const h = kind === 'main' ? 76 : 40;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const make = (stroke, alpha) => {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);
    c.globalAlpha = alpha;
    c.fillStyle = stroke;
    const mid = h / 2;
    const barW = Math.max(1, w / BUCKETS);
    for (let b = 0; b < BUCKETS; b++) {
      const x = (b / BUCKETS) * w;
      const top = Math.max(-1, peaks.mins[b] * scale) * mid;   // negative offset from centre
      const bot = Math.min(1, peaks.maxs[b] * scale) * mid;    // positive offset from centre
      c.fillRect(x, mid + top, barW, Math.max(1, bot - top));
    }
    return off;
  };

  const layers = { idle: make('#6b6b7a', 0.55), active: make(color, 1), h, w };
  canvas.__layers = layers;
  return layers;
}

/** The tracks whose waveform the overview lane should draw: every stem toggled on in the
 *  zoomed pane's lane chips, plus whichever channel's Notes chip is selected (that stem's
 *  plain waveform, never its notes/pitch — the overview never draws detected pitch, see
 *  renderOverview). A Set dedupes the case where a stem is in both. */
function overviewStems() {
  const ids = new Set(zoomLaneSel);
  if (zoomNotesStem) ids.add(zoomNotesStem);
  return [...ids].map((stem) => tracks.find((t) => t.stem === stem)).filter(Boolean);
}

/** Pre-rendered idle + active layers for the overview lane, same blit-and-clip shape as
 *  renderWave — but overlaying every selected stem's full-song peaks in its own colour
 *  (mirroring renderZoom's own multi-stem overlay) rather than one peaks set in one colour.
 *  Less than fully opaque so two overlapping stems blend instead of one hiding the other. */
function renderOverview() {
  if (!overviewEl.canvas) return;
  const canvas = overviewEl.canvas;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth || 600));
  const h = 40;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const stems = overviewStems();
  const make = (colorFor, alpha) => {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);
    c.globalAlpha = alpha;
    const mid = h / 2;
    const barW = Math.max(1, w / BUCKETS);
    for (const t of stems) {
      const scale = laneScale(t.peaks);
      c.fillStyle = colorFor(t);
      for (let b = 0; b < BUCKETS; b++) {
        const x = (b / BUCKETS) * w;
        const top = Math.max(-1, t.peaks.mins[b] * scale) * mid;
        const bot = Math.min(1, t.peaks.maxs[b] * scale) * mid;
        c.fillRect(x, mid + top, barW, Math.max(1, bot - top));
      }
    }
    return off;
  };

  const layers = { idle: make(() => '#6b6b7a', 0.45), active: make((t) => t.color, 0.6), h, w };
  canvas.__layers = layers;
}

const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);      // C# D# F# G# A#
/* Below this many pixels per semitone there is no room for twelve labels and the grid
 * falls back to marking C only. 7 rather than 9 because the pitch range is routinely ~27
 * semitones wide — octave errors stretch it — and 9 pushed the common case into the
 * fallback. See docs/transcription.md on why the range is that wide. */
const LABEL_MIN_PX = 7;

/* Note fill by provenance. Blue for a folded note and gray for one we declined to correct,
 * purple for one a human touched directly (fix.state === 'manual', set by applyEdits in
 * lib/pitch.js — see docs/superpowers/specs/2026-08-31-note-editing-design.md): all three
 * must be distinguishable from an untouched note (green) AND from an out-of-band note (the
 * A-B orange), because "corrected", "untrusted", "hand-edited" and "off-scale" are four
 * different things the reader has to tell apart. Gray recedes without vanishing — a hidden
 * note would be a silent lie, the same rule the orange edge marks follow. */
const NOTE_FILL = {
  plain:  { normal: '#8ee0ad', dim: '#4c8f6c', zoom: 'rgba(142,224,173,.86)' },
  folded: { normal: '#6cc5e0', dim: '#3a7186', zoom: 'rgba(108,197,224,.86)' },
  doubt:  { normal: '#a8a8b8', dim: '#70707f', zoom: 'rgba(168,168,184,.86)' },
  manual: { normal: '#c99bf0', dim: '#6d5183', zoom: 'rgba(201,155,240,.86)' },
};
/* Falls back rather than throwing, because a throw here does not fail loudly: tick() re-arms
 * the rAF chain only AFTER draw() returns, so one bad note freezes the playhead for the rest
 * of playback while the audio keeps going — the "working app looks broken" shape this repo
 * keeps relearning. Any future producer of a `fix` should still set `state`; lib/pitch.js is
 * the only one today and always does. See docs/transcription.md on layer-4 edits. */
const noteFillKey = (n) => (n.fix && NOTE_FILL[n.fix.state] ? n.fix.state : 'plain');   // 'folded' | 'doubt'

/* A note's label: an absolute name, or a scale degree when 簡譜 is on.
 *
 * The octave is deliberately absent from the degree form — it lives on the pitch axis as
 * dots instead of being repeated on every block, which is the whole point of the notation. */
function noteLabel(n, jianpu) {
  if (!jianpu || !jianpu.on) return n.name;
  const d = SansJianpu.degreeOf(n.midi, jianpu.tonic, jianpu.mode);
  return d.accidental + d.digit;
}

/* 簡譜 octave marks: a dot above the number for each octave up, below for each octave down,
 * nothing in the reference octave. Drawn beside the digit rather than centred over it —
 * these labels sit against the lane's left edge and a dot above would collide with the
 * gridline of the semitone above. */
function drawOctaveDots(c, cx, ty, n, semi) {
  const r = Math.max(0.7, Math.min(1.5, semi * 0.08));
  const step = r * 3;
  for (let i = 0; i < Math.abs(n) && i < 3; i++) {
    const dy = (n > 0 ? -1 : 1) * (semi * 0.22 + i * step);
    c.beginPath();
    c.arc(cx, ty + dy, r, 0, Math.PI * 2);
    c.fill();
  }
}

/* Pre-rendered idle/active layers, the same shape renderWave produces, so paint() draws
 * the ribbon with the identical blit-and-clip it uses for every waveform — playhead,
 * A-B shading and all. The layer object must keep the { idle, active, h, w } keys:
 * paint() reads L.w to place the playhead. */
function renderRibbon(canvas, payload, cssWidth, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth || canvas.clientWidth || 600));
  const h = height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const { notes, frames } = payload;
  const [loM, hiM] = SansRibbon.pitchRange(notes, { clip: payload.clip !== false });
  const span = hiM - loM || 1;
  const y = (midi) => h - ((midi - loM) / span) * h;
  // The SAME time-to-x mapping every other lane uses. Anything else drifts on resize.
  const x = (t) => (duration ? t / duration : 0) * w;
  const semi = Math.abs(y(0) - y(1));

  /* Resolved once per render, not once per layer: make() runs twice (idle and active) and
   * referenceOctave walks every note. `home` is the note the grid and the axis both
   * highlight — degree 1 in 簡譜, C otherwise. Keeping those two on different rows in, say,
   * 1=G would half-undo the point of labelling the tonic at all. */
  const jp = payload.jianpu && payload.jianpu.on ? payload.jianpu : null;
  const refOct = jp && SansJianpu
    ? SansJianpu.referenceOctave(notes, jp.tonic) : 0;
  const isHome = (m) => (((m - (jp ? jp.tonic : 0)) % 12) + 12) % 12 === 0;

  const make = (dim) => {
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);

    /* Piano-roll grid: a band per semitone, black keys shaded, a rule on every boundary
     * and a brighter one at each C. This is what turns vertical distance into a pitch you
     * can name rather than a height you have to estimate. */
    const lo = Math.ceil(loM);
    const hi = Math.floor(hiM);
    for (let m = lo; m <= hi; m++) {
      if (!BLACK_KEYS.has(((m % 12) + 12) % 12)) continue;
      const top = y(m + 0.5);
      c.fillStyle = dim ? 'rgba(255,255,255,.022)' : 'rgba(255,255,255,.040)';
      c.fillRect(0, top, w, Math.max(1, y(m - 0.5) - top));
    }
    for (let m = lo; m <= hi + 1; m++) {
      c.fillStyle = isHome(m)
        ? (dim ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.22)')
        : (dim ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.075)');
      c.fillRect(0, Math.round(y(m - 0.5)), w, 1);
    }

    /* The beat/bar grid, purely visual — see docs/transcription.md on why this never
     * touches interpret() or the note list. Bars draw taller/stronger than plain beats. */
    if (payload.tempo && payload.tempo.on) {
      const beats = SansRibbon.beatTimes(payload.tempo, duration);
      for (const b of beats) {
        const bx = Math.round(x(b.t));
        c.fillStyle = b.bar
          ? (dim ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.28)')
          : (dim ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.10)');
        c.fillRect(bx, 0, b.bar ? 2 : 1, h);
      }
    }

    /* Labels overlay the left edge rather than sitting in a gutter. A gutter would move
     * x = 0 away from t = 0 and the ribbon would stop lining up with the waveform lanes,
     * which is the one property every other decision here protects. */
    if (semi >= 6) {
      const everySemitone = semi >= LABEL_MIN_PX;
      c.font = `500 ${Math.min(10, Math.max(8, semi * 0.62)).toFixed(1)}px ui-monospace, Menlo, monospace`;
      c.textBaseline = 'middle';
      for (let m = lo; m <= hi; m++) {
        const pc = ((m % 12) + 12) % 12;
        /* When the lane is too tight for every semitone, only the home note is labelled.
         * In 簡譜 that is degree 1 — the tonic — not C. Labelling C in every key would be
         * meaningless in, say, 1=G. */
        const home = isHome(m);
        if (!everySemitone && !home) continue;
        let label;
        let dots = 0;
        if (jp && SansJianpu) {
          const d = SansJianpu.degreeOf(m, jp.tonic, jp.mode);
          label = d.accidental + d.digit;
          dots = d.octaveIndex - refOct;
        } else {
          label = NOTE_LETTERS[pc] + (Math.floor(m / 12) - 1);
        }
        const ty = y(m);
        const tw = c.measureText(label).width;
        c.fillStyle = dim ? 'rgba(13,13,16,.72)' : 'rgba(13,13,16,.82)';
        c.fillRect(0, ty - semi / 2, tw + 7, semi);
        c.fillStyle = home
          ? (dim ? '#7b7b8b' : '#c9c9d6')
          : (dim ? '#5d5d6b' : '#8a8a99');
        c.fillText(label, 3, ty + 0.5);
        if (dots) drawOctaveDots(c, 3 + tw + 2.5, ty, dots, semi);
      }
    }

    /* One column holds many frames at this width, so the contour is drawn as a per-pixel
     * band rather than a polyline. A polyline here joins pitches that are ~26 frames
     * apart and fills the lane with near-vertical strokes — it buried the notes entirely.
     * The zoomed view, where a column is a frame or less, draws the line properly. */
    /* Deliberately faint. At whole-song width a column spans ~0.3 s and, with octave
     * errors in the data, routinely covers most of the lane — drawn at full strength it
     * drowns the notes it is supposed to support. This view is for navigation; the zoomed
     * pane is where the contour is read. */
    c.fillStyle = dim ? 'rgba(109,157,192,.16)' : 'rgba(109,157,192,.30)';
    const cols = SansRibbon.contourColumns(frames, duration, w);
    for (let x = 0; x < cols.length; x++) {
      const col = cols[x];
      if (!col) continue;
      const top = y(col.hi);
      c.fillRect(x, top, 1, Math.max(1, y(col.lo) - top));
    }

    for (const n of notes) {
      const out = n.midi < loM || n.midi > hiM;
      const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
      const bh = out ? 3 : Math.max(3, semi * 0.8);
      const bw = Math.max(2, x(n.end) - x(n.start));
      // A clipped note keeps its position in time but loses its pitch, so it is drawn in
      // the A-B orange rather than dropped — a hidden note would be a silent lie.
      const fill = NOTE_FILL[noteFillKey(n)];
      c.fillStyle = out ? (dim ? '#8a5c17' : '#ff9f1c') : (dim ? fill.dim : fill.normal);
      c.fillRect(x(n.start), by, bw, bh);

      /* The name only when it fits. Clipping text to a block narrower than the glyphs
       * produces a smear that reads as corruption rather than as a label — and note names
       * are never translated, in any locale, exactly as stem ids and filenames are not. */
      /* Reachable only on a short file: at whole-song width a note is ~2 px, so this lane
       * draws no block labels at all and the threshold never fires. The zoomed pane is
       * where degrees actually appear on blocks. */
      const minLabelPx = (payload.jianpu && payload.jianpu.on) ? 14 : 26;
      if (!out && bw > minLabelPx && bh > 9) {
        c.fillStyle = dim ? '#1a1a20' : '#0d0d10';
        c.font = '600 9px ui-monospace, Menlo, monospace';
        c.textBaseline = 'middle';
        c.fillText(noteLabel(n, payload.jianpu), x(n.start) + 3, by + bh / 2 + 0.5);
      }
    }
    return off;
  };

  canvas.__layers = { idle: make(true), active: make(false), h, w };
  return canvas.__layers;
}

/* The zoomed pane is drawn LIVE every frame rather than pre-rendered into layers: its
 * window moves continuously, so there is nothing stable to cache. The cost is bounded —
 * one column per pixel of waveform, plus only the notes and frames inside the window. */
function renderZoom(canvas) {
  if (!duration) return;
  const ribbon = currentRibbon();   // the SELECTED channel — null if no chip is selected
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth || 600));
  const h = zoomHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const win = SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);
  const span = win.to - win.from || 1;
  const x = (t) => ((t - win.from) / span) * w;

  /* Whether a channel is selected. When it is, the note blocks are the thing this pane
   * exists to show, so every selected stem's waveform behind them renders gray instead of
   * competing in colour. When it's off there's nothing pitched to plot, so the whole
   * pitch-grid/contour/note-block machinery below is skipped in favour of each selected
   * waveform in its own stem colour — see the lane selector this draws for (app.js's zLane
   * construction) and docs/behaviour.md. The beat/bar grid further below is independent of
   * this — it reads `anyRibbon()`, not `ribbon`, so it keeps drawing either way. */
  const showNotes = !!ribbon;
  const notes = ribbon ? ribbon.notes : null;
  const frames = ribbon ? ribbon.frames : null;
  let loM, hiM, y, semi;
  if (showNotes) {
    [loM, hiM] = SansRibbon.pitchRange(notes, { clip: ribbon.clip !== false });
    const pitchSpan = hiM - loM || 1;
    y = (midi) => h - ((midi - loM) / pitchSpan) * h;
    semi = Math.abs(y(0) - y(1));
  }

  c.fillStyle = '#141419';
  c.fillRect(0, 0, w, h);

  /* A resting-state hint for the range-select band, drawn even with nothing dragged or
   * selected — otherwise the strip is only visible once you already know to look for it.
   * Faint enough not to compete with the brighter, more saturated rsel highlight below.
   * The range-select band deletes NOTES, so it (and the selection drawn below it) only
   * make sense while notes are actually in view. */
  if (showNotes && editMode) {
    c.fillStyle = 'rgba(255,209,102,.07)';
    c.fillRect(0, h - RULER_BAND_PX, w, RULER_BAND_PX);
    c.strokeStyle = 'rgba(255,209,102,.4)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h - RULER_BAND_PX + 0.5);
    c.lineTo(w, h - RULER_BAND_PX + 0.5);
    c.stroke();
  }

  const rsel = showNotes ? (rangeDrag || rangeSelection) : null;
  if (rsel) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect(x(s), 0, Math.max(1, x(eT) - x(s)), h);
  }

  /* Every selected stem's waveform, behind everything else, from its high-resolution
   * peaks: gray while notes are in view (so the note blocks stay the colourful thing),
   * each in its own stem colour when notes are off — see toggleZoomNotes. */
  const mid = h / 2;
  for (const stem of zoomLaneSel) {
    if (stem === 'notes') continue;
    const peaks = ensureZoomPeaks(stem);
    if (!peaks) continue;
    const t = tracks.find((tr) => tr.stem === stem);
    c.fillStyle = showNotes ? 'rgba(255,255,255,.10)' : hexToRgba(t?.color || '#ffffff', 0.55);
    for (let px = 0; px < w; px++) {
      const tm = win.from + (px / w) * span;
      const b = Math.floor(tm * peaks.bps);
      if (b < 0 || b >= peaks.mins.length) continue;
      const top = mid + Math.max(-1, peaks.mins[b]) * mid;
      const bot = mid + Math.min(1, peaks.maxs[b]) * mid;
      c.fillRect(px, top, 1, Math.max(1, bot - top));
    }
  }

  /* The beat/bar grid, independent of whether a Notes chip is selected — it's a tempo
   * reference for whatever waveform(s) are on screen, not something the pitch view owns.
   * Reads anyRibbon() rather than the selected `ribbon`: tempo is the same shared object in
   * every channel's payload, so this must keep drawing even with nothing selected — the
   * whole reason `showNotes` and this block use two different sources. Drawn over the
   * waveform but under the pitch grid/note blocks, same order as before this was pulled out
   * of the showNotes block. */
  const tempoRibbon = ribbon ?? anyRibbon();
  if (tempoRibbon && tempoRibbon.tempo && tempoRibbon.tempo.on) {
    const beats = SansRibbon.beatTimes(tempoRibbon.tempo, duration);
    for (const b of beats) {
      if (b.t < win.from || b.t > win.to) continue;
      const bx = x(b.t);
      c.fillStyle = b.bar ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.12)';
      c.fillRect(bx, 0, b.bar ? 2 : 1, h);
    }

    /* Sub-beat dotted lines, gated behind the ½/¼ toggle buttons beside the zoom controls —
     * off by default, since quarter-beat ticks are clutter until asked for. Quarter drawn
     * first, fainter, since it already includes the half-beat point at its centre; half
     * drawn on top of it in a slightly stronger dash. */
    if (showQuarterBeat || showHalfBeat) {
      const drawDotted = (t, color) => {
        const bx = Math.round(x(t)) + 0.5;
        c.strokeStyle = color;
        c.beginPath();
        c.moveTo(bx, 0);
        c.lineTo(bx, h);
        c.stroke();
      };
      c.lineWidth = 1;
      c.setLineDash([2, 2]);
      if (showQuarterBeat) {
        for (const t of SansRibbon.subdivisionTimes(tempoRibbon.tempo, duration, 4)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.07)');
        }
      }
      if (showHalfBeat) {
        for (const t of SansRibbon.subdivisionTimes(tempoRibbon.tempo, duration, 2)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.14)');
        }
      }
      c.setLineDash([]);
    }
  }

  if (showNotes) {
    // Piano-roll grid, same language as the lane.
    const lo = Math.ceil(loM);
    const hi = Math.floor(hiM);
    for (let m = lo; m <= hi; m++) {
      if (!BLACK_KEYS.has(((m % 12) + 12) % 12)) continue;
      const top = y(m + 0.5);
      c.fillStyle = 'rgba(255,255,255,.040)';
      c.fillRect(0, top, w, Math.max(1, y(m - 0.5) - top));
    }
    /* Same 簡譜 resolution as the lane, and for the same reasons — see renderRibbon. This is
     * the pane a pitch is actually read off, so leaving its axis in note names while its
     * blocks drew degrees put both notations side by side in the one view where it matters. */
    const jp = ribbon.jianpu && ribbon.jianpu.on ? ribbon.jianpu : null;
    const refOct = jp && SansJianpu
      ? SansJianpu.referenceOctave(notes, jp.tonic) : 0;
    const isHome = (m) => (((m - (jp ? jp.tonic : 0)) % 12) + 12) % 12 === 0;

    for (let m = lo; m <= hi + 1; m++) {
      c.fillStyle = isHome(m) ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.075)';
      c.fillRect(0, Math.round(y(m - 0.5)), w, 1);
    }

    /* Names, overlaid at the left rather than in a gutter — same reason as the lane: a
     * gutter moves the window's left edge away from win.from. This is the view you read a
     * pitch off, so it labels every semitone the moment there is room. */
    if (semi >= 6) {
      const everySemitone = semi >= LABEL_MIN_PX;
      c.font = `500 ${Math.min(10, Math.max(8, semi * 0.62)).toFixed(1)}px ui-monospace, Menlo, monospace`;
      c.textBaseline = 'middle';
      for (let m = lo; m <= hi; m++) {
        const pc = ((m % 12) + 12) % 12;
        const home = isHome(m);
        if (!everySemitone && !home) continue;
        let label;
        let dots = 0;
        if (jp && SansJianpu) {
          const d = SansJianpu.degreeOf(m, jp.tonic, jp.mode);
          label = d.accidental + d.digit;
          dots = d.octaveIndex - refOct;
        } else {
          label = NOTE_LETTERS[pc] + (Math.floor(m / 12) - 1);
        }
        const ty = y(m);
        const tw = c.measureText(label).width;
        c.fillStyle = 'rgba(13,13,16,.82)';
        c.fillRect(0, ty - semi / 2, tw + 7, semi);
        c.fillStyle = home ? '#c9c9d6' : '#8a8a99';
        c.fillText(label, 3, ty + 0.5);
        if (dots) drawOctaveDots(c, 3 + tw + 2.5, ty, dots, semi);
      }
    }

    /* Here a column is a frame or less, so the contour is a real line rather than the
     * per-pixel band the full-width lane has to fall back on. */
    c.strokeStyle = '#7fb2d9';
    c.lineWidth = 1.6;
    c.lineJoin = 'round';
    const dt = frames.frameSeconds;
    const i0 = Math.max(0, Math.floor(win.from / dt) - 1);
    const i1 = Math.min(frames.cents.length - 1, Math.ceil(win.to / dt) + 1);
    c.beginPath();
    let drawing = false;
    for (let i = i0; i <= i1; i++) {
      const cents = frames.cents[i];
      if (!cents) { drawing = false; continue; }
      const px = x(frames.t[i]);
      const py = y(cents / 100);
      if (!drawing) { c.moveTo(px, py); drawing = true; } else c.lineTo(px, py);
    }
    c.stroke();

    for (const n of notes) {
      const live = noteDrag && noteDrag.note === n
        ? { start: noteDrag.previewStart, end: noteDrag.previewEnd } : n;
      if (live.end < win.from || live.start > win.to) continue;
      const out = n.midi < loM || n.midi > hiM;
      const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
      const bh = out ? 3 : Math.max(3, semi * 0.8);
      const bw = Math.max(2, x(live.end) - x(live.start));
      c.fillStyle = out ? '#ff9f1c' : NOTE_FILL[noteFillKey(n)].zoom;
      c.fillRect(x(live.start), by, bw, bh);
      const minLabelPx = (ribbon.jianpu && ribbon.jianpu.on) ? 14 : 26;
      if (!out && bw > minLabelPx && bh > 9) {
        c.fillStyle = '#0d0d10';
        c.font = '600 10px ui-monospace, Menlo, monospace';
        c.textBaseline = 'middle';
        c.fillText(noteLabel(n, ribbon.jianpu), x(live.start) + 3, by + bh / 2 + 0.5);
      }
      /* The selected note gets a white outline in addition to its fill — "outline plus fill"
       * is the same language buttons and inputs use for focus elsewhere in this app. */
      if (editMode && selectedNote && n.midi === selectedNote.midi &&
          live.start <= selectedNote.at && selectedNote.at < live.end) {
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.5;
        c.strokeRect(x(live.start) + 0.75, by + 0.75, Math.max(0.5, bw - 1.5), Math.max(0.5, bh - 1.5));
        // Small edge tabs — the visual affordance for the drag target pointerdown tests above.
        c.fillStyle = '#ffffff';
        const hw = 3;
        c.fillRect(x(live.start) - hw / 2, by, hw, bh);
        c.fillRect(x(live.end) - hw / 2, by, hw, bh);
      }
    }

    if (addDrag) {
      const s = Math.min(addDrag.startT, addDrag.curT);
      const eT = Math.max(addDrag.startT, addDrag.curT);
      const by2 = y(addDrag.midi + 0.5);
      c.fillStyle = 'rgba(201,155,240,.5)';
      c.fillRect(x(s), by2, Math.max(2, x(eT) - x(s)), Math.max(3, semi * 0.8));
    }
  }

  /* Chords belong to time, not to either pitch lane. Draw this after the waveform and notes
   * so its compact half-bar band stays readable with either view selected. */
  if (chordTimeline.length) {
    c.fillStyle = 'rgba(13,13,16,.78)';
    c.fillRect(0, 0, w, 20);
    c.font = '700 11px ui-monospace, Menlo, monospace';
    c.textBaseline = 'middle';
    for (const chord of chordTimeline) {
      if (chord.end <= win.from || chord.start >= win.to) continue;
      const left = Math.max(0, x(chord.start));
      if (chord.label) {
        c.fillStyle = chord.edited ? '#c99bf0'
          : chord.candidates?.length > 1 ? '#ffd166' : '#5ecbff';
        c.fillText(transposeChordLabel(chord.label, -capo), left + 4, 10);
      }
      /* Continue the tempo grid through the opaque chord band: strong full-bar lines and
       * lighter half-bar boundaries make adjacent chord windows visibly distinct. */
      c.fillStyle = chord.barStart ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.18)';
      c.fillRect(left, 0, chord.barStart ? 2 : 1, 20);
    }
    const last = chordTimeline[chordTimeline.length - 1];
    if (last.end >= win.from && last.end <= win.to) {
      c.fillStyle = 'rgba(255,255,255,.42)';
      c.fillRect(Math.min(w - 2, x(last.end)), 0, 2, 20);
    }
  }

  // Time ruler, one label per second while there is room for it.
  c.fillStyle = '#8a8a99';
  c.font = '400 9px ui-monospace, Menlo, monospace';
  c.textBaseline = 'bottom';
  const step = span <= 6 ? 1 : span <= 20 ? 2 : 5;
  for (let t = Math.ceil(win.from / step) * step; t <= win.to; t += step) {
    c.fillRect(x(t), h - 9, 1, 5);
    c.fillText(fmt(t), x(t) + 3, h - 1);
  }

  const now = currentTime();
  if (now >= win.from && now <= win.to) {
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.fillRect(x(now), 0, 1.5, h);
  }
}

function draw() {
  const t = currentTime();
  const frac = duration ? Math.min(1, t / duration) : 0;
  if (primarySeekCanvas) paint(primarySeekCanvas, frac);
  tracks.forEach(tr => { if (tr.canvas) paint(tr.canvas, frac); });
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) paint(lane.el.canvas, frac);
  }
  // Shown next to every time-code (main transport, Overview lane, Zoom lane) so the
  // current rate stays visible without looking back at the speed slider.
  const speedTag = `${ratePercent}%`;
  // The BPM a metronome would need to match this song at the CURRENT speed, next to the
  // BPM notes.js actually detected (or the user's manual override — tempoInfo.bpmValue is
  // that value either way, see refreshTempo() in notes.js). Absent until a drums stem has
  // been analysed with a confident result, same gate as the tempo panel itself.
  const haveBpm = tempoInfo && tempoInfo.confidence > 0;
  const bpmText = haveBpm
    ? `${(tempoInfo.bpmValue * ratePercent / 100).toFixed(1)}/${tempoInfo.bpmValue.toFixed(1)} BPM`
    : '';
  const timeCode = `${fmtCs(t)}/${fmt(duration)} · ${speedTag}` + (haveBpm ? ` · ${bpmText}` : '');
  // The Overview lane's own time-code text is React-owned since Phase 4b, computed from the
  // published transport snapshot the same way PrimarySeekControls already does — only its
  // canvas painting stays here.
  if (overviewEl.canvas) paint(overviewEl.canvas, frac);
  if (zoomEl) {
    // Follow while playing; when stopped the window is wherever it was dragged to.
    if (playing) zoomCenter = t;
    renderZoom(zoomEl.canvas);
    zoomEl.out.textContent = `${zoomSeconds.toFixed(zoomSeconds < 10 ? 1 : 0)}s`;
    zoomEl.time.textContent = timeCode;
  }
  if (editMode) syncEditToolbar();
  playerApplication.publishTransport();
  playerApplication.publishChord();
}

/** The capo control's and chord editor's published presentation — same "recompute every
 *  frame, publish only on change" shape draw()'s playerApplication.publishTransport() call
 *  already uses for the transport clock (see docs/react-phase-6f-capo-chord-editor-plan.md).
 *  `chordSegmentStart` is the one field this function updates that no component reads — only
 *  the commitChord command handler does, the same role chordEditor.segmentStart used to
 *  play. */
function applicationChordSnapshot() {
  const time = currentTime();
  const chord = chordTimeline.find((item) => item.start <= time && time < item.end) || null;
  const busy = chordDetectionPhase !== null;
  chordSegmentStart = chord ? chord.start : null;
  const candidatesVisible = !!chord && !busy && chord.candidates?.length > 1;
  return {
    visible: !!chord || busy,
    busy,
    busyPhase: chordDetectionPhase,
    capo,
    playKeyLetter: detectedKey ? NOTE_LETTERS[transposePitchClass(detectedKey.tonicPc, -capo)] : null,
    inputVisible: !!chord && !busy,
    inputValue: chord ? (transposeChordLabel(chord.label, -capo) || '') : '',
    inputAmbiguous: !!(chord && !chord.edited && chord.candidates?.length > 1),
    inputEdited: !!(chord && chord.edited),
    candidatesVisible,
    candidates: candidatesVisible ? chord.candidates.map((candidate) => {
      const value = transposeChordLabel(candidate.label, -capo);
      return { value, label: `${value} (${candidate.confidence.toFixed(2)})` };
    }) : [],
    redetectVisible: !!chord && !busy,
  };
}

window.addEventListener('sansbass:chords', (event) => {
  chordTimeline = Array.isArray(event.detail?.chords) ? event.detail.chords : [];
  chordDetectionPhase = event.detail?.phase
    || (event.detail?.running ? 'detecting' : null);
  capo = Number(event.detail?.capo) || 0;
  detectedKey = event.detail?.key || null;
  draw();
});

/** Keeps the toolbar's enabled state in sync with the current selection. Called from draw(),
 *  so no handler needs to call it by hand — every edit round-trips through notes.js and back
 *  into setNotes(), which calls draw(). Also clears a selection whose note is gone. */
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const ribbon = currentRibbon();
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del, zoomToolbar.fieldStart,
                    zoomToolbar.fieldEnd, zoomToolbar.fieldPitchLetter,
                    zoomToolbar.fieldPitchAccidental, zoomToolbar.fieldPitchOctave,
                    zoomToolbar.applyBtn]) {
    b.disabled = !sel;
  }
  const gridOn = !!(ribbon && ribbon.tempo && ribbon.tempo.on);
  const commands = commandState({ note: sel, range: rangeSelection, gridOn });
  zoomToolbar.snapNote.disabled = !commands.noteSnap;
  zoomToolbar.rangeDel.disabled = !commands.rangeDelete;
  zoomToolbar.rangeSnap.disabled = !commands.rangeSnap;
  syncNoteFields(sel);
}

/** Keeps Start/End in step with the selected note without clobbering an in-progress keystroke
 *  — same guard as before, just with Pitch removed from the focus-check array, since Pitch is
 *  no longer a text field a user can be mid-typing into (see syncPitchDropdowns' own comment
 *  for why it doesn't need this guard at all). A rewrite only happens when the selection's
 *  identity ({at, midi}) differs from fieldsShownFor — the same note staying selected is a
 *  no-op here, which is what actually protects a mid-type value from draw()'s per-frame calls
 *  today (the input exclusion in the top-level `keydown` handler, see app.js ~2144, keeps a
 *  hotkey from changing `selectedNote` while a field has focus). The `document.activeElement`
 *  check below is defense-in-depth on top of that: it only applies in the *routine* per-frame
 *  path (fieldsShownFor already set), so a future call site that changes `selectedNote` while
 *  a field is focused — without going through that keydown guard — still can't clobber it. It
 *  does NOT apply to the *forced* refresh path: commitFields resets fieldsShownFor = null
 *  right after a commit specifically so the rewrite goes through even though the field the
 *  user just pressed Enter in is still focused at that exact moment — that's what makes a
 *  reverted/updated value visibly snap back. Gating the focus check on fieldsShownFor being
 *  non-null is what keeps those two paths apart. See docs/superpowers/specs/
 *  2026-09-01-note-inline-fields-design.md ("Refresh vs. typing"). */
function syncNoteFields(sel) {
  if (!sel) {
    if (fieldsShownFor !== null) {
      zoomToolbar.fieldStart.value = '';
      zoomToolbar.fieldEnd.value = '';
      fieldsShownFor = null;
    }
    return;
  }
  syncPitchDropdowns(sel);
  const key = { at: selectedNote.at, midi: selectedNote.midi };
  if (fieldsShownFor) {
    const sameNote = fieldsShownFor.at === key.at && fieldsShownFor.midi === key.midi;
    const focused = document.activeElement;
    const fieldFocused = focused === zoomToolbar.fieldStart || focused === zoomToolbar.fieldEnd;
    if (sameNote || fieldFocused) return;
  }
  zoomToolbar.fieldStart.value = fmtPrecise(sel.start);
  zoomToolbar.fieldEnd.value = fmtPrecise(sel.end);
  fieldsShownFor = key;
}

/** Keeps the three Pitch dropdowns in step with the selected note on EVERY sync tick, with no
 *  identity or focus guard — unlike Start/End, a <select>'s displayed value only ever changes
 *  through an explicit choice, and the moment that choice fires its change event it's already
 *  being committed (see commitPitchDropdown). There's no "mid-keystroke" state to protect, so
 *  re-syncing to the about-to-be-identical current note's values on the very next tick is a
 *  harmless no-op, not a clobber. sel.name is always a sharp-or-natural spelling (same as
 *  noteName() produces), never a flat — the accidental dropdown's "b" option is for typing a
 *  NEW value, not something an unedited note's spelling ever shows. */
function syncPitchDropdowns(sel) {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(sel.name);
  if (!m) return;
  zoomToolbar.fieldPitchLetter.value = m[1];
  zoomToolbar.fieldPitchAccidental.value = m[2];
  zoomToolbar.fieldPitchOctave.value = m[3];
}

function paint(canvas, frac) {
  const L = canvas.__layers;
  if (!L) return;
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(L.idle, 0, 0);
  const px = Math.round(frac * L.w * dpr);
  if (px > 0) {
    c.save();
    c.beginPath();
    c.rect(0, 0, px, canvas.height);
    c.clip();
    c.drawImage(L.active, 0, 0);
    c.restore();
  }
  if (tracks.some((t) => t.canvas === canvas)) paintLaneGrid(c, canvas, dpr);
  paintLoopRegion(c, canvas, dpr, canvas === primarySeekCanvas);
  const selLane = zoomNotesStem && noteLanes[zoomNotesStem];
  if (selLane && canvas === selLane.el.canvas) paintRangeBand(c, canvas, dpr);
  if (overviewEl.canvas && canvas === overviewEl.canvas) paintRangeBand(c, canvas, dpr);
  if (tempoDrumsCanvas && canvas === tempoDrumsCanvas) paintTempoRangeBand(c, canvas, dpr);

  c.fillStyle = 'rgba(255,255,255,.85)';
  c.fillRect(px, 0, Math.max(1, dpr), canvas.height);
}

/** Faint bar lines across a stem lane's own waveform, so a hit lines up with the same grid
 *  drawn on the notes lane above. Bars only — beat ticks at lane width are often only a few
 *  pixels apart and would be pure clutter on top of an already-busy waveform — and much
 *  fainter than the ribbon's version, since a lane has no dim/active distinction to fall back
 *  on. Drawn live here rather than baked into renderWave's cached idle/active layers: those
 *  are shared across every lane and expensive to rebuild (1400 buckets each), so redrawing
 *  them on every BPM/phase keystroke would undercut the "live, no re-analysis" property the
 *  notes-lane grid already has. Live redraw costs nothing extra — draw() already repaints
 *  every lane on every tempo edit via setNotes(), same as it does every rAF tick. */
function paintLaneGrid(c, canvas, dpr) {
  const ribbon = anyRibbon();   // shared tempo — any channel that has notes answers the same
  if (!ribbon || !ribbon.tempo || !ribbon.tempo.on || !duration) return;
  const w = canvas.width;
  const h = canvas.height;
  const beats = SansRibbon.beatTimes(ribbon.tempo, duration);
  c.fillStyle = 'rgba(255,255,255,.06)';
  for (const b of beats) {
    if (!b.bar) continue;
    const bx = Math.round((b.t / duration) * w);
    c.fillRect(bx, 0, Math.max(1, dpr), h);
  }
}

/** Shade everything outside A-B and mark the boundaries. */
function paintLoopRegion(c, canvas, dpr, withLabels) {
  if (loopA === null && loopB === null) return;
  if (!duration) return;
  const w = canvas.width;
  const h = canvas.height;
  const xa = loopA !== null ? (loopA / duration) * w : null;
  const xb = loopB !== null ? (loopB / duration) * w : null;

  if (xa !== null && xb !== null) {
    c.fillStyle = 'rgba(9,9,12,.62)';
    c.fillRect(0, 0, xa, h);
    c.fillRect(xb, 0, w - xb, h);
  }

  c.fillStyle = '#ff9f1c';
  const mark = Math.max(1, 1.5 * dpr);
  if (xa !== null) c.fillRect(xa - mark / 2, 0, mark, h);
  if (xb !== null) c.fillRect(xb - mark / 2, 0, mark, h);

  if (withLabels) {
    c.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`;
    c.textBaseline = 'top';
    if (xa !== null) { c.fillRect(xa, 0, 13 * dpr, 13 * dpr); c.fillStyle = '#0d0d10';
                       c.fillText('A', xa + 3.5 * dpr, 2 * dpr); c.fillStyle = '#ff9f1c'; }
    if (xb !== null) { c.fillRect(xb - 13 * dpr, 0, 13 * dpr, 13 * dpr); c.fillStyle = '#0d0d10';
                       c.fillText('B', xb - 9.5 * dpr, 2 * dpr); }
  }
}

/** The range-select band on the full-song notes lane: a faint resting-state strip whenever
 *  edit mode is on (so the interactive area is discoverable at rest, same as the zoomed
 *  pane's), plus a brighter highlight while a range is being dragged or sits committed.
 *  Drawn directly on the live canvas, like paintLoopRegion, so a drag doesn't force
 *  renderRibbon to rebuild its cached idle/active layers on every pointermove. */
function paintRangeBand(c, canvas, dpr) {
  const w = canvas.width;
  const h = canvas.height;
  if (editMode) {
    c.fillStyle = 'rgba(255,209,102,.07)';
    c.fillRect(0, h - RULER_BAND_PX * dpr, w, RULER_BAND_PX * dpr);
    c.strokeStyle = 'rgba(255,209,102,.4)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h - RULER_BAND_PX * dpr + 0.5);
    c.lineTo(w, h - RULER_BAND_PX * dpr + 0.5);
    c.stroke();
  }
  const rsel = rangeDrag || rangeSelection;
  if (rsel && duration) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect((s / duration) * w, 0, Math.max(1, ((eT - s) / duration) * w), h);
  }
}

/** The whole-lane drag surface on the drums stem: a faint resting-state tint while armed
 *  (unlike paintRangeBand's bottom-strip-only hint — there is no competing gesture on this
 *  lane, so the whole thing is fair game), plus a brighter highlight while dragging or
 *  committed. Same drawn-on-the-live-canvas reasoning as paintRangeBand: a drag must not
 *  force renderWave to rebuild this lane's cached idle/active layers every pointermove. */
function paintTempoRangeBand(c, canvas, dpr) {
  const w = canvas.width;
  const h = canvas.height;
  if (tempoRangeArmed) {
    c.fillStyle = 'rgba(255,209,102,.07)';
    c.fillRect(0, 0, w, h);
  }
  const rsel = tempoRangeDrag || tempoRange;
  if (rsel && duration) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect((s / duration) * w, 0, Math.max(1, ((eT - s) / duration) * w), h);
  }
}

// ---------------------------------------------------------------- transport

/** A-B repeat is armed only when both points exist and enclose a usable span. */
function loopOn() {
  return SansLoopState.isLoopActive({ a: loopA, b: loopB });
}

function currentTime() {
  if (!playing) return offset;
  const elapsed = audio.currentTime - startedAt;
  if (elapsed <= 0) return offset;
  return SansTransportMath.currentTimeAtRate({
    offset, elapsed, ratePercent,
    loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null, duration,
  });
}

/** One AudioWorkletNode per stem, fed a COPY of its decoded PCM (the worklet cannot read
 *  the main-thread AudioBuffer directly — see the design spec's "Memory cost" section) and
 *  started at the same t0/LOOKAHEAD scheduling the native path uses, so every stretch node
 *  stays sample-locked to its siblings the same way native BufferSources do today. */
function createStretchNode(t, willLoop, t0) {
  const node = new AudioWorkletNode(audio, 'stretch-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [t.buffer.numberOfChannels],
  });
  const channels = [];
  for (let ch = 0; ch < t.buffer.numberOfChannels; ch++) {
    channels.push(new Float32Array(t.buffer.getChannelData(ch)));
  }
  node.port.postMessage({ type: 'load', channels }, channels.map(c => c.buffer));
  node.port.postMessage({
    type: 'start',
    t0,
    offsetSample: Math.round(offset * audio.sampleRate),
    loopASample: willLoop ? Math.round(loopA * audio.sampleRate) : null,
    loopBSample: willLoop ? Math.round(loopB * audio.sampleRate) : null,
    rate: ratePercent / 100,
  });
  node.connect(t.gain);
  return node;
}

async function play() {
  if (!tracks.length) return;
  ensureAudio();
  const myGen = ++playGen;

  const looping = loopOn();
  if (looping) {
    // Confine the playhead to the loop, so pressing B at the end of a phrase
    // jumps straight back to A the way a musician expects.
    if (offset < loopA || offset >= loopB) offset = loopA;
  } else if (offset >= duration - 0.01) {
    offset = 0;
  }

  const stretched = ratePercent !== 100;
  if (stretched) {
    try { await workletReady; } catch (err) {
      console.error('sans_bass: stretch worklet failed to load', err);
      throw err;
    }
    if (myGen !== playGen) return;   // stopped or replaced while the module was loading
  }

  const t0 = audio.currentTime + LOOKAHEAD;
  const longest = tracks.reduce((a, b) => (b.buffer.duration > a.buffer.duration ? b : a));
  const loopPlans = SansLoopState.loopPlan(
    tracks.map((track) => track.buffer.duration),
    { a: loopA, b: loopB },
  );

  if (stretched) {
    stretchNodes = tracks.map((t, index) => {
      if (offset >= t.buffer.duration) return null;
      const willLoop = loopPlans[index].loop;
      const node = createStretchNode(t, willLoop, t0);
      if (t === longest && !willLoop) {
        node.port.onmessage = (e) => { if (e.data.type === 'ended' && playing) stop(false); };
      }
      return node;
    }).filter(Boolean);
    sources = [];
  } else {
    sources = tracks.map((t, index) => {
      if (offset >= t.buffer.duration) return null;   // this stem already ended
      const src = audio.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);

      // Loop on the audio thread rather than in JS: sample-accurate, identical across
      // every stem, and it keeps running when the tab is in the background.
      // A stem shorter than loopEnd would wrap at its own end and drift out of sync,
      // so it is left unlooped and simply falls silent instead.
      if (loopPlans[index].loop) {
        src.loop = true;
        src.loopStart = loopPlans[index].loopStart;
        src.loopEnd = loopPlans[index].loopEnd;
      }

      // End of song is detected on the audio graph, not in the animation loop:
      // rAF is paused in background tabs, so the loop can't be trusted for transport.
      // A looping source never ends, so this only ever fires when not looping.
      if (t === longest && !src.loop) src.onended = () => { if (playing) stop(false); };
      src.start(t0, offset);
      return src;
    }).filter(Boolean);
    stretchNodes = [];
  }

  startedAt = t0;
  playing = true;
  applyGains();
  announceTransport(t0);
  playerApplication.publish();
  tick();
}

/* Permanent cross-module clock bridge for the two notes.js sonifiers (no other clock source
 * exists, and none is planned). It carries t0 and offset rather than "we started": the synth
 * has to schedule against the SAME clock reading the stems were started from, or it lands
 * near them instead of with them. */
function announceTransport(t0) {
  window.dispatchEvent(new CustomEvent('sansbass:transport', {
    detail: {
      playing,
      t0: t0 ?? 0,
      offset,
      loopA: loopOn() ? loopA : null,
      loopB: loopOn() ? loopB : null,
      rate: ratePercent / 100,
    },
  }));
}

function stop(keepPosition) {
  if (playing) offset = currentTime();
  playGen++;   // invalidate any play() still awaiting the worklet module
  // Detach onended first so our own stop() doesn't re-enter through it.
  sources.forEach(s => { s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); });
  sources = [];
  stretchNodes.forEach(n => { n.port.onmessage = null; n.disconnect(); });
  stretchNodes = [];
  playing = false;
  cancelAnimationFrame(raf);
  if (!keepPosition) offset = 0;
  announceTransport(0);
  draw();
  playerApplication.publish();
}

function toggle() {
  if (!playing) gcOnce('play');   // the bounce gate: did this visitor ever start audio?
  return playing ? stop(true) : play();
}

function seek(seconds) {
  gcBump('seek');
  const wasPlaying = playing;
  if (playing) stop(true);
  offset = Math.max(0, Math.min(duration, seconds));
  // While A-B repeat is armed the transport stays inside the loop; clear it to roam.
  if (loopOn()) offset = Math.max(loopA, Math.min(loopB - 0.001, offset));
  /* Bring the zoomed window along, but only when the playhead has left it. Recentring on
   * every seek would yank the view sideways when you click INSIDE the zoom pane, which is
   * the one place you were already looking. */
  /* Once a static import, this guard is unreachable-false: if lib/ribbon.js had failed to
   * load, app.js's module would never have evaluated far enough to run this check. */
  if (duration) {
    const win = SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);
    if (offset < win.from || offset > win.to) zoomCenter = offset;
  }
  if (wasPlaying) return play();
  draw();
  playerApplication.publish();
}

/** Preserve the legacy drag preview: update the drawn/read-out position without seeking the
 * audio graph or counting another analytics interaction until pointerup commits the seek. */
function previewSeek(seconds) {
  offset = Math.max(0, Math.min(duration, seconds));
  draw();
}

// ---------------------------------------------------------------- A-B repeat

/** Set A or B at the playhead, then restart playback so the audio graph picks it up. */
function setLoopPoint(which) {
  if (!tracks.length) return;
  gcBump('loop');
  const t = currentTime();
  const next = SansLoopState.setLoopPoint({ a: loopA, b: loopB }, which, t);
  loopA = next.a;
  loopB = next.b;
  if (next.rejected) say('status.loopTooShort', { min: SansLoopState.MIN_LOOP_SECONDS }, true);

  refreshLoop();
}

function clearLoop() {
  ({ a: loopA, b: loopB } = SansLoopState.clearLoop());
  refreshLoop();
}

/** Rebuild the running sources so new loop bounds take effect immediately. */
function refreshLoop() {
  if (playing) { stop(true); play(); } else { draw(); }
  playerApplication.publish();
}

function syncSpeedUI() {
  playerApplication.publish();
}

/** Change the active playback rate. Crossing the 100% <-> non-100% boundary rebuilds the
 *  audio graph, same as seek()/refreshLoop(); staying on one side of it rebases the clock
 *  and live-messages the running stretch nodes instead, so dragging the slider mid-song
 *  has no audible restart. See the design spec's "Architecture" and "Live rate changes". */
function setRate(newPercent) {
  const clamped = SansTransportMath.clampRatePercent(newPercent);
  if (clamped === ratePercent) { syncSpeedUI(); return; }

  if (!playing) {
    ratePercent = clamped;
    syncSpeedUI();
    draw();   // the time-code speed tag is stale otherwise until the next play()
    return;
  }

  if (SansTransportMath.rateChangePlan(ratePercent, clamped) === 'rebuild') {
    stop(true);          // captures offset under the OLD rate
    ratePercent = clamped;
    const restarting = play();
    syncSpeedUI();
    return restarting;
  } else {
    const rebased = currentTime();   // under the OLD rate, before it changes
    ratePercent = clamped;
    offset = rebased;
    startedAt = audio.currentTime;
    stretchNodes.forEach(n => n.port.postMessage({ type: 'setRate', rate: ratePercent / 100 }));
    announceTransport(startedAt);
  }
  syncSpeedUI();
}

function tick() {
  raf = requestAnimationFrame(() => {
    if (!playing) return;
    draw();
    tick();
  });
}

// ---------------------------------------------------------------- routing

/* Neither note lane is ever in `tracks`, so mute-all and solo skip both for free —
 * pressing 0 must never silence the reference you are checking against. */
function applyRibbonGain(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  if (lane.gain && audio) {
    lane.gain.gain.setTargetAtTime(lane.muted ? 0 : ribbonVolume[stem], audio.currentTime, 0.012);
  }
  lane.el.lane.classList.toggle('muted', lane.muted);
  syncZoomChips();
}

/* Hiding silences. A pane you cannot see should not still be sounding — you would have
 * no way to tell what you were hearing, and no control on screen to stop it. Showing it
 * again does NOT unmute: the mute is a separate decision the user made or did not. */
function setRibbonVisible(stem, on) {
  ribbonVisible[stem] = !!on;
  writeStored(`${RIBBON_SHOW_KEY}.${stem}`, ribbonVisible[stem] ? 1 : 0);
  const lane = noteLanes[stem];
  if (lane && !ribbonVisible[stem] && !lane.muted) {
    lane.muted = true;
    applyRibbonGain(stem);
    window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: true, stem } }));
  }
  /* Hiding the lane the zoomed pane is currently reading notes from must not leave that
   * channel's pitch overlay drawn with its own lane gone — clear the selection, same
   * "deselect closes the overlay but the pane stays open" behavior as clicking the chip
   * itself (see toggleZoomNotes). */
  if (!ribbonVisible[stem] && zoomNotesStem === stem) {
    zoomNotesStem = null;
    syncEditToggle();
    syncRangeHints();
  }
  applyRibbonVisibility(stem);
  syncNotesChipsVisibility();
  syncZoomChips();
  renderOverview();
  draw();
}

function applyRibbonVisibility(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.el.lane.hidden = !(ribbonVisible[stem] && lane.ribbon);
}

/* The zoomed pane and overview lane are always visible (see their construction in buildUI) —
 * they're useful as plain-waveform tools before "Find notes" has ever run. Only the per-stem
 * Notes chip and the one global Edit toggle wait for detection: each chip appears once its
 * own channel is both visible and populated, and Edit appears once AT LEAST ONE is — showing
 * a control for pitch data that doesn't exist yet would be a lie. The Edit-notes toggle and
 * shared Export/Import buttons' own `hidden` state is React-owned since Phase 6e, read from
 * applicationSnapshot()'s `notesEdit.visible` field — this function's job for them is now
 * just to republish, not to write DOM. */
function syncNotesChipsVisibility() {
  for (const stem of NOTE_STEMS) {
    const ready = !!(noteLanes[stem] && ribbonVisible[stem] && noteLanes[stem].ribbon);
    const entry = zoomNotesChipEls[stem];
    if (entry) entry.chip.hidden = !ready;
  }
  playerApplication.publish();
}

/** Whether any channel is both visible and populated with notes — the shared gate for the
 *  Edit-notes toggle's and Export/Import buttons' visibility (Phase 6e: applicationSnapshot()'s
 *  `notesEdit.visible`) — and whether the CURRENTLY SELECTED zoomed-pane channel specifically
 *  has notes (`notesEdit.enabled`). Editing nothing makes no sense, so enablement is narrower
 *  than visibility: a channel can make the toggle visible while a different, note-less channel
 *  is selected, leaving it visible but disabled. */
function notesEditState() {
  let anyReady = false;
  for (const stem of NOTE_STEMS) {
    if (noteLanes[stem] && ribbonVisible[stem] && noteLanes[stem].ribbon) { anyReady = true; break; }
  }
  const lane = zoomNotesStem && noteLanes[zoomNotesStem];
  return { visible: anyReady, enabled: !!(lane && lane.ribbon), on: editMode };
}

/* The one global Edit-notes toggle is enabled only once the currently-selected chip's
 * channel actually has notes — editing nothing makes no sense. If the selection changes out
 * from under an active edit session (e.g. the user picks a chip with no notes yet), turn
 * editing off rather than leaving it stuck pointed at nothing. Its `disabled`/`checked`
 * presentation is React-owned since Phase 6e (applicationSnapshot()'s `notesEdit` field);
 * this function's job is computing `canEdit` for that field and, when forcing editing off,
 * dispatching the same `sansbass:editmode` event the toggle's own `onChange` would have. */
function syncEditToggle() {
  if (!notesEditState().enabled && editMode) {
    window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false, stem: zoomNotesStem } }));
  }
  playerApplication.publish();
}

/* The full-song range-select band only makes sense on the lane currently selected for
 * editing — dragging on the OTHER stem's lane while it's not the edit target would silently
 * edit the wrong channel's notes (see attachSeek's `stem === zoomNotesStem` gate). The hint
 * strip mirrors that restriction rather than inviting a gesture that does nothing. */
function syncRangeHints() {
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane) lane.rangeHint.hidden = !(editMode && stem === zoomNotesStem);
  }
  if (overviewEl.rangeHint) overviewEl.rangeHint.hidden = !(editMode && zoomNotesStem);
}

function toggleRibbon(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.muted = !lane.muted;
  applyRibbonGain(stem);
  window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: lane.muted, stem } }));
}

/** The caption under the drums lane: the current selection, or "whole song". */
function syncTempoRangeHint() {
  if (!tempoHintEl) return;
  tempoHintEl.textContent = tempoRange
    ? tr('notes.tempoRangeSel', { from: fmt(tempoRange.from), to: fmt(tempoRange.to) })
    : tr('notes.tempoRangeWhole');
  if (tempoClearBtn) tempoClearBtn.disabled = !tempoRange;
}

/** Whether a track is actually audible right now — mute state plus the explicit Full-mix/
 *  stems mutual-exclusion rule. The single computation both applyGains() and the published
 *  snapshot's per-lane `muted` field read, so React's lane presentation and the real gain
 *  ramp can never disagree about which lanes are "on". */
function trackAudible(t) {
  // Never let a full-mix file play on top of its own stems.
  if (window.__hasStems && t.stem === 'mix' && routingState.mode !== 'mix') return false;
  return !t.muted;
}

function applyGains() {
  if (!audio) return;
  const now = audio.currentTime;
  tracks.forEach(t => {
    const g = trackAudible(t) ? t.volume : 0;
    t.gain.gain.setTargetAtTime(g, now, 0.012);
  });
  syncZoomChips();
}

/**
 * Re-render the strings the DOM is already holding, after a language change.
 *
 * It must NOT rebuild the lanes. Rebuilding would drop every canvas and force a full
 * waveform re-render, and it must not touch `tracks`, `sources`, gain nodes or the
 * playhead — switching language mid-practice has to be completely inaudible.
 *
 * Standard lane labels need no line here at all: React re-renders them from `useLocale()`
 * the same way every other React-owned control already does (see PlayerShell.jsx).
 */
function retranslate() {
  // Lane labels translate; the note NAMES drawn inside a ribbon never do. Same i18n key/
  // pattern as the zoomed pane's two Notes chips — see buildUI().
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane) lane.el.txt.textContent = tr('notes.zoomNotesChipFor', { lane: tr('stem.' + stem) });
  }
  if (zoomEl) zoomEl.lane.querySelector('.txt').textContent = tr('notes.zoom');
  // The capo control's and chord editor's captions/tooltips/labels retranslate through
  // React's own useLocale() since Phase 6f — no legacy DOM write needed here.
  for (const { stem, select, label: labelEl, spk } of zoomChipEls) {
    const t = tracks.find((tr) => tr.stem === stem);
    const label = t ? laneLabel(t) : stem;
    select.title = tr('notes.zoomLaneShowTip', { lane: label });
    labelEl.textContent = label;
    spk.title = tr('notes.zoomLaneMuteTip', { lane: label });
  }
  for (const stem of NOTE_STEMS) {
    const chip = zoomNotesChipEls[stem];
    if (!chip) continue;
    const label = tr('stem.' + stem);
    chip.select.textContent = tr('notes.zoomNotesChipFor', { lane: label });
    chip.select.title = tr('notes.zoomNotesChipForTip', { lane: label });
    chip.spk.title = tr('notes.zoomNotesMuteTipFor', { lane: label });
  }
  // The Edit-notes toggle's and Export/Import buttons' labels retranslate through React's own
  // useLocale() since Phase 6e — no legacy DOM write needed here.
  syncTempoRangeHint();
}



/** Lanes the all-on/all-off button acts on — the stems, never a full-mix file. */
function syncRoutingState(next) {
  routingState = next;
  tracks.forEach((track, index) => {
    track.muted = !!next.muted[laneKey(track, index)];
  });
  applyGains();
}

/**
 * The `0` key and the button beside the dropdown. One control, three moves:
 *
 *   something muted            → turn everything on, remembering what was off
 *   everything on + snapshot   → put back exactly those lanes
 *   everything on, no snapshot → turn everything OFF
 *
 * That last move is what makes the key work on the very first press. A freshly separated
 * song has all six lanes on and nothing saved, so "unmute all" had nothing to do and the
 * control sat disabled — indistinguishable, from the user's side, from a dead key.
 * Muting everything is the useful move there: it is how you build a mix back up one lane
 * at a time, and pressing again returns you to all-on.
 *
 * The snapshot is taken at the moment everything is turned on, so muting a lane and
 * pressing again returns to *that* state, not to whatever was saved two presses ago. It is
 * deliberately NOT taken when every lane is already off: "restore previous" meaning
 * "silence again" is a worse answer than simply offering "Mute all" once more.
 */
function toggleAllTracks(publish = true) {
  gcOnce('unmute-all');
  syncRoutingState(route(routingState, { type: 'all' }));
  if (publish) playerApplication.publish();
}

function setMode(mode, publish = true) {
  syncRoutingState(route(routingState, { type: 'mode', mode }));
  if (publish) playerApplication.publish();
}

/** `publish` is `false` when called from the facade command (setMode/toggleAllTracks use the
 *  same shape), which publishes once itself after the command returns; the keyboard shortcut
 *  below bypasses the facade entirely and keeps publishing directly, as before. */
function toggleTrack(t, publish = true) {
  gcBump('toggle');
  if (t.stem) gcOnce(`toggle-${t.stem}`);   // stem ids, never labels — never a filename
  const index = tracks.indexOf(t);
  syncRoutingState(route(routingState, { type: 'toggle', key: laneKey(t, index) }));
  if (publish) playerApplication.publish();
}

/** React addresses a lane only by its stable snapshot id, never a track object or DOM node —
 *  these two resolve that id back to the real track for the `toggleTrack`/`setTrackVolume`
 *  facade commands. */
function toggleTrackById(id) {
  const t = trackById(id);
  if (!t) throw new Error(`unknown lane "${id}"`);
  toggleTrack(t, false);
}

function setTrackVolumeById(id, value) {
  const t = trackById(id);
  if (!t) throw new Error(`unknown lane "${id}"`);
  t.volume = Math.max(0, Math.min(1.5, value));
  applyGains();
}

/** Apply one authoritative master-volume value without changing any routing state. */
function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1.5, value));
  ensureAudio();
  master.gain.setTargetAtTime(masterVolume, audio.currentTime, 0.01);
}

// ---------------------------------------------------------------- input

/* Pointer capture, so the drag survives the cursor leaving the 6px grip — without it a
 * fast drag detaches the moment you outrun the element. */
function attachResize(grip, get, set, storageKey, onResize) {
  let startY = 0;
  let startH = 0;
  let dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = get();
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = clampRibbonH(startH + (e.clientY - startY));
    if (next === get()) return;
    set(next);
    if (onResize) onResize();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    writeStored(storageKey, get());
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/* Wheel zooms about the cursor, drag pans. preventDefault on the wheel is required or
 * the page scrolls out from under the gesture; passive:false is required for that to be
 * allowed at all. */
function attachZoom(canvas) {
  let panning = false;
  let lastX = 0;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) {
      const before = zoomTimeAt(canvas, e.clientX);
      zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15);
      // Keep the instant under the cursor pinned, so zooming feels like a lens rather
      // than a jump.
      zoomCenter += before - zoomTimeAt(canvas, e.clientX);
      draw();
      return;
    }
    // Proportional to the current zoom span, so a tick feels similarly sized whether
    // zoomed to a 2s window or a 60s one — the same principle zoomBy's factor already uses.
    ignoreReportedCommandError(playerApplication.commands.seek(
      currentTime() + (e.deltaY > 0 ? 1 : -1) * zoomSeconds * WHEEL_SEEK_FRACTION,
    ));
  }, { passive: false });

  /* A click seeks, a drag pans. Distinguished by distance travelled rather than by a
   * modifier: panning a few pixels and expecting the playhead not to jump is the more
   * common accident, so the threshold is generous. */
  const DRAG_SLOP = 4;
  let travelled = 0;

  canvas.addEventListener('pointerdown', (e) => {
    const ribbon = currentRibbon();
    if (editMode && ribbon) {
      if (addArmed) {
        const t = zoomTimeAt(canvas, e.clientX);
        addDrag = { startT: t, curT: t, midi: addMidiAt(canvas, e.clientY) };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = zoomTimeAt(canvas, e.clientX);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const t = zoomTimeAt(canvas, e.clientX);
      const clickMidi = addMidiAt(canvas, e.clientY);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
      /* Gated on pitch too, not just time: without this, clicking a DIFFERENT note that
       * happens to share the selected note's time span (two notes overlapping in time, at
       * different pitches) would be misread as grabbing the already-selected note to drag,
       * instead of falling through to the fresh hit-test below and switching selection. */
      if (sel && sel.midi === clickMidi) {
        const tol = zoomEdgeToleranceSeconds(canvas);
        let mode = null;
        if (Math.abs(t - sel.start) <= tol) mode = 'resize-start';
        else if (Math.abs(t - sel.end) <= tol) mode = 'resize-end';
        else if (sel.start <= t && t < sel.end) mode = 'move';
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end, travelled: 0, lastX: e.clientX };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      /* A note that isn't already the tolerance-matched selection above still gets armed as
       * a move-drag right away, not just selected — one click-drag-release both selects AND
       * moves it, instead of forcing a separate first click to select before a move-drag can
       * start. Resizing stays two clicks: it needs the edge tabs drawn (only once a note is
       * selected) as the visual affordance for where the edge actually is. Releasing within
       * DRAG_SLOP (below) falls back to today's plain-click behaviour — seek, no edit. */
      const hit = noteAt(ribbon.notes, t, clickMidi);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2, midi: hit.midi };
        rangeSelection = null;
        noteDrag = { mode: 'move', note: hit, startT: t, origStart: hit.start, origEnd: hit.end,
                     previewStart: hit.start, previewEnd: hit.end, travelled: 0, lastX: e.clientX };
        canvas.setPointerCapture(e.pointerId);
        draw();
        return;
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (addDrag) { addDrag.curT = zoomTimeAt(canvas, e.clientX); draw(); return; }
    if (rangeDrag) { rangeDrag.curT = zoomTimeAt(canvas, e.clientX); draw(); return; }
    if (noteDrag) {
      noteDrag.travelled += Math.abs(e.clientX - noteDrag.lastX);
      noteDrag.lastX = e.clientX;
      const dt = zoomTimeAt(canvas, e.clientX) - noteDrag.startT;
      let newStart = noteDrag.origStart + (noteDrag.mode === 'resize-end' ? 0 : dt);
      let newEnd = noteDrag.origEnd + (noteDrag.mode === 'resize-start' ? 0 : dt);

      /* Snap to the same beat/bar grid the zoomed pane draws — finest enabled resolution
       * (¼ implies ½, see toggleQuarterBeat) — only while the tempo grid is actually on.
       * 'move' snaps the start and carries the same offset into the end, so duration is
       * preserved exactly; a resize snaps only the edge being dragged. */
      const gridTempo = currentRibbon()?.tempo;
      if (gridTempo && gridTempo.on) {
        const divisions = showQuarterBeat ? 4 : showHalfBeat ? 2 : 1;
        if (noteDrag.mode === 'move') {
          const snappedStart = SansRibbon.snapToGrid(gridTempo, newStart, divisions);
          newEnd += snappedStart - newStart;
          newStart = snappedStart;
        } else if (noteDrag.mode === 'resize-start') {
          newStart = SansRibbon.snapToGrid(gridTempo, newStart, divisions);
        } else {
          newEnd = SansRibbon.snapToGrid(gridTempo, newEnd, divisions);
        }
      }

      const MIN_DUR = 0.02;   // the analysis frame hop floor — see docs/transcription.md
      if (newEnd - newStart < MIN_DUR) {
        if (noteDrag.mode === 'resize-start') newStart = newEnd - MIN_DUR;
        else if (noteDrag.mode === 'resize-end') newEnd = newStart + MIN_DUR;
      }
      noteDrag.previewStart = newStart;
      noteDrag.previewEnd = newEnd;
      draw();
      return;
    }
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    travelled += Math.abs(e.clientX - lastX);
    zoomCenter -= ((e.clientX - lastX) / r.width) * zoomSeconds;
    lastX = e.clientX;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (addDrag) {
      const start = Math.min(addDrag.startT, addDrag.curT);
      const end = Math.max(addDrag.startT, addDrag.curT);
      const MIN_DUR = 0.02;
      const finalEnd = end - start < MIN_DUR ? start + MIN_DUR : end;
      const midi = addDrag.midi;
      addDrag = null;
      addArmed = false;
      syncAddButton();
      dispatchEdit([{ type: 'add', start, end: finalEnd, midi }]);
      selectedNote = { at: (start + finalEnd) / 2, midi };
      rangeSelection = null;
      draw();
      return;
    }
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      if (rangeSelection) selectedNote = null;
      draw();
      return;
    }
    if (noteDrag) {
      if (noteDrag.travelled <= DRAG_SLOP) {
        ignoreReportedCommandError(playerApplication.commands.seek(zoomTimeAt(canvas, e.clientX)));
        noteDrag = null;
        draw();
        return;
      }
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd, midi: note.midi }]);
        selectedNote = { at: (previewStart + previewEnd) / 2, midi: note.midi };
      }
      draw();
      return;
    }
    if (!panning) return;
    panning = false;
    if (travelled <= DRAG_SLOP) {
      ignoreReportedCommandError(playerApplication.commands.seek(zoomTimeAt(canvas, e.clientX)));
    }
  });
  canvas.addEventListener('pointercancel', () => {
    addDrag = null; rangeDrag = null; noteDrag = null; panning = false;
  });
}

/** Change the zoom window width about its centre, and persist it. */
function zoomBy(factor) {
  zoomSeconds = clampZoomSec(zoomSeconds * factor);
  writeStored(ZOOM_SEC_KEY, zoomSeconds);
  draw();
}

/** Add or drop a stem from the zoomed pane's waveform selection. */
function toggleZoomLane(stem) {
  if (zoomLaneSel.has(stem)) zoomLaneSel.delete(stem); else zoomLaneSel.add(stem);
  syncZoomChips();
  renderOverview();
  draw();
}

/** Select which channel's notes the zoomed pane shows — mutually exclusive with whichever
 *  was selected before. Clicking the already-selected chip clears the selection entirely
 *  (no overlay, same as `ribbon === null` did before this feature). Whenever a channel is
 *  selected, every plain waveform behind it renders gray instead of its own colour, so the
 *  notes stay the thing your eye reads — see renderZoom. */
function toggleZoomNotes(stem) {
  const prev = zoomNotesStem;
  zoomNotesStem = zoomNotesStem === stem ? null : stem;
  /* Switching which channel is selected must never leave an active edit session silently
   * pointed at the channel that's no longer selected — see docs/superpowers/plans/
   * 2026-09-01-bass-notes.md row N56c. syncEditToggle() below only turns editing off when
   * the NEWLY selected channel lacks notes; in the ordinary two-channel case (both vocals
   * and bass have notes) that check never fires, so the selection change is handled here
   * instead, unconditionally, whenever the selection actually changed while editing was on.
   * The dispatch names `prev` (the channel editing was pointed at), but notes.js clears its
   * `editable` flag on any on:false event regardless of which stem it names, so a single
   * dispatch is enough — and the listener below also resets editMode, the toolbar/fields
   * visibility, and the checkbox itself. */
  if (prev !== zoomNotesStem && editMode) {
    window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false, stem: prev } }));
  }
  syncZoomChips();
  syncEditToggle();
  syncRangeHints();
  renderOverview();
  draw();
}
/* ¼ implies ½: the quarter-beat grid already draws the half-beat point (see renderZoom),
 * so a quarter grid with no half toggle on would show sub-beat lines the ½ button claims
 * are off. Turning ½ off therefore also turns ¼ off; ½ alone is still a valid state. */
function toggleHalfBeat() {
  showHalfBeat = !showHalfBeat;
  if (!showHalfBeat) showQuarterBeat = false;
  halfBeatBtn.classList.toggle('active', showHalfBeat);
  quarterBeatBtn.classList.toggle('active', showQuarterBeat);
  draw();
}
function toggleQuarterBeat() {
  showQuarterBeat = !showQuarterBeat;
  if (showQuarterBeat) showHalfBeat = true;
  halfBeatBtn.classList.toggle('active', showHalfBeat);
  quarterBeatBtn.classList.toggle('active', showQuarterBeat);
  draw();
}

/** Keeps every chip's selected/muted look in sync with zoomLaneSel/zoomNotesStem, each
 *  track's own .muted, and each note lane's own .muted — called after a chip click, from
 *  applyGains() (a stem can be muted from its own row in the main list too) and from
 *  applyRibbonGain() likewise. */
function syncZoomChips() {
  for (const { stem, select, spk } of zoomChipEls) {
    select.classList.toggle('on', zoomLaneSel.has(stem));
    const t = tracks.find((tr) => tr.stem === stem);
    spk.classList.toggle('muted', !!t?.muted);
  }
  for (const stem of NOTE_STEMS) {
    const chip = zoomNotesChipEls[stem];
    if (!chip) continue;
    chip.select.classList.toggle('active', zoomNotesStem === stem);
    chip.spk.classList.toggle('muted', !!noteLanes[stem]?.muted);
  }
}

/** The note in `list` whose span contains `at`, or null. Half-open — a note's END excludes
 *  it, matching lib/pitch.js's applyEdits.
 *
 *  With `midi` given, only a note at that exact pitch counts — this is what actually
 *  disambiguates two notes overlapping in time, which time alone never could. Without it
 *  (the one legitimate case: nothing is selected yet), falls back to time-only.
 *
 *  Searches from the END of the list either way, so if pitch still leaves more than one match
 *  (an exact duplicate — same span, same pitch) the one drawn last (topmost) wins, matching
 *  renderZoom/renderRibbon's draw order. */
function noteAt(list, at, midi) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.start <= at && at < n.end && (midi === undefined || n.midi === midi)) return n;
  }
  return null;
}

/* Every time-valued field an edit object can carry, across all six primitive types (see
 * lib/pitch.js's applyEdits doc comment) — rounded here, once, rather than at each call
 * site, so a drag/arithmetic-derived value like 207.45864999999998 never reaches the edit
 * list, the in-memory edit history, or the exported edits JSON (notes.js's exportEntry). */
const EDIT_TIME_FIELDS = ['at', 'dStart', 'dEnd', 'start', 'end', 'from', 'to'];

/** `meta` (optional) is `{ label, timeLabel }` — an i18n KEY and a preformatted time string
 *  overriding how the resulting edit-list row reads; see groupLabel/groupTimeLabel in
 *  notes.js. Used by the Snap-range/Whole-song batch so the row says "Snap to grid · 4.00–
 *  8.00s" instead of falling through to the generic multi-edit "Split" label and the first
 *  edit's own timestamp. */
function dispatchEdit(edits, meta) {
  const rounded = edits.map((e) => {
    const out = { ...e };
    for (const f of EDIT_TIME_FIELDS) if (typeof out[f] === 'number') out[f] = roundSeconds(out[f]);
    return out;
  });
  window.dispatchEvent(new CustomEvent('sansbass:noteedit', { detail: { edits: rounded, ...meta } }));
}

/* Reassigning selectedNote BEFORE dispatching, here and below: dispatchEdit's event round-trips
 * SYNCHRONOUSLY through notes.js and back into syncEditToolbar, which re-resolves the selection
 * by the CURRENT selectedNote.midi. If that still held the pre-edit pitch, the note — already
 * updated to its new pitch in ribbon.notes by the time syncEditToolbar runs — wouldn't be found,
 * nulling selectedNote out from under this function before it could read it back afterward. */
function editOctave(dir) {
  if (!selectedNote) return;
  const at = selectedNote.at;
  const oldMidi = selectedNote.midi;
  selectedNote = { at, midi: oldMidi + 12 * dir };
  dispatchEdit([{ type: 'octave', at, dir, midi: oldMidi }]);
}

function editPitchNudge(semitones) {
  if (!selectedNote) return;
  const at = selectedNote.at;
  const oldMidi = selectedNote.midi;
  selectedNote = { at, midi: oldMidi + semitones };
  dispatchEdit([{ type: 'pitchNudge', at, semitones, midi: oldMidi }]);
}

const TIME_NUDGE_STEP = 0.1;   // seconds

function editTimeNudge(dir) {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  const at = selectedNote.at;
  const midi = selectedNote.midi;
  selectedNote = { at: at + d, midi };
  dispatchEdit([{ type: 'timeAdjust', at, dStart: d, dEnd: d, midi }]);
}

/** Snaps the selected note's start and end to the current beat grid, at whatever resolution
 *  the ½/¼ toggle currently shows — same divisions the live drag-snap uses. One ordinary
 *  timeAdjust edit, indistinguishable from a manual resize that happened to land on grid
 *  values; no batch label, no group metadata — see editSnapRange for the batch version. */
function editSnapNote() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon || !ribbon.tempo || !ribbon.tempo.on) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const divisions = showQuarterBeat ? 4 : showHalfBeat ? 2 : 1;
  // Shares snapNoteEdges with the batch path (lib/ribbon.js) rather than reimplementing the
  // floor/rounding here — see lib/ribbon.js's comment on snapNoteEdges for why the two paths
  // drifting apart is exactly what caused a short note to collapse to zero width and orphan
  // a later edit.
  const { newStart, newEnd } = SansRibbon.snapNoteEdges(ribbon.tempo, n.start, n.end, divisions);
  if (newStart === n.start && newEnd === n.end) return;   // already on grid
  const at = (n.start + n.end) / 2;
  dispatchEdit([{ type: 'timeAdjust', at, dStart: newStart - n.start, dEnd: newEnd - n.end, midi: n.midi }]);
  selectedNote = { at: (newStart + newEnd) / 2, midi: n.midi };
}

/** Commits the Start/End fields: Enter in either of them, or a click on Apply, calls this.
 *  Pitch no longer goes through here — see commitPitchDropdown, which auto-commits on every
 *  dropdown change instead. A field that fails to parse is treated as "unchanged", not as
 *  blocking anything else. The forced refresh at the end (fieldsShownFor = null) is what makes
 *  a garbage field visibly snap back, which is the actual "revert silently" the user sees. See
 *  docs/superpowers/specs/2026-09-01-note-inline-fields-design.md ("Commit"). */
function commitFields() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const parsedStart = parseTimeMmSs(zoomToolbar.fieldStart.value);
  const parsedEnd   = parseTimeMmSs(zoomToolbar.fieldEnd.value);
  const newStart = parsedStart !== null ? parsedStart : n.start;
  const newEnd   = parsedEnd   !== null ? parsedEnd   : n.end;
  const dStart = newStart - n.start;
  const dEnd   = newEnd - n.end;
  const timeValid = newStart >= 0 && (newEnd - newStart) >= 0.02;
  // The field never holds more precision than fmtPrecise displays (whole milliseconds), so an
  // untouched field round-trips through parseTimeMmSs as a few tenths of a millisecond of noise,
  // not exactly 0. Comparing dStart/dEnd at that same millisecond granularity is what tells real
  // edits apart from that round-trip noise; the values dispatched below stay full-precision.
  const changedTime = Math.round(dStart * 1000) !== 0 || Math.round(dEnd * 1000) !== 0;

  if (timeValid && changedTime) {
    const at = selectedNote.at;
    selectedNote = { at: at + dStart, midi: n.midi };
    dispatchEdit([{ type: 'timeAdjust', at, dStart, dEnd, midi: n.midi }]);
  }
  fieldsShownFor = null;   // force a refresh from the (possibly just-updated) note
  syncEditToolbar();
}

/** Fires on every change of any of the three Pitch dropdowns — no Enter or Apply, matching how
 *  the toolbar's existing ♯/♭/↑8ve/↓8ve buttons already auto-commit. Unlike those buttons
 *  (which nudge by a fixed relative amount and so always represent a real change), the
 *  dropdowns pick an ABSOLUTE note, so a genuine no-op is possible (e.g. re-picking an
 *  equivalent spelling of the current pitch) — hence the noteAt lookup and the equality check,
 *  the same shape commitFields used before Pitch was split out of it. */
function commitPitchDropdown() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const pitchStr = zoomToolbar.fieldPitchLetter.value
                 + zoomToolbar.fieldPitchAccidental.value
                 + zoomToolbar.fieldPitchOctave.value;
  const newMidi = parseNoteName(pitchStr);
  if (newMidi === null || newMidi === n.midi) return;

  const at = selectedNote.at;
  selectedNote = { at, midi: newMidi };
  dispatchEdit([{ type: 'pitchNudge', at, semitones: newMidi - n.midi, midi: n.midi }]);
  fieldsShownFor = null;   // force Start/End's guard to refresh too, in case anchor moved
  syncEditToolbar();
}

function editDeleteNote() {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'delete', at: selectedNote.at, midi: selectedNote.midi }]);
  selectedNote = null;
}

function editRangeDelete() {
  if (!rangeSelection) return;
  // Cleared BEFORE dispatching, not after: dispatchEdit's 'sansbass:noteedit' round-trips
  // synchronously through notes.js and back into setNotes()/draw(), which reads
  // rangeSelection to paint the amber band and gate this very button. Null it first so that
  // synchronous redraw already shows no selection, instead of a stale band/enabled button
  // that only clears on the NEXT unrelated draw() (unlike the sel-gated buttons, which
  // self-heal because syncEditToolbar re-derives `sel` from the live ribbon notes).
  const { from, to } = rangeSelection;
  rangeSelection = null;
  dispatchEdit([{ type: 'rangeDelete', from, to }]);
}

/** Snaps every note overlapping the selected range to the current beat grid — one
 *  timeAdjust primitive per note that actually moves, all dispatched together in a SINGLE
 *  'sansbass:noteedit' event so they land as one edit-list row and one undo, how ever many
 *  notes were touched. See lib/ribbon.js's snapNotesToGrid for why no overlap-avoidance
 *  logic is needed here. Cleared before dispatching, same reasoning as editRangeDelete. */
function editSnapRange() {
  const ribbon = currentRibbon();
  if (!rangeSelection || !ribbon || !ribbon.tempo || !ribbon.tempo.on) return;
  const { from, to } = rangeSelection;
  rangeSelection = null;
  const divisions = showQuarterBeat ? 4 : showHalfBeat ? 2 : 1;
  const moves = SansRibbon.snapNotesToGrid(ribbon.notes, ribbon.tempo, divisions, { from, to });
  if (!moves.length) return;
  const edits = moves.map(({ note, newStart, newEnd }) => ({
    type: 'timeAdjust', at: (note.start + note.end) / 2,
    dStart: newStart - note.start, dEnd: newEnd - note.end, midi: note.midi,
  }));
  dispatchEdit(edits, { label: 'notes.editSnapLabel', timeLabel: `${from.toFixed(2)}–${to.toFixed(2)}s` });
}

/** Sets the range selection to the whole song — a shortcut into editSnapRange (and Delete
 *  range) that doesn't require dragging across the full width. */
function setWholeSongRange() {
  if (!duration) return;
  ({ note: selectedNote, range: rangeSelection } = wholeSong(
    { note: selectedNote, range: rangeSelection }, duration,
  ));
  draw();
}

/* Splitting at the playhead composes from two primitives, or one at either edge — see "The
 * one thing to understand before starting" and the design spec's "Six edit types, not
 * seven". 5ms keeps the two pieces unambiguously separate rather than zero-gap touching
 * notes, the same ambiguity docs/transcription.md flags in the portamento analysis. */
const SPLIT_GAP = 0.005;

function editSplit() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const cutAt = currentTime();
  if (cutAt <= n.start || cutAt >= n.end) return;   // playhead must be inside the note

  const edits = [];
  if (n.end - cutAt < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end, midi: n.midi });
    selectedNote = { at: (n.start + cutAt) / 2, midi: n.midi };
  } else if (cutAt - n.start < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: cutAt - n.start, dEnd: 0, midi: n.midi });
    selectedNote = { at: (cutAt + n.end) / 2, midi: n.midi };
  } else {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end, midi: n.midi });
    edits.push({ type: 'add', start: cutAt + SPLIT_GAP, end: n.end, midi: n.midi });
    selectedNote = { at: (n.start + cutAt) / 2, midi: n.midi };
  }
  dispatchEdit(edits);
}

function toggleAddArmed() {
  addArmed = !addArmed;
  syncAddButton();
}

function syncAddButton() {
  if (!zoomToolbar) return;
  zoomToolbar.add.textContent = addArmed ? tr('notes.editAddArmed') : ('+ ' + tr('notes.editAdd'));
  zoomToolbar.add.classList.toggle('note-tbtn-armed', addArmed);
}

/** Song time under a client x position in the zoomed pane. */
function zoomTimeAt(canvas, clientX) {
  const r = canvas.getBoundingClientRect();
  const win = SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration || 1);
  return win.from + ((clientX - r.left) / r.width) * (win.to - win.from);
}

const EDGE_PX = 8;   // how close a pointer must be to a note's edge to grab it for resize

/** How many seconds correspond to EDGE_PX at the zoomed pane's current width and window. */
function zoomEdgeToleranceSeconds(canvas) {
  const win = SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration || 1);
  const r = canvas.getBoundingClientRect();
  return (EDGE_PX / (r.width || 1)) * (win.to - win.from);
}

/** The zoomed pane's current pitch range, the same call renderZoom uses. */
function zoomPitchRangeNow() {
  const ribbon = currentRibbon();
  if (!ribbon) return [48, 72];
  return SansRibbon.pitchRange(ribbon.notes, { clip: ribbon.clip !== false });
}

/** Client Y -> MIDI in the zoomed pane, the inverse of renderZoom's y(midi). */
function addMidiAt(canvas, clientY) {
  const [loM, hiM] = zoomPitchRangeNow();
  const r = canvas.getBoundingClientRect();
  const frac = (clientY - r.top) / (r.height || 1);
  const midi = Math.round(hiM - frac * (hiM - loM));
  return Math.max(loM, Math.min(hiM, midi));
}

function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const tempoLane = !!(opts && opts.tempoLane);
  const stem = opts && opts.stem;
  const overview = !!(opts && opts.overview);
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (tempoLane && tempoRangeArmed) {
      const t = posToTime(e);
      tempoRangeDrag = { startT: t, curT: t };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    /* Only the lane currently selected for editing accepts a range-drag — dragging on the
     * OTHER stem's full-song lane while it isn't the edit target must not silently edit the
     * SELECTED stem's notes. See syncRangeHints(), which hides the caption on the other lane
     * for the same reason. The Overview lane has no single stem identity (it can combine
     * several), so for it the requirement is just "an edit target is selected at all",
     * matching how the range it draws is a plain time range, not tied to a particular stem. */
    if (rangeBand && editMode && (overview ? zoomNotesStem : stem === zoomNotesStem)) {
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = posToTime(e);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    ignoreReportedCommandError(playerApplication.commands.seek(posToTime(e)));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (tempoRangeDrag) { tempoRangeDrag.curT = posToTime(e); draw(); return; }
    if (rangeDrag) { rangeDrag.curT = posToTime(e); draw(); return; }
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (tempoRangeDrag) {
      const from = Math.min(tempoRangeDrag.startT, tempoRangeDrag.curT);
      const to = Math.max(tempoRangeDrag.startT, tempoRangeDrag.curT);
      tempoRangeDrag = null;
      tempoRange = (to - from > 0.01) ? { from: roundSeconds(from), to: roundSeconds(to) } : null;
      syncTempoRangeHint();
      window.dispatchEvent(new CustomEvent('sansbass:temporange', { detail: tempoRange }));
      draw();
      return;
    }
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      if (rangeSelection) selectedNote = null;
      draw();
      return;
    }
    if (!scrubbing) return;
    scrubbing = false;
    ignoreReportedCommandError(playerApplication.commands.seek(posToTime(e)));
  });
  canvas.addEventListener('pointercancel', () => { tempoRangeDrag = null; rangeDrag = null; scrubbing = false; });
}

window.addEventListener('sansbass:langchange', retranslate);
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  noteDrag = null;
  addArmed = false;
  addDrag = null;
  rangeDrag = null;
  rangeSelection = null;
  if (zoomToolbar) { zoomToolbar.root.hidden = !editMode; zoomToolbar.fields.hidden = !editMode; }
  if (zoomRangeHint) zoomRangeHint.hidden = !editMode;
  syncRangeHints();
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
  // The Edit-notes toggle's `checked` presentation is React-owned since Phase 6e, read from
  // applicationSnapshot()'s `notesEdit.on` field — publish so it (and every other snapshot
  // consumer) picks up the new editMode value.
  playerApplication.publish();
});
window.addEventListener('sansbass:temporangemode', (e) => {
  tempoRangeArmed = e.detail.on;
});
/* notes.js re-broadcasts this on its own 400ms poll regardless of whether anything changed
 * (typing a manual BPM, half/double, redetect, import, or a fresh auto-detection landing all
 * go through the same path) — only redraw when the reading actually moved, so a paused,
 * settled song doesn't repaint 2.5 times a second for nothing. */
window.addEventListener('sansbass:tempo', (e) => {
  const d = e.detail;
  const changed = !tempoInfo || tempoInfo.bpmValue !== d.bpmValue || tempoInfo.confidence !== d.confidence;
  tempoInfo = d;
  if (changed) draw();
});
gcOnce(`lang-${SansI18n.getLocale()}`);

document.addEventListener('keydown', (e) => {
  // This exclusion is also what keeps syncNoteFields' clobber-avoidance sound: it's why a
  // hotkey can't change `selectedNote` while an inline field has focus. Loosen it and
  // syncNoteFields' own document.activeElement check (see its comment) is the only thing
  // still standing between a hotkey and an in-progress keystroke.
  // Buttons keep their native keyboard activation without also reaching this document
  // owner. Fields retain the established Space-to-play exception; other shortcuts must not
  // rewrite a focused input/select/textarea value.
  if (/button/i.test(e.target.tagName)) return;
  if (/input|select|textarea/i.test(e.target.tagName) && e.key !== ' ') return;
  if (!tracks.length) return;
  if (editMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('sansbass:editundo'));
    return;
  }
  if (editMode && selectedNote) {
    if (e.key === 'ArrowUp') { e.preventDefault(); e.shiftKey ? editOctave(1) : editPitchNudge(1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.shiftKey ? editOctave(-1) : editPitchNudge(-1); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editDeleteNote(); return; }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); editSnapNote(); return; }
  }
  // Range hotkeys mirror the Delete range/Snap range buttons. Gated on selectedNote being
  // absent so a note's own Delete/G (above) keeps priority if both happen to be set at once.
  else if (editMode && rangeSelection) {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editRangeDelete(); return; }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); editSnapRange(); return; }
  }
  if (e.key === ' ') { e.preventDefault(); ignoreReportedCommandError(playerApplication.commands.togglePlayback()); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); ignoreReportedCommandError(playerApplication.commands.seek(currentTime() - (e.shiftKey ? FINE_SEEK_STEP : zoomSeconds * ARROW_SEEK_FRACTION))); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); ignoreReportedCommandError(playerApplication.commands.seek(currentTime() + (e.shiftKey ? FINE_SEEK_STEP : zoomSeconds * ARROW_SEEK_FRACTION))); }
  else if (e.key === '0') toggleAllTracks();
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setLoopPoint('a'); }
  else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setLoopPoint('b'); }
  else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') { e.preventDefault(); clearLoop(); }
  else if (e.key === '[') {
    e.preventDefault();
    ignoreReportedCommandError(playerApplication.commands.setPlaybackRate(
      SansTransportMath.nudgeRatePercent(ratePercent, -SansTransportMath.RATE_STEP) / 100,
    ));
  } else if (e.key === ']') {
    e.preventDefault();
    ignoreReportedCommandError(playerApplication.commands.setPlaybackRate(
      SansTransportMath.nudgeRatePercent(ratePercent, SansTransportMath.RATE_STEP) / 100,
    ));
  }
  // Shift+[ / Shift+] for the fine ±1% step. NOT `e.key === '[' && e.shiftKey` — holding
  // Shift while pressing the physical [ / ] key changes e.key to '{' / '}' on a standard
  // layout, so a shiftKey check here would just never fire; checking the produced
  // character directly is what actually matches a real Shift+[ keypress.
  else if (e.key === '{') {
    e.preventDefault();
    ignoreReportedCommandError(playerApplication.commands.setPlaybackRate(
      SansTransportMath.nudgeRatePercent(ratePercent, -SansTransportMath.RATE_FINE_STEP) / 100,
    ));
  } else if (e.key === '}') {
    e.preventDefault();
    ignoreReportedCommandError(playerApplication.commands.setPlaybackRate(
      SansTransportMath.nudgeRatePercent(ratePercent, SansTransportMath.RATE_FINE_STEP) / 100,
    ));
  } else if (e.key === '\\') {
    e.preventDefault();
    ignoreReportedCommandError(playerApplication.commands.setPlaybackRate(
      SansTransportMath.RATE_DEFAULT / 100,
    ));
  }
  else if (/^[1-9]$/.test(e.key)) {
    const t = tracks[parseInt(e.key, 10) - 1];
    if (t) toggleTrack(t);
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  if (!tracks.length) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 120);
});

function applicationTransportSnapshot() {
  return {
    playing,
    position: currentTime(),
    duration,
    playbackRate: ratePercent / 100,
    loopA,
    loopB,
    tempoBpm: tempoInfo && tempoInfo.confidence > 0 ? tempoInfo.bpmValue : null,
  };
}

function applicationSnapshot() {
  const song = tracks.length ? {
    id: acceptedSongToken,
    title: currentTitle,
    duration,
    tracks: tracks.map((track, index) => ({
      id: laneKey(track, index), stem: track.stem || null, name: track.name,
      label: track.label, color: track.color, muted: !trackAudible(track), volume: track.volume,
    })),
  } : null;
  return {
    song,
    loading,
    masterVolume,
    routing: { mode: routingState.mode, allToggleLabel: allToggleLabel(routingState) },
    transport: applicationTransportSnapshot(),
    status: lastSay ? { key: lastSay.key, params: lastSay.params || null, error: !!lastSay.isErr } : null,
    notesEdit: notesEditState(),
    chord: applicationChordSnapshot(),
  };
}

playerApplication.initialize({
  getSnapshot: applicationSnapshot,
  getTransportSnapshot: applicationTransportSnapshot,
  getChordSnapshot: applicationChordSnapshot,
  attachPrimarySeekCanvas,
  attachLaneCanvas,
  attachLaneExtra,
  attachOverviewCanvas,
  attachOverviewExtra,
  commands: {
    load: loadAny,
    play,
    pause: () => { if (playing) stop(true); },
    togglePlayback: toggle,
    seek,
    previewSeek,
    setPlaybackRate: (rate) => setRate(rate * 100),
    setMasterVolume,
    clearLoop,
    setMode: (mode) => setMode(mode, false),
    toggleAllTracks: () => toggleAllTracks(false),
    toggleTrack: toggleTrackById,
    setTrackVolume: setTrackVolumeById,
    replaceSong: loadSeparated,
    rejectLoad: (reason, details) => {
      if (reason === 'folder') {
        gcTrack('folder-drop');
        say('status.folderDrop', null, true);
      } else if (reason === 'multiple') {
        say('status.tooManyFiles', { n: details.count }, true);
      } else {
        say('status.notSongOrZip', null, true);
      }
    },
    setEditMode: (on) => {
      window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on, stem: zoomNotesStem } }));
    },
    exportEdits: () => window.dispatchEvent(new CustomEvent('sansbass:exportedits')),
    importEdits: (file) => window.dispatchEvent(new CustomEvent('sansbass:importedits', { detail: { file } })),
    setCapo: (fret) => {
      capo = Number(fret) || 0;
      window.dispatchEvent(new CustomEvent('sansbass:capochange', { detail: { capo } }));
      draw();
    },
    commitChord: (label) => {
      const trimmed = typeof label === 'string' ? label.trim() : '';
      if (chordSegmentStart == null || !trimmed) return;
      window.dispatchEvent(new CustomEvent('sansbass:chordedit', {
        detail: { start: chordSegmentStart, label: transposeChordLabel(trimmed, capo) },
      }));
    },
    redetectChord: () => window.dispatchEvent(new CustomEvent('sansbass:chordredetect')),
  },
  reportCommandError: (error) => {
    loading = false;
    say('status.commandFailed', { message: error.message }, true);
  },
  dispose: () => {
    clearTimeout(resizeTimer);
    cancelAnimationFrame(raf);
    stop(false);
    tracks = [];
    duration = 0;
    loading = false;
    currentTitle = '';
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
  },
});
playerShell = mountPlayerShell(playerApplication);

/* Permanent, documented cross-module bridge for notes.js, separate.js, and the browser
 * harness — the exception CLAUDE.md's own rule allows for a consumer that genuinely cannot
 * `import` this module's mutable closure state. React never reads this global; it uses
 * lib/player-application.js's ESM command/subscription facade exclusively. The `playerShell`
 * member below is a harness-only adapter for proving React mount cleanup independently of
 * application/audio/song disposal. Do not add unrelated globals here. */
window.sansBass = {
  application: playerApplication,
  // Harness-only: production UI imports the ESM mount directly (see the block comment above).
  playerShell: {
    unmount: () => playerShell?.unmount(),
    remount: () => playerShell?.mount(),
  },
  /** The currently loaded full-mix track, or null. */
  currentMix: () => {
    const t = tracks.find((x) => x.stem === 'mix');
    // t.name, not t.label: assignStems relabels a lone file to "Full mix", which would
    // then become the ZIP's folder name.
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** True when exactly one track is loaded — i.e. an unseparated song. */
  isSingleTrack: () => tracks.length === 1,
  /** A loaded stem's buffer by name, or null. notes.js reads 'vocals'/'bass' through this. */
  stemBuffer: (stem) => {
    const t = tracks.find((x) => x.stem === stem);
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** Hand one channel's detected notes to the player, or null to clear that lane. */
  setNotes,
  /** Restores a tempoRange imported from an edits JSON, updating the drums-lane caption. */
  setTempoRange: (range) => {
    tempoRange = range;
    syncTempoRangeHint();
    draw();
  },
  /** Where a channel connects its oscillators, and the clock they must use. */
  notesAudio: (stem) => {
    const l = noteLanes[stem];
    return (audio && l && l.gain) ? { ctx: audio, destination: l.gain } : null;
  },
  /** Current transport, for scheduling a synth that starts mid-playback. */
  transport: () => ({ playing, t0: startedAt, offset,
                      loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null,
                      rate: ratePercent / 100 }),
  /** True while the given stem's notes lane is silent. */
  ribbonMuted: (stem) => !!noteLanes[stem]?.muted,
  /** Show or hide one stem's notes pane. Hiding also mutes. */
  setRibbonVisible,
  ribbonVisible: (stem) => !!ribbonVisible[stem],
  say,
};
