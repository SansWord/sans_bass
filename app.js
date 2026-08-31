/* sans_bass — multitrack stem player
 * All decoding happens locally via Web Audio. Stems stay perfectly in sync
 * because every track is started from one AudioContext clock at the same time.
 */

const { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } = window.SansStems;

const BUCKETS = 1400;   // waveform resolution
const LOOKAHEAD = 0.06; // seconds of scheduling headroom before playback starts

// ---------------------------------------------------------------- state

let audio = null;          // AudioContext (created on first user gesture)
let master = null;         // master GainNode
let tracks = [];           // loaded tracks
const RIBBON_H_KEY = 'sans_bass.ribbonHeight';
const RIBBON_H_MIN = 96;
const RIBBON_H_MAX = 600;
const RIBBON_H_DEFAULT = 220;

const clampRibbonH = (n) => Math.max(RIBBON_H_MIN, Math.min(RIBBON_H_MAX, Math.round(n)));

let ribbon = null;         // { notes, frames, params, clip } from notes.js, or null
let ribbonEl = null;       // { lane, canvas, txt, grip } — rebuilt with the lanes each load
let ribbonGain = null;     // GainNode for the synthesised notes, into master
let ribbonMuted = true;    // silent until asked for: the lane is a reference, not a part
let ribbonVolume = 1;
let ribbonHeight = readRibbonHeight();
let duration = 0;          // longest track length, seconds
let offset = 0;            // playhead position when stopped, seconds
let startedAt = 0;         // audio.currentTime at which playback began
let playing = false;
let sources = [];
let scrubbing = false;
let raf = 0;
let loopA = null;          // A-B repeat start, seconds (null = unset)
let loopB = null;          // A-B repeat end, seconds
let muteSnapshot = null;   // lane mutes to return to when "unmute all" is undone
const MIN_LOOP = 0.1;      // shorter than this is almost certainly a mis-press

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $('dropzone'), player: $('player'), status: $('status'),
  fileInput: $('file-input'),
  play: $('play'), title: $('title'), mainWave: $('main-wave'),
  tCur: $('t-cur'), tDur: $('t-dur'), mode: $('mode'),
  masterVol: $('master-vol'), lanes: $('lanes'),
  loopBadge: $('loop-badge'), loopText: $('loop-text'), loopClear: $('loop-clear'),
  allToggle: $('all-toggle'), dragOverlay: $('drag-overlay'), langToggle: $('lang-toggle'),
};

/* Null-safe wiring. Every listener in this file is registered from one flat run of
 * top-level statements, so a single missing element used to abort the whole script at its
 * first `.addEventListener` and silently take every listener below it with it — including
 * drag & drop, which is what made the browser navigate to the dropped file instead of
 * loading it (see the v1.4.0 devlog entry). Warn and keep going instead. */
function on(node, ev, fn, opts) {
  if (!node) { console.warn(`sans_bass: no element for the "${ev}" handler — skipped`); return; }
  node.addEventListener(ev, fn, opts);
}

const tr = (key, params) => window.SansI18n.t(key, params);

/* Analytics must never be able to break the player. Same reasoning as on() above: a
 * missing window.SansAnalytics (script blocked by an extension, 404 after a bad deploy)
 * must degrade to a no-op, not take out every listener below it. */
const gcTrack = (n) => { try { window.SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { window.SansAnalytics?.once(n);  } catch (e) { /* never */ } };
const gcBump  = (n) => { try { window.SansAnalytics?.bump(n);  } catch (e) { /* never */ } };

/* The drop zone promises that a song "can be split into six stems right here in the
 * browser". On a phone that is false — see lib/platform.js. Swap the KEY rather than the
 * text: SansI18n.apply() re-reads data-i18n-html from the element on every run, so the
 * language toggle keeps working for free and t() needs no branch.
 *
 * app.js is a classic script at the end of <body>, so this runs during parse — before
 * DOMContentLoaded, and therefore before apply() first walks the document. */
if (window.SansPlatform?.isHandheld()) {
  const explain = document.getElementById('drop-explain');
  if (explain) explain.setAttribute('data-i18n-html', 'drop.explainHandheld');
}

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
    master.gain.value = parseFloat(el.masterVol.value);
    master.connect(audio.destination);
    // Into master, so master volume governs the synth exactly as it governs the stems.
    ribbonGain = audio.createGain();
    ribbonGain.gain.value = ribbonMuted ? 0 : ribbonVolume;
    ribbonGain.connect(master);
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

/* Height survives a reload the way the language toggle does. Storage can throw outright
 * in a private window, so every read and write is guarded — a lane that refuses to render
 * because localStorage is disabled would be a poor trade for remembering a number. */
function readRibbonHeight() {
  try {
    const v = parseInt(localStorage.getItem(RIBBON_H_KEY), 10);
    return Number.isFinite(v) ? clampRibbonH(v) : RIBBON_H_DEFAULT;
  } catch (_) { return RIBBON_H_DEFAULT; }
}

function writeRibbonHeight(h) {
  try { localStorage.setItem(RIBBON_H_KEY, String(h)); } catch (_) { /* private window */ }
}

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  if (!el.status) return;   // called from the last-resort error handler below
  lastSay = key ? { key, params, isErr } : null;
  el.status.hidden = !key;
  el.status.textContent = key ? tr(key, params) : '';
  el.status.classList.toggle('err', !!isErr);
}

