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
  fileInput: $('file-input'), zipInput: $('zip-input'),
  play: $('play'), title: $('title'), mainWave: $('main-wave'),
  tCur: $('t-cur'), tDur: $('t-dur'), mode: $('mode'),
  masterVol: $('master-vol'), lanes: $('lanes'),
  loopBadge: $('loop-badge'), loopText: $('loop-text'), loopClear: $('loop-clear'),
  allToggle: $('all-toggle'),
};

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
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function say(msg, isErr) {
  el.status.hidden = !msg;
  el.status.textContent = msg || '';
  el.status.classList.toggle('err', !!isErr);
}

// ---------------------------------------------------------------- loading

async function loadFiles(fileList) {
  const files = [...fileList].filter(f => AUDIO_RE.test(f.name));
  if (!files.length) { say('No audio files found in that drop. Supported: wav, flac, m4a, mp3, opus, aiff.', true); return; }

  ensureAudio();
  stop(true);
  loopA = loopB = null;            // A-B points belong to the previous song
  renderLoopBadge();
  say(`Decoding ${files.length} file${files.length > 1 ? 's' : ''}…`);

  // Decode in parallel: decodeAudioData runs off the main thread, so six stems
  // decode in roughly the time of the slowest one instead of the sum of all six.
  let done = 0;
  const failed = [];
  const settled = await Promise.all(files.map(async (file) => {
    try {
      const buf = await audio.decodeAudioData(await file.arrayBuffer());
      say(`Decoding… ${++done}/${files.length}`);
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
    say(`Could not decode ${failed.join(', ')} — this browser may not support that codec. ` +
        `Re-encode as .m4a or .wav.`, true);
    return;
  }

  const items = loaded.map((l) => ({ name: l.file.name, buffer: l.buffer }));
  buildTracks(items, commonName(files));

  if (failed.length) {
    say(`Skipped ${failed.join(', ')} — codec not supported by this browser. Re-encode as .m4a.`, true);
  } else if (tracks.length > 1 && tracks.every((t) => !t.stem)) {
    say('None of these filenames looked like stems, so they are all playing layered on top of ' +
        'each other. Rename them vocals / guitar / bass / drums to get labelled lanes.');
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
  say('Reading zip…');
  let entries;
  try {
    entries = await window.SansUnzip.extract(file);
  } catch (err) {
    console.error(err);
    say(err.message, true);      // already user-ready; see lib/unzip.js zipError()
    return;
  }
  if (!entries.length) {
    say('No audio files in that zip. Supported: wav, flac, m4a, mp3, opus, aiff.', true);
    return;
  }
  return loadFiles(entries.map((e) => ({
    name: e.name,
    webkitRelativePath: e.webkitRelativePath,
    arrayBuffer: async () => e.bytes.buffer,
  })));
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
    gain: null, peaks: null, canvas: null, laneEl: null, layers: null,
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

function commonName(files) {
  const paths = files.map(f => f.webkitRelativePath || f.name);
  if (paths.length === 1) return paths[0].replace(AUDIO_RE, '');
  const dir = paths[0].split('/').slice(0, -1).pop();
  return dir || `${files.length} tracks`;
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
  el.dropzone.hidden = true;
  el.player.hidden = false;
  el.title.textContent = title;
  el.tDur.textContent = fmt(duration);

  // mode dropdown
  el.mode.innerHTML = '';
  const opts = [['mix', 'Full mix']];
  tracks.filter(t => t.stem !== 'mix').forEach(t => opts.push([t.label, `${t.label} only`]));
  opts.push(['custom', 'Custom…']);
  for (const [value, text] of opts) {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    el.mode.appendChild(o);
  }

  // lanes
  el.lanes.innerHTML = '';
  tracks.forEach((t, i) => {
    const lane = document.createElement('div');
    lane.className = 'lane';

    const name = document.createElement('div');
    name.className = 'lane-name';
    name.style.color = t.color;
    name.title = 'Click to mute or unmute this track';
    name.innerHTML = `<span class="dot"></span><span class="txt">${t.label}</span>` +
                     (i < 10 ? `<span class="kbd">${(i + 1) % 10}</span>` : '');
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
    t.laneEl = lane;
    attachSeek(canvas);
  });

  attachSeek(el.mainWave);
  renderAll();
}

function renderAll() {
  const mp = mixPeaks();
  // The overview keeps true relative dynamics; it only ever shrinks, never boosts.
  renderWave(el.mainWave, mp, '#ffffff', el.mainWave.parentElement.clientWidth, 'main',
             Math.min(1, laneScale(mp)));
  tracks.forEach(t => {
    t.layers = renderWave(t.canvas, t.peaks, t.color, t.canvas.clientWidth, 'lane', laneScale(t.peaks));
  });
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

function draw() {
  const t = currentTime();
  const frac = duration ? Math.min(1, t / duration) : 0;
  paint(el.mainWave, frac);
  tracks.forEach(tr => paint(tr.canvas, frac));
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
  tick();
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
  draw();
}

function toggle() { playing ? stop(true) : play(); }

function seek(seconds) {
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
  const t = currentTime();
  if (which === 'a') loopA = t; else loopB = t;

  // Tolerate them being set in either order.
  if (loopA !== null && loopB !== null && loopA > loopB) {
    const swap = loopA; loopA = loopB; loopB = swap;
  }
  if (loopA !== null && loopB !== null && loopB - loopA < MIN_LOOP) {
    say(`A and B are less than ${MIN_LOOP}s apart — move the playhead further before setting the second point.`, true);
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
    el.loopText.textContent = `A–B ${fmt(loopA)} → ${fmt(loopB)} (${(loopB - loopA).toFixed(1)}s)`;
    badge.classList.add('armed');
  } else {
    el.loopText.textContent = loopA !== null ? 'A set — press B to close the loop'
                                             : 'B set — press A to close the loop';
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
  // "Restore previous" only when there really is a previous. Everything already on with
  // nothing saved reads as a disabled "Unmute all" — true, and it explains the disabling.
  const canRestore = allLanesOn() && !!muteSnapshot;
  el.allToggle.textContent = canRestore ? 'Restore previous' : 'Unmute all';
  el.allToggle.disabled = allLanesOn() && !muteSnapshot;
}

/** Lanes the all-on/all-off button acts on — the stems, never a full-mix file. */
function stemLanes() {
  return window.__hasStems ? tracks.filter(t => t.stem !== 'mix') : tracks;
}

function allLanesOn() {
  const lanes = stemLanes();
  return lanes.length > 0 && lanes.every(t => !t.muted);
}

/**
 * "Unmute all", and press it again to come back. The snapshot is taken at the moment
 * everything is turned on, so muting a lane and pressing again returns to *that* state,
 * not to whatever was saved two presses ago.
 */
function toggleAllTracks() {
  if (allLanesOn()) {
    if (!muteSnapshot) return;               // already on and nothing saved
    const snap = muteSnapshot;
    muteSnapshot = null;
    stemLanes().forEach((t, i) => { t.muted = snap[i]; });
    el.mode.value = 'custom';
    applyGains();
    return;
  }

  muteSnapshot = stemLanes().map(t => t.muted);
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
    tracks.forEach(t => { t.muted = t.label !== mode; });
  }
  el.mode.value = mode;
  applyGains();
}

function toggleTrack(t) {
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

el.play.addEventListener('click', toggle);
el.loopClear.addEventListener('click', clearLoop);
el.allToggle.addEventListener('click', toggleAllTracks);
el.mode.addEventListener('change', () => setMode(el.mode.value));
el.masterVol.addEventListener('input', () => {
  ensureAudio();
  master.gain.setTargetAtTime(parseFloat(el.masterVol.value), audio.currentTime, 0.01);
});

el.fileInput.addEventListener('change', e => loadFiles(e.target.files));
el.zipInput.addEventListener('change', e => loadZip(e.target.files[0]));

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

// drag & drop, including folders
['dragenter', 'dragover'].forEach(ev =>
  document.addEventListener(ev, e => { e.preventDefault(); el.dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev =>
  document.addEventListener(ev, e => { e.preventDefault(); el.dropzone.classList.remove('over'); }));

const onFileUrl = () => location.protocol === 'file:';

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const dt = e.dataTransfer;

  // A zip is a plain file, so it arrives in dt.files even on file://, where the directory
  // entries API is blocked. This branch is what makes zip drag-and-drop work from disk.
  const dropped = [...(dt.files || [])];
  if (dropped.length === 1 && /\.zip$/i.test(dropped[0].name)) return loadZip(dropped[0]);

  const items = [...(dt.items || [])];
  const entries = items.map(i => i.webkitGetAsEntry?.() ?? null);

  const files = [];
  let sawDirectory = false;
  let walkFailed = false;

  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) sawDirectory = true;
    try {
      await walkEntry(entry, files);
    } catch (err) {
      walkFailed = true;               // e.g. blocked by file:// restrictions
      console.error('Could not read dropped entry:', err);
    }
  }
  if (files.length) return loadFiles(files);

  // Fall back to the plain file list, which works in places the entries API doesn't.
  const plain = [...(dt.files || [])].filter(f => AUDIO_RE.test(f.name));
  if (plain.length) return loadFiles(plain);

  // Nothing usable — say precisely why rather than failing silently.
  const looksLikeFolder = sawDirectory || walkFailed ||
    [...(dt.files || [])].some(f => !f.type && !AUDIO_RE.test(f.name));

  if (looksLikeFolder && onFileUrl()) {
    say('Chrome will not let a page opened straight from disk read a dropped folder. ' +
        'Zip the folder and drop the zip instead (that works), drag the audio files ' +
        'themselves, or serve the directory over http — see the README.', true);
  } else if (looksLikeFolder) {
    say('That folder contained no audio files.', true);
  } else {
    say('No audio files in that drop. Supported: wav, flac, m4a, mp3, opus, aiff.', true);
  }
});

/**
 * Promisified FileSystem entry calls. These APIs take (successCb, errorCb) — wiring up
 * only the success callback means any failure hangs the await forever, which is how a
 * blocked folder read turns into a drop that silently does nothing.
 */
const fsCall = (fn) => new Promise((resolve, reject) => {
  let settled = false;
  const ok = (v) => { settled = true; resolve(v); };
  const fail = (err) => { settled = true; reject(err || new Error('FileSystem call failed')); };
  // Belt and braces: some builds neither call back nor throw. Never hang the UI.
  setTimeout(() => { if (!settled) fail(new Error('FileSystem call timed out')); }, 5000);
  try { fn(ok, fail); } catch (err) { fail(err); }
});

async function walkEntry(entry, out) {
  if (entry.isFile) {
    out.push(await fsCall((ok, fail) => entry.file(ok, fail)));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await fsCall((ok, fail) => reader.readEntries(ok, fail));
      for (const child of batch) await walkEntry(child, out);
    } while (batch.length);
  }
}

// Opened straight from disk, folder drag-and-drop is unreliable in Chrome, so point at
// the route that always works before the user discovers the failure the hard way.
if (onFileUrl()) {
  const hint = document.createElement('p');
  hint.className = 'dim';
  hint.innerHTML = 'Opened from disk — dragging a folder will not work here. ' +
                   'Zip the folder and drop the <strong>.zip</strong> instead.';
  el.dropzone.appendChild(hint);
}

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
  say,
};
