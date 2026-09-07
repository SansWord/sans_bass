import { StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AUDIO_RE } from '../lib/stems.js';
import { t } from '../lib/i18n.js';
import { isHandheld } from '../lib/platform.js';
import { formatClockTime, formatClockTimeCentiseconds } from '../lib/time.js';
import { DetectionControls, NotesChannelPanel } from './DetectionPanel.jsx';
import { EditListPanel, ListExportPanel } from './EditorPanel.jsx';
import { InterpretationPanel } from './InterpretationPanel.jsx';
import { SeparationPanel } from './SeparationPanel.jsx';
import { SiteHeaderContent } from './SiteHeader.jsx';
import { TempoPanel } from './TempoPanel.jsx';
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

function MasterVolume({ application, volume }) {
  const percent = Math.round(volume * 100);
  const onInput = (event) => {
    ignoreReportedError(application.commands.setMasterVolume(Number(event.currentTarget.value)));
  };
  return <label className="ctl" data-react-volume-controls>
    <span>{t('ctl.volume')}</span>
    <input type="range" id="master-vol" min="0" max="1.5" step="0.01"
      value={volume} aria-label={t('ctl.volume')} aria-valuetext={`${percent}%`}
      onChange={onInput} />
  </label>;
}

function LoopControls({ application, transport }) {
  const { loopA, loopB } = transport;
  const visible = loopA !== null || loopB !== null;
  const active = loopA !== null && loopB !== null;
  let text = '';
  if (active) {
    text = t('loop.range', {
      a: formatClockTime(loopA),
      b: formatClockTime(loopB),
      len: (loopB - loopA).toFixed(1),
    });
  } else if (visible) {
    text = t(loopA !== null ? 'loop.aSet' : 'loop.bSet');
  }
  const onClear = (event) => {
    ignoreReportedError(application.commands.clearLoop());
    event.currentTarget.blur();
  };
  return <span id="loop-badge" className={`loop-badge${active ? ' armed' : ''}`}
    hidden={!visible} data-react-loop-controls>
    <span id="loop-text">{text}</span>
    <button id="loop-clear" className="mini" type="button"
      title={t('btn.clearLoopTip')} onClick={onClear}>{t('btn.clear')}</button>
  </span>;
}

function ModeRoutingControls({ application, routing, song }) {
  const options = (song?.tracks || [])
    .filter((track) => track.stem !== 'mix')
    .map((track) => ({
      value: track.id,
      label: t('mode.only', {
        name: track.stem ? t(`stem.${track.stem}`) : track.label,
      }),
    }));
  const onModeChange = (event) => {
    ignoreReportedError(application.commands.setMode(event.currentTarget.value));
    event.currentTarget.blur();
  };
  const onAllToggle = (event) => {
    ignoreReportedError(application.commands.toggleAllTracks());
    event.currentTarget.blur();
  };
  return <>
    <label className="ctl" data-react-mode-routing-controls>
      <span>{t('ctl.play')}</span>
      <select id="mode" value={routing.mode} aria-label={t('ctl.play')}
        onChange={onModeChange}>
        <option value="mix">{t('stem.mix')}</option>
        {options.map((option) => <option key={option.value} value={option.value}>
          {option.label}
        </option>)}
        <option value="custom">{t('mode.custom')}</option>
      </select>
    </label>
    <button id="all-toggle" className="btn ghost" type="button"
      onClick={onAllToggle}>{t(`btn.${routing.allToggleLabel}`)}</button>
  </>;
}

const laneLabel = (track) => (track.stem ? t(`stem.${track.stem}`) : track.label);

function Lane({ application, track, index }) {
  const canvasRef = useRef(null);
  const extraRef = useRef(null);
  const isDrums = track.stem === 'drums';
  useLayoutEffect(() => application.attachLaneCanvas(track.id, canvasRef.current),
    [application, track.id]);
  // Only the drums lane ever gets a host here (see attachLaneExtra's own doc comment); the
  // effect still runs unconditionally so its cleanup fires on unmount/id change like any
  // other attach hook.
  useLayoutEffect(() => application.attachLaneExtra(track.id, isDrums ? extraRef.current : null),
    [application, track.id, isDrums]);

  const onMuteClick = (event) => {
    ignoreReportedError(application.commands.toggleTrack(track.id));
    event.currentTarget.blur();
  };
  const onVolumeInput = (event) => {
    ignoreReportedError(application.commands.setTrackVolume(
      track.id, Number(event.currentTarget.value),
    ));
  };

  return <div className={`lane${track.muted ? ' muted' : ''}`} data-react-lane
    style={{ order: index * 2 }}>
    <button type="button" className="lane-name" style={{ color: track.color }}
      title={t('lane.tip')} onClick={onMuteClick}>
      <span className="dot" />
      <span className="txt">{laneLabel(track)}</span>
      {index < 10 && <span className="kbd">{(index + 1) % 10}</span>}
    </button>
    <canvas className="wave" ref={canvasRef} />
    <div className="lane-vol">
      <input type="range" min="0" max="1.5" step="0.01" value={track.volume}
        aria-label={laneLabel(track)} onChange={onVolumeInput} />
    </div>
    {isDrums && <div className="tempo-range-hint" ref={extraRef} />}
  </div>;
}

function StemLanes({ application, tracks, hosts }) {
  return createPortal(<>
    {tracks.map((track, index) => <Lane key={track.id} application={application}
      track={track} index={index} />)}
  </>, hosts.standardLanes);
}