/* Last resort. A script error here is nearly always a stale cached asset paired with a
 * fresh one, and the symptom is a page that looks fine and does nothing — the worst kind
 * of failure to debug from the user's side. Name the fix rather than fail mutely. */
window.addEventListener('error', (e) => {
  console.error('sans_bass:', e.error || e.message);
  say('status.crash', null, true);
});

// ---------------------------------------------------------------- loading

async function loadFiles(fileList, fallbackName, source) {
  const files = [...fileList].filter(f => AUDIO_RE.test(f.name));
  if (!files.length) { gcTrack('load-error'); say('status.noAudioFiles', null, true); return; }

  ensureAudio();
  stop(true);
  loopA = loopB = null;            // A-B points belong to the previous song
  renderLoopBadge();
  say(files.length > 1 ? 'status.decodingMany' : 'status.decodingOne', { n: files.length });

  // Decode in parallel: decodeAudioData runs off the main thread, so six stems
  // decode in roughly the time of the slowest one instead of the sum of all six.
  let done = 0;
  const failed = [];
  const settled = await Promise.all(files.map(async (file) => {
    try {
      const buf = await audio.decodeAudioData(await file.arrayBuffer());
      say('status.decodingProgress', { done: ++done, total: files.length });
      return { file, buffer: buf };
    } catch (e) {
      done++;
      failed.push(file.name);
      console.error(file.name, e);
      return null;
    }
  }));

  const loaded = settled.filter(Boolean);
  if (!loaded.length) {
    gcTrack('load-error');
    say('status.decodeFailAll', { names: failed.join(', ') }, true);
    return;
  }

  const items = loaded.map((l) => ({ name: l.file.name, buffer: l.buffer }));
  buildTracks(items, commonName(files, fallbackName));
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
async function loadZip(file) {
  if (!file) return;
  say('status.readingZip');
  let entries;
  try {
    entries = await window.SansUnzip.extract(file);
  } catch (err) {
    console.error(err);
    gcTrack('load-error');
    /* lib/unzip.js tags every error with a stable `code` and an English `message`. Keying
     * on the code translates them without modifying that file. Three different messages
     * share the code 'not-zip', so the translation is slightly less specific than the
     * English original — the trade for not reaching into lib/unzip.js. Any code without a
     * key falls through to the original message rather than printing "zipError.whatever". */
    const key = `zipError.${err.code}`;
    say(window.SansI18n.has(key) ? key : err.message, null, true);
    return;
  }
  if (!entries.length) {
    gcTrack('load-error');
    say('status.noAudioInZip', null, true);
    return;
  }
  return loadFiles(entries.map((e) => ({
    name: e.name,
    webkitRelativePath: e.webkitRelativePath,
    arrayBuffer: async () => e.bytes.buffer,
  })), file.name.replace(/\.zip$/i, ''), 'zip');
}

const isZip = (f) => /\.zip$/i.test(f.name);

/**
 * The one entry point behind the single Load button and behind a drop of one file.
 * There is still exactly one question — song or zip — but the extension answers it, so the
 * user is never asked to classify the file before the file dialog even opens.
 */
function loadAny(file) {
  if (!file) return;
  return isZip(file) ? loadZip(file) : loadSong(file);
}

/**
 * Load one unseparated song. Deliberately single-file: this is the separation entry point,
 * and a set of loose stem files is what a zip is for. `loadFiles` still takes many, because
 * loadZip hands it six.
 */
function loadSong(file) {
  if (!file) return;
  if (!AUDIO_RE.test(file.name)) {
    gcTrack('load-error');
    say('status.notAudioFile', { name: file.name }, true);
    return;
  }
  return loadFiles([file], undefined, 'song');
}

/**
 * Build lanes from decoded audio, whatever its origin.
 * @param {{name: string, buffer: AudioBuffer, stem?: string}[]} items
 * @param {string} title
 */
function buildTracks(items, title) {
  tracks = assignStems(items).map((t) => ({
    name: t.name,          // source filename — the ZIP folder name is derived from it
    stem: t.stem,
    label: t.label,
    color: t.color,
    order: t.order,
    buffer: t.buffer,
    muted: false,
    volume: 1,
    gain: null, peaks: null, canvas: null, laneEl: null, layers: null, nameEl: null,
  }));

  tracks.sort((a, b) => a.order - b.order);
  duration = Math.max(...tracks.map((t) => t.buffer.duration));
  offset = 0;

  tracks.forEach((t) => {
    t.gain = audio.createGain();
    t.gain.connect(master);
    t.peaks = computePeaks(t.buffer, duration);
  });

  window.__hasStems = hasMixPlusStems(tracks);
  muteSnapshot = null;          // a snapshot indexes the old lanes; it cannot survive a load

  buildUI(title);
  setMode('mix');
}

/**
 * Entry point for stems produced in-browser rather than loaded from disk.
 * @param {{name: string, buffer: AudioBuffer}} original
 * @param {Object<string, {left: Float32Array, right: Float32Array}>} stems
 */
function loadSeparated(original, stems) {
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

  loopA = loopB = null;
  renderLoopBadge();
  // No mix track means hasMixPlusStems() is false, so setMode('mix') inside buildTracks
  // leaves every stem unmuted — all six lanes on by default.
  buildTracks(items, original.name.replace(AUDIO_RE, ''));
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

/* The option VALUE is a stable key, never the label. Labels are translated, so keying on
 * them would break soloing the moment the language changed — and two unrecognised files
 * whose filename-derived labels happened to match were already indistinguishable. */
function buildModeOptions() {
  el.mode.innerHTML = '';
  const opts = [['mix', tr('stem.mix')]];
  tracks.forEach((t, i) => {
    if (t.stem === 'mix') return;
    opts.push([laneKey(t, i), tr('mode.only', { name: laneLabel(t) })]);
  });
  opts.push(['custom', tr('mode.custom')]);
  for (const [value, text] of opts) {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    el.mode.appendChild(o);
  }
}

function buildUI(title) {
  el.dropzone.hidden = true;
  el.player.hidden = false;
  el.title.textContent = title;
  el.tDur.textContent = fmt(duration);

  buildModeOptions();

  // lanes
  /* The previous song's frames describe the previous song's audio; drawn against the new
   * duration they would be silently wrong. Drop them before the lanes are rebuilt. */
  ribbon = null;
  el.lanes.innerHTML = '';
  tracks.forEach((t, i) => {
    const lane = document.createElement('div');
    lane.className = 'lane';

    const name = document.createElement('div');
    name.className = 'lane-name';
    name.style.color = t.color;
    /* Built from nodes rather than innerHTML: t.label can be a filename, and a filename
     * with markup in it used to be interpolated straight into the DOM. */
    name.title = tr('lane.tip');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = laneLabel(t);
    name.append(dot, txt);
    if (i < 10) {
      const kbd = document.createElement('span');
      kbd.className = 'kbd';
      kbd.textContent = String((i + 1) % 10);
      name.appendChild(kbd);
    }
    name.addEventListener('click', () => toggleTrack(t));

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const vol = document.createElement('div');
    vol.className = 'lane-vol';
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min: 0, max: 1.5, step: 0.01, value: 1 });
    slider.addEventListener('input', () => { t.volume = parseFloat(slider.value); applyGains(); });
    vol.appendChild(slider);

    lane.append(name, canvas, vol);
    el.lanes.appendChild(lane);

    t.canvas = canvas;
    t.nameEl = name;
    t.laneEl = lane;
    attachSeek(canvas);
  });

  /* Built here rather than parked in index.html: el.lanes.innerHTML = '' above destroys
   * anything inside #lanes, so a static element would vanish on the second song. Built
   * with the lanes it survives by construction, and lands directly under vocals. */
  ribbonEl = null;
  const vocals = tracks.find((t) => t.stem === 'vocals');
  if (vocals) {
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
    txt.textContent = tr('notes.lane');
    name.append(dot, txt);
    name.addEventListener('click', toggleRibbon);

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const vol = document.createElement('div');
    vol.className = 'lane-vol';
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min: 0, max: 1.5, step: 0.01, value: ribbonVolume });
    slider.addEventListener('input', () => { ribbonVolume = parseFloat(slider.value); applyRibbonGain(); });
    vol.appendChild(slider);

    /* Drag the bottom edge to grow the lane. Height is the only way to read pitch: at the
     * default the range can span 27 semitones, and note names need roughly 9 px each. */
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = tr('notes.resizeTip');
    attachRibbonResize(grip);

    lane.append(name, canvas, vol, grip);
    el.lanes.insertBefore(lane, vocals.laneEl.nextSibling);
    attachSeek(canvas);
    ribbonEl = { lane, canvas, txt, grip };
    lane.classList.toggle('muted', ribbonMuted);
  }

  attachSeek(el.mainWave);
  renderAll();
}

