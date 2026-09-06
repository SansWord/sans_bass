import { StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AUDIO_RE } from '../lib/stems.js';
import { t } from '../lib/i18n.js';
import { isHandheld } from '../lib/platform.js';
import { formatClockTime } from '../lib/time.js';
import { SiteHeaderContent } from './SiteHeader.jsx';
import { useLocale } from './useLocale.js';

const INPUT_ACCEPT = 'audio/*,.wav,.flac,.m4a,.mp3,.opus,.ogg,.aiff,.zip,application/zip';
const isZip = (file) => /\.zip$/i.test(file.name);
// Match the legacy startup contract: device capability is classified once per page load.
const HANDHELD = isHandheld();

function ignoreReportedError(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

function FileLoadControl({ application }) {
  const onChange = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    input.blur();
    if (file) ignoreReportedError(application.commands.load(file));
  };
  return <div className="loadzone">
    <label className="btn">
      <span>{t('btn.load')}</span>
      <input type="file" id="file-input" accept={INPUT_ACCEPT} hidden onChange={onChange} />
    </label>
  </div>;
}

function DropAffordance({ song }) {
  const explainKey = HANDHELD ? 'drop.explainHandheld' : 'drop.explain';
  return <section id="dropzone" className="dropzone" hidden={!!song}>
    <p className="big" dangerouslySetInnerHTML={{ __html: t('drop.title') }} />
    <p id="drop-explain" className="dim"
      dangerouslySetInnerHTML={{ __html: t(explainKey) }} />
    <p className="dim">{t('drop.privacy')}</p>
  </section>;
}

function Status({ status }) {
  return <section id="status" className={`status${status?.error ? ' err' : ''}`}
    hidden={!status}>{status ? t(status.key, status.params) : ''}</section>;
}

function PlaybackButton({ application, transport }) {
  const onClick = (event) => {
    // Keep command entry inside the trusted gesture turn: play() synchronously reaches
    // ensureAudio() before its optional stretched-worklet await. Blur afterwards so the
    // document shortcuts work on the next keypress without a button's native Space click
    // competing with the document keyboard owner.
    ignoreReportedError(application.commands.togglePlayback());
    event.currentTarget.blur();
  };
  return <button id="play" className={`play${transport.playing ? ' playing' : ''}`}
    aria-label={t('play.aria')} onClick={onClick} data-react-playback-controls>
    <span className="ico-play" />
  </button>;
}

function PlaybackSpeed({ application, transport }) {
  const percent = Math.round(transport.playbackRate * 100);
  const onInput = (event) => {
    ignoreReportedError(application.commands.setPlaybackRate(Number(event.currentTarget.value) / 100));
  };
  return <label className="ctl" data-react-playback-controls>
    <span>{t('ctl.speed')}</span>
    <input type="range" id="speed" min="10" max="150" step="5"
      value={percent} onChange={onInput} />
    <span id="speed-val" className="dim">{percent}%</span>
  </label>;
}

function PrimarySeekControls({ application, hosts }) {
  const transport = useSyncExternalStore(
    application.subscribeTransport,
    application.getTransportSnapshot,
    application.getTransportSnapshot,
  );
  const canvasRef = useRef(null);
  const seeking = useRef(false);
  const duration = Math.max(0, transport.duration || 0);
  const position = Math.max(0, Math.min(duration, transport.position || 0));
  const percent = Math.round(transport.playbackRate * 100);
  const currentText = formatClockTime(position);
  const durationText = formatClockTime(duration);
  const speedText = `${percent}%`;
  const bpmText = transport.tempoBpm
    ? `${(transport.tempoBpm * transport.playbackRate).toFixed(1)}/${transport.tempoBpm.toFixed(1)} BPM`
    : '';

  useLayoutEffect(() => application.attachPrimarySeekCanvas(canvasRef.current), [application]);

  const timeAtPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width
      ? (event.clientX - rect.left) / rect.width
      : 0;
    return Math.max(0, Math.min(duration, fraction * duration));
  };
  const onPointerDown = (event) => {
    if (!duration) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    seeking.current = true;
    ignoreReportedError(application.commands.seek(timeAtPointer(event)));
  };
  const onPointerMove = (event) => {
    if (!seeking.current) return;
    ignoreReportedError(application.commands.previewSeek(timeAtPointer(event)));
  };
  const onPointerUp = (event) => {
    if (!seeking.current) return;
    seeking.current = false;
    ignoreReportedError(application.commands.seek(timeAtPointer(event)));
  };
  const onPointerCancel = () => { seeking.current = false; };

  return <>
    {createPortal(<canvas id="main-wave" className="wave main" ref={canvasRef}
      role="slider" tabIndex={duration ? 0 : -1} aria-disabled={!duration}
      aria-label={t('seek.aria')} aria-valuemin={0} aria-valuemax={duration}
      aria-valuenow={Math.round(position * 1000) / 1000}
      aria-valuetext={t('seek.value', {
        current: currentText, duration: durationText, speed: speedText,
      })}
      data-react-seek-controls onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel} />, hosts.primarySeek)}
    {createPortal(<div className="times" data-react-seek-time>
      <span id="t-cur">{currentText}</span>
      <span className="dim" id="t-dur">{durationText}</span>
      <span className="dim" id="t-speed">{speedText}</span>
      <span className="dim" id="t-bpm" hidden={!bpmText}>{bpmText}</span>
    </div>, hosts.primaryTime)}
  </>;
}