/** The shared full-song Overview lane: React owns its label, master-volume-mirroring slider,
 *  and canvas host (Phase 4b), the same three ownership categories Phase 4a transferred for
 *  standard lanes. `app.js` keeps overviewStems() (which stems it combines), peak combination,
 *  and painting — see attachOverviewCanvas's own doc comment for why this component is never
 *  given a `key`: staying mounted (not remounting) across a song replacement that keeps a
 *  vocals/bass stem is exactly what keeps its canvas host stable for app.js to keep painting. */
function OverviewLane({ application, masterVolume, hosts }) {
  const transport = useSyncExternalStore(
    application.subscribeTransport,
    application.getTransportSnapshot,
    application.getTransportSnapshot,
  );
  const canvasRef = useRef(null);
  const rangeHintRef = useRef(null);
  useLayoutEffect(() => application.attachOverviewCanvas(canvasRef.current), [application]);
  useLayoutEffect(() => application.attachOverviewExtra(rangeHintRef.current), [application]);

  const onVolumeInput = (event) => {
    ignoreReportedError(application.commands.setMasterVolume(Number(event.currentTarget.value)));
  };

  const duration = Math.max(0, transport.duration || 0);
  const position = Math.max(0, Math.min(duration, transport.position || 0));
  const percent = Math.round(transport.playbackRate * 100);
  const bpmText = transport.tempoBpm
    ? `${(transport.tempoBpm * transport.playbackRate).toFixed(1)}/${transport.tempoBpm.toFixed(1)} BPM`
    : '';
  const timeCode = `${formatClockTimeCentiseconds(position)}/${formatClockTime(duration)} · ${percent}%`
    + (bpmText ? ` · ${bpmText}` : '');

  return createPortal(<div className="lane overview" style={{ order: -2 }}>
    <div className="lane-name">
      <span className="txt">{t('notes.overview')}</span>
      <span className="time-code">{timeCode}</span>
    </div>
    <canvas className="wave" title={t('notes.overviewTip')} ref={canvasRef} />
    <div className="note-range-hint" ref={rangeHintRef} hidden />
    <div className="lane-vol">
      <input type="range" min="0" max="1.5" step="0.01" value={masterVolume}
        title={t('ctl.volume')} onChange={onVolumeInput} />
    </div>
  </div>, hosts.overviewLane);
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
    {createPortal(<MasterVolume application={application}
      volume={snapshot.masterVolume} />, hosts.masterVolume)}
    {createPortal(<LoopControls application={application}
      transport={snapshot.transport} />, hosts.loopControls)}
    {createPortal(<ModeRoutingControls application={application}
      routing={snapshot.routing} song={snapshot.song} />, hosts.modeRouting)}
    <PrimarySeekControls application={application} hosts={hosts} />
    {createPortal(<SeparationPanel />, hosts.separation)}
    {createPortal(<DetectionControls />, hosts.detection)}
    {createPortal(<NotesChannelPanel stem="vocals" />, hosts.notesMetaVocals)}
    {createPortal(<NotesChannelPanel stem="bass" />, hosts.notesMetaBass)}
    {createPortal(<InterpretationPanel stem="vocals" />, hosts.notesTuneVocals)}
    {createPortal(<InterpretationPanel stem="bass" />, hosts.notesTuneBass)}
    {createPortal(<EditListPanel stem="vocals" />, hosts.notesEditsVocals)}
    {createPortal(<EditListPanel stem="bass" />, hosts.notesEditsBass)}
    {createPortal(<ListExportPanel stem="vocals" />, hosts.notesListIoVocals)}
    {createPortal(<ListExportPanel stem="bass" />, hosts.notesListIoBass)}
    {createPortal(<TempoPanel />, hosts.tempo)}
    {snapshot.song && <StemLanes application={application}
      tracks={snapshot.song.tracks} hosts={hosts} />}
    {snapshot.song && snapshot.song.tracks.some((track) => track.stem === 'vocals' || track.stem === 'bass')
      && <OverviewLane application={application} masterVolume={snapshot.masterVolume} hosts={hosts} />}
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
    masterVolume: doc.getElementById('master-volume-ui-root'),
    loopControls: doc.getElementById('loop-controls-ui-root'),
    modeRouting: doc.getElementById('mode-routing-ui-root'),
    primarySeek: doc.getElementById('primary-seek-ui-root'),
    primaryTime: doc.getElementById('primary-time-ui-root'),
    standardLanes: doc.getElementById('standard-lanes-root'),
    overviewLane: doc.getElementById('overview-lane-root'),
    separation: doc.getElementById('separation-ui-root'),
    detection: doc.getElementById('detection-ui-root'),
    notesMetaVocals: doc.getElementById('notes-meta-vocals-root'),
    notesMetaBass: doc.getElementById('notes-meta-bass-root'),
    notesTuneVocals: doc.getElementById('notes-tune-vocals-root'),
    notesTuneBass: doc.getElementById('notes-tune-bass-root'),
    notesEditsVocals: doc.getElementById('notes-edits-vocals-root'),
    notesEditsBass: doc.getElementById('notes-edits-bass-root'),
    notesListIoVocals: doc.getElementById('notes-list-io-vocals-root'),
    notesListIoBass: doc.getElementById('notes-list-io-bass-root'),
    tempo: doc.getElementById('tempo-ui-root'),
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