/* The interpretation layer hands its result over here. Called again on every change of a
 * detection parameter — see docs/transcription.md — so it must be cheap and idempotent. */
function setNotes(payload) {
  ribbon = payload && payload.notes && payload.frames ? payload : null;
  if (!ribbonEl) return;
  ribbonEl.lane.hidden = !ribbon;
  if (!ribbon) { ribbonEl.canvas.__layers = null; return; }
  renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  draw();
}

function renderAll() {
  const mp = mixPeaks();
  // The overview keeps true relative dynamics; it only ever shrinks, never boosts.
  renderWave(el.mainWave, mp, '#ffffff', el.mainWave.parentElement.clientWidth, 'main',
             Math.min(1, laneScale(mp)));
  tracks.forEach(t => {
    t.layers = renderWave(t.canvas, t.peaks, t.color, t.canvas.clientWidth, 'lane', laneScale(t.peaks));
  });
  if (ribbon && ribbonEl) renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  draw();
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

const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);      // C# D# F# G# A#
const LABEL_MIN_PX = 9;                            // below this, twelve labels are a smear

/* Pre-rendered idle/active layers, the same shape renderWave produces, so paint() draws
 * the ribbon with the identical blit-and-clip it uses for every waveform — playhead,
 * A-B shading and all. The layer object must keep the { idle, active, h, w } keys:
 * paint() reads L.w to place the playhead. */
