import { stemsZip } from './audio-fixtures.js';

export async function waitFor(predicate, message = 'condition', timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

/** Load the production index page in an isolated same-origin frame. */
export async function openPlayer() {
  const frame = document.createElement('iframe');
  frame.src = '/index.html';
  frame.style.width = '1000px';
  frame.style.height = '800px';
  document.body.appendChild(frame);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('player page did not load')), 5000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  await waitFor(() => frame.contentWindow?.sansBass, 'production player modules');
  const win = frame.contentWindow;
  const doc = win.document;
  return {
    frame,
    win,
    doc,
    close() { frame.remove(); },
  };
}

export function instrumentAudio(win) {
  const ramps = [];
  const starts = [];
  const stops = [];
  const originalRamp = win.AudioParam.prototype.setTargetAtTime;
  const originalStart = win.AudioBufferSourceNode.prototype.start;
  const originalStop = win.AudioBufferSourceNode.prototype.stop;
  win.AudioParam.prototype.setTargetAtTime = function (value, startTime, timeConstant) {
    ramps.push({ value, startTime, timeConstant, param: this });
    return originalRamp.call(this, value, startTime, timeConstant);
  };
  win.AudioBufferSourceNode.prototype.start = function (...args) {
    starts.push(args);
    return originalStart.apply(this, args);
  };
  win.AudioBufferSourceNode.prototype.stop = function (...args) {
    stops.push(args);
    return originalStop.apply(this, args);
  };
  return { ramps, starts, stops };
}

export async function loadZip(player, stems, options = {}) {
  const blob = await stemsZip(stems, options);
  const bytes = await blob.arrayBuffer();
  const file = new player.win.File([bytes], options.filename || 'synthetic.zip', {
    type: 'application/zip',
  });
  const transfer = new player.win.DataTransfer();
  transfer.items.add(file);
  const input = player.doc.getElementById('file-input');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new player.win.Event('change', { bubbles: true }));
  try {
    await waitFor(() => player.doc.querySelectorAll('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview)').length === Object.keys(stems).length,
      'decoded player lanes');
  } catch (error) {
    const status = player.doc.getElementById('status')?.textContent;
    throw new Error(`${error.message}; status=${JSON.stringify(status)}`);
  }
  return input;
}
