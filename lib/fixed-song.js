/**
 * lib/fixed-song.js — the one song a fixed-song page plays, and its download.
 *
 * The player's own two ways in (one audio file, or one zip of stems) both start from a file
 * the user picked. A fixed-song page has neither: the song is decided by the page, fetched
 * from a URL, and handed to the same `load` command a picked file would have been. Nothing
 * downstream of that handoff knows the difference — it is a `File` of a stems zip either way.
 *
 * Inbound only, and that is the whole point: this fetches a zip the page's author published,
 * the same shape of inbound fetch as the ONNX runtime and the separation model. No audio, no
 * filename and no song title ever leaves the machine. See CLAUDE.md's "Nothing leaves the
 * machine".
 *
 * The `subscribe`/`getSnapshot`/`commands` shape is the one `separation`, `detection` and
 * `tempoGrid` already use: this state has no owner other than the module that computes it,
 * so it is published from here rather than routed through lib/player-application.js.
 *
 * A page declares its song in markup — `<body data-fixed-song="https://…/stems.zip">` — and
 * not by importing this module and calling configure() at load time. That distinction is
 * load-bearing, and it is the kind that only shows up in a build: Vite merges every module
 * script tag on a page into one entry chunk, and a static import hoists above the statements
 * around it, so an entry module that "runs before app.js" in dev runs *after* it once built,
 * and the shell's first render paints the file input this page is supposed to not have. The
 * attribute is in the document before any module evaluates at all, so there is no order to
 * get wrong.
 */
import { ignoreReportedError, playerApplication } from './player-application.js';

const listeners = new Set();

/** The page's song, from its markup or from configure(); null on an ordinary player page. */
let config = null;
/** idle → downloading → loaded, or → failed (retryable). */
let phase = 'idle';
let received = 0;
let total = 0;
let failure = '';
let cached = null;

function publish() {
  cached = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!cached) {
    const current = resolveConfig();
    cached = Object.freeze({
      active: !!current,
      url: current ? current.url : '',
      phase,
      received,
      total,
      failure,
    });
  }
  return cached;
}

/**
 * Declare this page's one song directly. The markup attribute is how a page normally does
 * it; this is the same thing said in code, for tests and for a caller that has a URL the
 * document could not have known.
 */
export function configure({ url, filename }) {
  if (typeof url !== 'string' || !url) throw new TypeError('a fixed song needs a url');
  config = { url, filename: filename || filenameFrom(url) };
  publish();
}

/** The zip's own name, for the File handed to `load`. Only ever a fallback song title. */
function filenameFrom(url) {
  const last = url.split(/[?#]/)[0].split('/').pop();
  return last && /\.zip$/i.test(last) ? decodeURIComponent(last) : 'stems.zip';
}

/**
 * Resolve the page's declaration, reading the markup the first time it is asked for. A page
 * with no attribute is simply not a fixed-song page, and is re-checked rather than cached as
 * a negative — the read is one dataset lookup, and caching "no" before <body> exists would
 * be a silent way to break the page.
 */
function resolveConfig() {
  if (config) return config;
  const declared = globalThis.document?.body?.dataset?.fixedSong;
  // Assigned, not published through configure(): reading the page's own declaration is not
  // a state change — it was always this page's song — and getSnapshot() resolves lazily, so
  // publishing here would notify subscribers in the middle of a React render.
  if (declared) config = { url: declared, filename: filenameFrom(declared) };
  return config;
}

/** True on a page that declared a fixed song. */
export function isFixedSong() {
  return !!resolveConfig();
}

async function readWithProgress(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let shown = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    // One publication per whole percent, not per chunk: a 13 MB zip arrives in a few hundred
    // chunks and every one of them would otherwise re-render the panel for an invisible change.
    const percent = total ? Math.floor((received / total) * 100) : -1;
    if (percent !== shown) {
      shown = percent;
      publish();
    }
  }
  return new Blob(chunks, { type: 'application/zip' });
}

/**
 * Fetch the configured zip and hand it to the ordinary load command.
 *
 * Idempotent by phase, and synchronously so: `phase` leaves 'idle' before the first await,
 * so StrictMode's mount/unmount/mount of the panel that starts it cannot download twice.
 */
async function start() {
  if (!resolveConfig() || phase !== 'idle') return;
  phase = 'downloading';
  received = 0;
  total = 0;
  failure = '';
  publish();
  let blob;
  try {
    const response = await fetch(config.url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const declared = Number(response.headers.get('content-length'));
    // A cross-origin host that does not expose Content-Length (or serves the zip chunked)
    // leaves total at 0, which the panel reads as "show bytes received, not a percentage".
    total = Number.isFinite(declared) && declared > 0 ? declared : 0;
    blob = response.body ? await readWithProgress(response) : await response.blob();
  } catch (error) {
    console.error('sans_bass: fixed song download failed', error);
    phase = 'failed';
    failure = error.message || String(error);
    publish();
    return;
  }
  // The handoff is deliberately outside that try. Everything past here — reading the zip,
  // decoding each stem, and any failure in either — is the player's own status line to
  // report, and folding it into `failure` would offer a Retry that re-downloads bytes that
  // arrived perfectly well.
  phase = 'loaded';
  publish();
  ignoreReportedError(playerApplication.commands.load(
    new File([blob], config.filename, { type: 'application/zip' }),
  ));
}

/** Returns start()'s promise so a caller can wait for the second attempt, not just fire it. */
function retry() {
  if (phase !== 'failed') return Promise.resolve();
  phase = 'idle';
  publish();
  return start();
}

export const fixedSong = Object.freeze({
  subscribe,
  getSnapshot,
  commands: Object.freeze({ start, retry }),
});
