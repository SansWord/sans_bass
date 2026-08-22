/* iOS separation spike — page.
 *
 * Two jobs, both of them about surviving a process kill:
 *
 *  1. Breadcrumbs. The worker announces every risky step; this file writes each one to
 *     localStorage synchronously. When iOS reaps the tab the page reloads with its log
 *     intact, so a crash reports where it happened instead of vanishing.
 *  2. A visible build stamp. GitHub Pages pins everything to max-age=600, so for ten
 *     minutes after a deploy the phone can be running the previous spike against the new
 *     instructions. Check the stamp before trusting a result.
 */

const BUILD = 'spike-1 (2026-08-21)';

const KEY = { log: 'spike.log', stage: 'spike.stage', probe: 'spike.probe' };
const $ = (id) => document.getElementById(id);

/* Safari private mode throws on every storage access — same guard as lib/i18n.js. */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* nothing to do */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nothing to do */ } },
};

let lines = [];
let t0 = performance.now();
let worker = null;

function render() {
  $('log').value = lines.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

function log(s) {
  lines.push(`${((performance.now() - t0) / 1000).toFixed(2).padStart(7)}s  ${s}`);
  store.set(KEY.log, lines.join('\n'));
  render();
}

/* Written BEFORE the step runs, so it survives the step killing the process. */
function crumb(name) {
  store.set(KEY.stage, name);
  log(`▸ ${name}`);
}

function showPrevious() {
  const prev = store.get(KEY.log);
  const stage = store.get(KEY.stage);
  const probe = store.get(KEY.probe);
  if (!prev) { $('prev').hidden = true; return; }
  $('prev').hidden = false;
  $('prev-stage').textContent = stage || '(none recorded)';
  $('prev-probe').textContent = probe || '?';
  $('prev-log').value = prev;
}

function options() {
  return {
    backend: $('backend').value,
    seconds: +$('seconds').value,
    release: $('release').checked,
    accumulate: $('accumulate').checked,
  };
}

function run(probe) {
  const opt = options();
  // A fresh worker per probe: a probe must never inherit a session, a wasm heap or a GPU
  // device from the one before it, or the plateau it reports is not its own.
  worker?.terminate();
  lines = [];
  t0 = performance.now();
  store.del(KEY.log);
  store.set(KEY.probe, `${probe} backend=${opt.backend} seconds=${opt.seconds} release=${opt.release} accumulate=${opt.accumulate}`);
  crumb(`start ${probe}`);
  log(`build ${BUILD}`);
  log(`options: ${JSON.stringify(opt)}`);
  log(`ua: ${navigator.userAgent}`);
  $('prev').hidden = true;

  // ?t= defeats the Pages 600s cache, so an edited worker is never silently stale.
  worker = new Worker(`ios-webgpu.worker.js?t=${Date.now()}`, { type: 'module' });

  worker.onerror = (e) => {
    crumb('WORKER ERROR');
    log(`worker error: ${e.message || '(no message — OOM reaper?)'}`);
  };

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'stage') crumb(m.name);
    else if (m.type === 'log') log(m.message);
    else if (m.type === 'download') log(`download ${(m.loaded / 1e6).toFixed(0)} / ${(m.total / 1e6).toFixed(0)} MB`);
    else if (m.type === 'progress') log(`segment ${m.segment}/${m.total} — ${m.ms.toFixed(0)} ms`);
    else if (m.type === 'error') { crumb('ERROR'); log(`✗ ${m.message}`); log(m.stack || ''); }
    else if (m.type === 'done') { crumb('DONE — survived'); log(`✓ ${JSON.stringify(m)}`); }
  };

  worker.postMessage({ probe, ...opt });
}

for (const id of ['session', 'segment', 'loop', 'gpu-limits', 'gpu-ladder']) {
  $(`run-${id}`).addEventListener('click', () => run(id));
}

$('copy').addEventListener('click', async () => {
  const text = `${$('log').value}\n\n--- previous run ---\n${$('prev-log').value || '(none)'}`;
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'copied'; }
  catch { $('log').select(); $('copy').textContent = 'select + copy manually'; }
  setTimeout(() => { $('copy').textContent = 'Copy log'; }, 2000);
});

$('clear').addEventListener('click', () => {
  for (const k of Object.values(KEY)) store.del(k);
  lines = [];
  render();
  $('prev').hidden = true;
});

$('build').textContent = BUILD;
showPrevious();