function renderRibbon(canvas, payload, cssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth || canvas.clientWidth || 600));
  const h = ribbonHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const { notes, frames } = payload;
  const [loM, hiM] = window.SansRibbon.pitchRange(notes, { clip: payload.clip !== false });
  const span = hiM - loM || 1;
  const y = (midi) => h - ((midi - loM) / span) * h;
  // The SAME time-to-x mapping every other lane uses. Anything else drifts on resize.
  const x = (t) => (duration ? t / duration : 0) * w;
  const semi = Math.abs(y(0) - y(1));

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
      const isC = ((m % 12) + 12) % 12 === 0;
      c.fillStyle = isC
        ? (dim ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.22)')
        : (dim ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.075)');
      c.fillRect(0, Math.round(y(m - 0.5)), w, 1);
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
        if (!everySemitone && pc !== 0) continue;
        const label = NOTE_LETTERS[pc] + (Math.floor(m / 12) - 1);
        const ty = y(m);
        const tw = c.measureText(label).width;
        c.fillStyle = dim ? 'rgba(13,13,16,.72)' : 'rgba(13,13,16,.82)';
        c.fillRect(0, ty - semi / 2, tw + 7, semi);
        c.fillStyle = pc === 0
          ? (dim ? '#7b7b8b' : '#c9c9d6')
          : (dim ? '#5d5d6b' : '#8a8a99');
        c.fillText(label, 3, ty + 0.5);
      }
    }

    c.strokeStyle = dim ? '#41566b' : '#7fb2d9';
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    for (const seg of window.SansRibbon.contourSegments(frames, duration)) {
      c.beginPath();
      for (let i = 0; i < seg.length; i++) {
        const px = seg[i][0] * w;
        const py = y(seg[i][1]);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }

    for (const n of notes) {
      const out = n.midi < loM || n.midi > hiM;
      const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
      const bh = out ? 3 : Math.max(3, semi * 0.8);
      const bw = Math.max(2, x(n.end) - x(n.start));
      // A clipped note keeps its position in time but loses its pitch, so it is drawn in
      // the A-B orange rather than dropped — a hidden note would be a silent lie.
      c.fillStyle = out ? (dim ? '#7a5215' : '#ff9f1c') : (dim ? '#39604c' : '#6fbf8e');
      c.fillRect(x(n.start), by, bw, bh);

      /* The name only when it fits. Clipping text to a block narrower than the glyphs
       * produces a smear that reads as corruption rather than as a label — and note names
       * are never translated, in any locale, exactly as stem ids and filenames are not. */
      if (!out && bw > 26 && bh > 9) {
        c.fillStyle = dim ? '#1a1a20' : '#0d0d10';
        c.font = '600 9px ui-monospace, Menlo, monospace';
        c.textBaseline = 'middle';
        c.fillText(n.name, x(n.start) + 3, by + bh / 2 + 0.5);
      }
    }
    return off;
  };

  canvas.__layers = { idle: make(true), active: make(false), h, w };
  return canvas.__layers;
}