function classifyDrop(dataTransfer) {
  const files = [...(dataTransfer?.files || [])];
  if (files.length === 1 && (isZip(files[0]) || AUDIO_RE.test(files[0].name))) {
    return { file: files[0] };
  }
  const folder = [...(dataTransfer?.items || [])]
    .some((item) => item.webkitGetAsEntry?.()?.isDirectory) ||
    files.some((file) => !file.type && !AUDIO_RE.test(file.name) && !isZip(file));
  if (folder) return { rejection: 'folder' };
  if (files.length > 1) return { rejection: 'multiple', count: files.length };
  return { rejection: 'unsupported' };
}

function DragOverlay({ application }) {
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);
  useLayoutEffect(() => {
    const clear = () => {
      depth.current = 0;
      setVisible(false);
    };
    const dragenter = (event) => {
      event.preventDefault();
      depth.current++;
      setVisible(true);
    };
    const dragleave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setVisible(false);
    };
    const dragover = (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const drop = (event) => {
      event.preventDefault();
      clear();
      const result = classifyDrop(event.dataTransfer);
      if (result.file) ignoreReportedError(application.commands.load(result.file));
      else ignoreReportedError(application.commands.rejectLoad(result.rejection, {
        count: result.count,
      }));
    };
    document.addEventListener('dragenter', dragenter);
    document.addEventListener('dragleave', dragleave);
    document.addEventListener('dragend', clear);
    document.addEventListener('dragover', dragover);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragenter', dragenter);
      document.removeEventListener('dragleave', dragleave);
      document.removeEventListener('dragend', clear);
      document.removeEventListener('dragover', dragover);
      document.removeEventListener('drop', drop);
    };
  }, [application]);

  return <div id="drag-overlay" className="drag-overlay" hidden={!visible} aria-hidden="true">
    <div className="drag-card">
      <p className="big">{t('drag.title')}</p>
      <p className="dim" dangerouslySetInnerHTML={{ __html: t('drag.sub') }} />
    </div>
  </div>;
}

function PlayerShell({ application, hosts }) {
  const locale = useLocale();
  const snapshot = useSyncExternalStore(
    application.subscribe,
    application.getSnapshot,
    application.getSnapshot,
  );
  return <>
    {createPortal(<SiteHeaderContent page="player" locale={locale}
      loadControl={<FileLoadControl application={application} />} />, hosts.header)}
    {createPortal(<DropAffordance song={snapshot.song} />, hosts.loading)}
    {createPortal(<Status status={snapshot.status} />, hosts.status)}
    {createPortal(<DragOverlay application={application} />, hosts.overlay)}
    {createPortal(<PlaybackButton application={application}
      transport={snapshot.transport} />, hosts.playbackButton)}
    {createPortal(<PlaybackSpeed application={application}
      transport={snapshot.transport} />, hosts.playbackSpeed)}
    <PrimarySeekControls application={application} hosts={hosts} />
  </>;
}

/** Mount/unmount changes only React listeners and subscriptions, never application lifetime. */
export function mountPlayerShell(application, doc = document) {
  const hosts = {
    root: doc.getElementById('player-react-root'),
    header: doc.getElementById('site-header'),
    loading: doc.getElementById('loading-ui-root'),
    status: doc.getElementById('status-ui-root'),
    overlay: doc.getElementById('drag-overlay-root'),
    playbackButton: doc.getElementById('playback-button-ui-root'),
    playbackSpeed: doc.getElementById('playback-speed-ui-root'),
    primarySeek: doc.getElementById('primary-seek-ui-root'),
    primaryTime: doc.getElementById('primary-time-ui-root'),
  };
  if (Object.values(hosts).some((host) => !host)) {
    console.warn('sans_bass: player React shell host missing — skipped');
    return { mount() {}, unmount() {} };
  }
  let root = null;
  const mount = () => {
    if (root) return;
    root = createRoot(hosts.root);
    flushSync(() => root.render(<StrictMode>
      <PlayerShell application={application} hosts={hosts} />
    </StrictMode>));
  };
  const unmount = () => {
    if (!root) return;
    flushSync(() => root.unmount());
    root = null;
  };
  mount();
  return { mount, unmount };
}
