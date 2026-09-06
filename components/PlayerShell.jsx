import { StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AUDIO_RE } from '../lib/stems.js';
import { t } from '../lib/i18n.js';
import { isHandheld } from '../lib/platform.js';
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