function draw() {
  const t = currentTime();
  const frac = duration ? Math.min(1, t / duration) : 0;
  paint(el.mainWave, frac);
  tracks.forEach(tr => paint(tr.canvas, frac));
  if (ribbon && ribbonEl) paint(ribbonEl.canvas, frac);
  el.tCur.textContent = fmt(t);
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
  paintLoopRegion(c, canvas, dpr, canvas === el.mainWave);

  c.fillStyle = 'rgba(255,255,255,.85)';
  c.fillRect(px, 0, Math.max(1, dpr), canvas.height);
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

// ---------------------------------------------------------------- transport

/** A-B repeat is armed only when both points exist and enclose a usable span. */
function loopOn() {
  return loopA !== null && loopB !== null && loopB - loopA >= MIN_LOOP;
}

function currentTime() {
  if (!playing) return offset;
  const elapsed = audio.currentTime - startedAt;
  if (elapsed <= 0) return offset;
  if (loopOn()) {
    // play() snaps offset into [A,B), so this stays positive and wraps cleanly.
    const span = loopB - loopA;
    return loopA + ((offset - loopA + elapsed) % span);
  }
  return Math.min(duration, offset + elapsed);
}

function play() {
  if (!tracks.length) return;
  ensureAudio();

  const looping = loopOn();
  if (looping) {
    // Confine the playhead to the loop, so pressing B at the end of a phrase
    // jumps straight back to A the way a musician expects.
    if (offset < loopA || offset >= loopB) offset = loopA;
  } else if (offset >= duration - 0.01) {
    offset = 0;
  }

  const t0 = audio.currentTime + LOOKAHEAD;
  const longest = tracks.reduce((a, b) => (b.buffer.duration > a.buffer.duration ? b : a));

  sources = tracks.map(t => {
    if (offset >= t.buffer.duration) return null;   // this stem already ended
    const src = audio.createBufferSource();
    src.buffer = t.buffer;
    src.connect(t.gain);

    // Loop on the audio thread rather than in JS: sample-accurate, identical across
    // every stem, and it keeps running when the tab is in the background.
    // A stem shorter than loopEnd would wrap at its own end and drift out of sync,
    // so it is left unlooped and simply falls silent instead.
    if (looping && t.buffer.duration >= loopB) {
      src.loop = true;
      src.loopStart = loopA;
      src.loopEnd = loopB;
    }

    // End of song is detected on the audio graph, not in the animation loop:
    // rAF is paused in background tabs, so the loop can't be trusted for transport.
    // A looping source never ends, so this only ever fires when not looping.
    if (t === longest && !src.loop) src.onended = () => { if (playing) stop(false); };
    src.start(t0, offset);
    return src;
  }).filter(Boolean);

  startedAt = t0;
  playing = true;
  el.play.classList.add('playing');
  applyGains();
  announceTransport(t0);
  tick();
}

/* notes.js is an ES module and cannot share scope with this file, so the transport is
 * broadcast the way the language switch already is. It carries t0 and offset rather than
 * "we started": the synth has to schedule against the SAME clock reading the stems were
 * started from, or it lands near them instead of with them. */
function announceTransport(t0) {
  window.dispatchEvent(new CustomEvent('sansbass:transport', {
    detail: {
      playing,
      t0: t0 ?? 0,
      offset,
      loopA: loopOn() ? loopA : null,
      loopB: loopOn() ? loopB : null,
    },
  }));
}

function stop(keepPosition) {
  if (playing) offset = currentTime();
  // Detach onended first so our own stop() doesn't re-enter through it.
  sources.forEach(s => { s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); });
  sources = [];
  playing = false;
  el.play.classList.remove('playing');
  cancelAnimationFrame(raf);
  if (!keepPosition) offset = 0;
  announceTransport(0);
  draw();
}

function toggle() {
  if (!playing) gcOnce('play');   // the bounce gate: did this visitor ever start audio?
  playing ? stop(true) : play();
}

function seek(seconds) {
  gcBump('seek');
  const wasPlaying = playing;
  if (playing) stop(true);
  offset = Math.max(0, Math.min(duration, seconds));
  // While A-B repeat is armed the transport stays inside the loop; clear it to roam.
  if (loopOn()) offset = Math.max(loopA, Math.min(loopB - 0.001, offset));
  if (wasPlaying) play(); else draw();
}

// ---------------------------------------------------------------- A-B repeat

/** Set A or B at the playhead, then restart playback so the audio graph picks it up. */
function setLoopPoint(which) {
  if (!tracks.length) return;
  gcBump('loop');
  const t = currentTime();
  if (which === 'a') loopA = t; else loopB = t;

  // Tolerate them being set in either order.
  if (loopA !== null && loopB !== null && loopA > loopB) {
    const swap = loopA; loopA = loopB; loopB = swap;
  }
  if (loopA !== null && loopB !== null && loopB - loopA < MIN_LOOP) {
    say('status.loopTooShort', { min: MIN_LOOP }, true);
    if (which === 'a') loopA = null; else loopB = null;
  }

  refreshLoop();
}

function clearLoop() {
  loopA = loopB = null;
  refreshLoop();
}

/** Rebuild the running sources so new loop bounds take effect immediately. */
function refreshLoop() {
  renderLoopBadge();
  if (playing) { stop(true); play(); } else { draw(); }
}

function renderLoopBadge() {
  const badge = el.loopBadge;
  if (!badge) return;
  if (loopA === null && loopB === null) { badge.hidden = true; return; }
  badge.hidden = false;
  if (loopOn()) {
    el.loopText.textContent = tr('loop.range',
      { a: fmt(loopA), b: fmt(loopB), len: (loopB - loopA).toFixed(1) });
    badge.classList.add('armed');
  } else {
    el.loopText.textContent = tr(loopA !== null ? 'loop.aSet' : 'loop.bSet');
    badge.classList.remove('armed');
  }
}

function tick() {
  raf = requestAnimationFrame(() => {
    if (!playing) return;
    draw();
    tick();
  });
}

// ---------------------------------------------------------------- routing

/* The ribbon is deliberately NOT in `tracks`, so mute-all and solo skip it for free —
 * pressing 0 must never silence the reference you are checking against. */
function applyRibbonGain() {
  if (ribbonGain && audio) {
    ribbonGain.gain.setTargetAtTime(ribbonMuted ? 0 : ribbonVolume, audio.currentTime, 0.012);
  }
  ribbonEl?.lane.classList.toggle('muted', ribbonMuted);
}

function toggleRibbon() {
  ribbonMuted = !ribbonMuted;
  applyRibbonGain();
  window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: ribbonMuted } }));
}

function applyGains() {
  if (!audio) return;
  const now = audio.currentTime;
  const hasStems = window.__hasStems;
  tracks.forEach(t => {
    let on = !t.muted;
    // Never let a full-mix file play on top of its own stems.
    if (hasStems && t.stem === 'mix' && el.mode.value !== 'mix') on = false;
    const g = on ? t.volume : 0;
    t.gain.gain.setTargetAtTime(g, now, 0.012);
    t.laneEl?.classList.toggle('muted', !on);
  });
  // Every mute path routes through here, so the button label can never drift out of sync.
  renderAllToggle();
}

/* Three states, and the label is the only thing that says which one you are in:
 *   something muted            → "Unmute all"
 *   everything on, snapshot    → "Restore previous"
 *   everything on, no snapshot → "Mute all"   (the fresh-load state)
 * The button used to be disabled in that last case, which is what a beta tester read as
 * the 0 key being broken: on a separated song every lane starts on, so the very first
 * press was always the dead one. Split out of applyGains so retranslate() can re-render
 * the label without touching gain. */
function renderAllToggle() {
  const on = allLanesOn();
  el.allToggle.textContent =
    !on ? tr('btn.unmuteAll') : muteSnapshot ? tr('btn.restorePrevious') : tr('btn.muteAll');
  el.allToggle.disabled = false;
}

/**
 * Re-render the strings the DOM is already holding, after a language change.
 *
 * It must NOT rebuild the lanes. Rebuilding would drop every canvas and force a full
 * waveform re-render, and it must not touch `tracks`, `sources`, gain nodes or the
 * playhead — switching language mid-practice has to be completely inaudible. The lane
 * name's text node is mutated in place for exactly that reason.
 */
function retranslate() {
  if (tracks.length) {
    const mode = el.mode.value;
    buildModeOptions();
    el.mode.value = mode;            // rebuilding the options resets the selection
    tracks.forEach((t) => {
      if (!t.nameEl) return;
      t.nameEl.title = tr('lane.tip');
      const txt = t.nameEl.querySelector('.txt');
      if (txt) txt.textContent = laneLabel(t);
    });
  }
  // Lane labels translate; the note NAMES drawn inside the ribbon never do.
  if (ribbonEl) ribbonEl.txt.textContent = tr('notes.lane');
  renderLoopBadge();
  // #all-toggle carries data-i18n="btn.unmuteAll", so setLocale's apply() has just reset
  // its text — clobbering "Restore previous". This runs after, and must keep doing so:
  // setLocale applies the markup first and dispatches the event second, in that order.
  renderAllToggle();
  if (lastSay) say(lastSay.key, lastSay.params, lastSay.isErr);
  renderLangToggle();
}

/** Keep the pressed half of the switcher in step with the active locale. */
function renderLangToggle() {
  if (!el.langToggle) return;
  const active = window.SansI18n.getLocale();
  el.langToggle.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === active));
  });
}

/** Lanes the all-on/all-off button acts on — the stems, never a full-mix file. */
function stemLanes() {
  return window.__hasStems ? tracks.filter(t => t.stem !== 'mix') : tracks;
}

function allLanesOn() {
  const lanes = stemLanes();
  return lanes.length > 0 && lanes.every(t => !t.muted);
}

function allLanesOff() {
  const lanes = stemLanes();
  return lanes.length > 0 && lanes.every(t => t.muted);
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
function toggleAllTracks() {
  gcOnce('unmute-all');
  if (allLanesOn()) {
    if (muteSnapshot) {
      const snap = muteSnapshot;
      muteSnapshot = null;
      stemLanes().forEach((t, i) => { t.muted = snap[i]; });
    } else {
      stemLanes().forEach(t => { t.muted = true; });
    }
    el.mode.value = 'custom';
    applyGains();
    return;
  }

  muteSnapshot = allLanesOff() ? null : stemLanes().map(t => t.muted);
  if (window.__hasStems) {
    // Unmuting the stems is what silences the mix file, via applyGains.
    stemLanes().forEach(t => { t.muted = false; });
    el.mode.value = 'custom';
    applyGains();
  } else {
    setMode('mix');   // every lane on *is* the full mix, so keep the dropdown honest
  }
}

function setMode(mode) {
  const hasStems = window.__hasStems;
  if (mode === 'mix') {
    tracks.forEach(t => {
      // With both a mix file and stems, the mix file wins; otherwise sum the stems.
      t.muted = hasStems ? (t.stem !== 'mix') : false;
    });
  } else if (mode !== 'custom') {
    tracks.forEach((t, i) => { t.muted = laneKey(t, i) !== mode; });
  }
  el.mode.value = mode;
  applyGains();
}

function toggleTrack(t) {
  gcBump('toggle');
  if (t.stem) gcOnce(`toggle-${t.stem}`);   // stem ids, never labels — never a filename
  // The mix lane is the exception: a full-mix file must never sound on top of its own
  // stems, so toggling it switches the whole routing instead of just its own gain.
  if (window.__hasStems && t.stem === 'mix') {
    if (el.mode.value === 'mix') {
      tracks.forEach(o => { o.muted = o.stem === 'mix'; });   // hand over to the stems
      el.mode.value = 'custom';
      applyGains();
    } else {
      setMode('mix');
    }
    return;
  }
  t.muted = !t.muted;
  el.mode.value = 'custom';
  applyGains();
}

// ---------------------------------------------------------------- input

/* Pointer capture, so the drag survives the cursor leaving the 6px grip — without it a
 * fast drag detaches the moment you outrun the element. */
function attachRibbonResize(grip) {
  let startY = 0;
  let startH = 0;
  let dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = ribbonHeight;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = clampRibbonH(startH + (e.clientY - startY));
    if (next === ribbonHeight) return;
    ribbonHeight = next;
    if (ribbon && ribbonEl) {
      renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
      draw();
    }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    writeRibbonHeight(ribbonHeight);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function attachSeek(canvas) {
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    seek(posToTime(e));
  });
}

on(el.play, 'click', toggle);
on(el.loopClear, 'click', clearLoop);
on(el.allToggle, 'click', toggleAllTracks);
/* Hand focus back after a choice. The global keydown handler ignores events aimed at a
 * <select> — it has to, or ArrowLeft/Right would seek instead of moving the selection —
 * so a select that keeps focus after being used silently disables every hotkey until the
 * user happens to click elsewhere. Blurring on `change` is the whole fix. */
on(el.mode, 'change', () => { setMode(el.mode.value); el.mode.blur(); });
on(el.langToggle, 'click', (e) => {
  const btn = e.target.closest('button[data-lang]');
  if (btn) window.SansI18n.setLocale(btn.dataset.lang);   // an explicit choice persists
});
window.addEventListener('sansbass:langchange', retranslate);
renderLangToggle();
gcOnce(`lang-${window.SansI18n.getLocale()}`);
on(el.masterVol, 'input', () => {
  ensureAudio();
  master.gain.setTargetAtTime(parseFloat(el.masterVol.value), audio.currentTime, 0.01);
});

/* The value is cleared after dispatching so picking the *same* file twice in a row still
 * fires `change`. With two inputs that was rare; with one it is the obvious retry after a
 * decode error, and a silent no-op there looks like the button is broken. */
on(el.fileInput, 'change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  loadAny(file);
});

document.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(e.target.tagName) && e.key !== ' ') return;
  if (!tracks.length) return;
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime() - 5); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime() + 5); }
  else if (e.key === '0') toggleAllTracks();
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setLoopPoint('a'); }
  else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setLoopPoint('b'); }
  else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') { e.preventDefault(); clearLoop(); }
  else if (/^[1-9]$/.test(e.key)) {
    const t = tracks[parseInt(e.key, 10) - 1];
    if (t) toggleTrack(t);
  }
});

// drag & drop: one song, or one .zip of stems

/* The drop target is the whole window, and #drag-overlay is what says so. It has to be an
 * overlay rather than a highlight on #dropzone, because #dropzone is hidden the moment a
 * song loads — and dropping a second song over the player is the common case, exactly when
 * there was no visible target at all. The overlay is `pointer-events: none` so it never
 * becomes the drop target itself and never disturbs the depth count below. */
function showDropTarget(on) {
  if (el.dragOverlay) el.dragOverlay.hidden = !on;
}

/* dragenter/dragleave fire once per element the cursor crosses, so "a leave means the file
 * is gone" flickers the overlay off over every lane boundary. Count enters, trust zero. */
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; showDropTarget(true); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; showDropTarget(false); } });
document.addEventListener('dragend', () => { dragDepth = 0; showDropTarget(false); });

/* preventDefault on dragover is the one call that makes the window a drop target at all.
 * Without it the browser keeps its default and navigates to the dropped file. */
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

/* Drop accepts exactly what the two buttons accept: ONE song, or ONE zip of stems.
 *
 * Dropping a FOLDER is deliberately not supported. It needed the directory entries API,
 * which Chrome blocks on file:// — so it only ever worked over http://, and the whole
 * recursive walk existed to serve that one case. A zip does the same job everywhere.
 * A dropped folder is still *detected*, purely to say what to do about it: degrading that
 * into a generic "nothing usable here" would be a worse answer, not a smaller one. */
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  showDropTarget(false);
  const dt = e.dataTransfer;
  const dropped = [...(dt.files || [])];

  if (dropped.length === 1) {
    // A zip is a plain file, so it arrives in dt.files whatever else is blocked. This is
    // what makes zip drag-and-drop work from disk.
    if (isZip(dropped[0]) || AUDIO_RE.test(dropped[0].name)) return loadAny(dropped[0]);
  }

  // Nothing usable — say precisely which case it was rather than failing silently.
  // webkitGetAsEntry is used only to ask "was that a directory?"; it returns null on
  // file://, where a folder still arrives in dt.files with no type and no extension.
  const looksLikeFolder =
    [...(dt.items || [])].some(i => i.webkitGetAsEntry?.()?.isDirectory) ||
    dropped.some(f => !f.type && !AUDIO_RE.test(f.name) && !isZip(f));

  if (looksLikeFolder) {
    gcTrack('folder-drop');
    say('status.folderDrop', null, true);
  } else if (dropped.length > 1) {
    say('status.tooManyFiles', { n: dropped.length }, true);
  } else {
    say('status.notSongOrZip', null, true);
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  if (!tracks.length) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 120);
});

/* Interface for separate.js, which is an ES module and cannot share scope with this
 * classic script. Kept deliberately small. */
window.sansBass = {
  loadSeparated,
  /** The currently loaded full-mix track, or null. */
  currentMix: () => {
    const t = tracks.find((x) => x.stem === 'mix');
    // t.name, not t.label: assignStems relabels a lone file to "Full mix", which would
    // then become the ZIP's folder name.
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** True when exactly one track is loaded — i.e. an unseparated song. */
  isSingleTrack: () => tracks.length === 1,
  /** A loaded stem's buffer by name, or null. notes.js reads 'vocals' through this. */
  stemBuffer: (stem) => {
    const t = tracks.find((x) => x.stem === stem);
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** Hand detected notes to the player, or null to clear the lane. */
  setNotes,
  /** Where notes.js connects its oscillators, and the clock they must use. */
  notesAudio: () => (audio && ribbonGain ? { ctx: audio, destination: ribbonGain } : null),
  /** Current transport, for scheduling a synth that starts mid-playback. */
  transport: () => ({ playing, t0: startedAt, offset: playing ? offset : offset,
                      loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null }),
  /** True while the notes lane is silent. */
  ribbonMuted: () => ribbonMuted,
  setRibbonVolume: (v) => { ribbonVolume = v; applyRibbonGain(); },
  say,
};
