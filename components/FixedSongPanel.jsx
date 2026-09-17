import { useEffect, useSyncExternalStore } from 'react';
import { fixedSong } from '../lib/fixed-song.js';
import { t } from '../lib/i18n.js';

function useFixedSong() {
  return useSyncExternalStore(fixedSong.subscribe, fixedSong.getSnapshot, fixedSong.getSnapshot);
}

const MB = 1024 * 1024;
const megabytes = (bytes) => (bytes / MB).toFixed(1);

/**
 * Stands in for the drop affordance on a fixed-song page: there is nothing to drop, so the
 * same spot reports the one download the page makes on the viewer's behalf.
 *
 * Starting the download from this component's effect, rather than from the page entry, is
 * what keeps the ordering honest — the panel only mounts once app.js has initialized the
 * application, so `commands.load` is always reachable by the time the bytes land.
 */
export function FixedSongPanel({ song }) {
  const state = useFixedSong();
  useEffect(() => { fixedSong.commands.start(); }, []);

  if (!state.active || song) return null;

  if (state.phase === 'failed') {
    return <section id="dropzone" className="dropzone">
      <p className="big">{t('fixed.failed')}</p>
      <p className="dim">{state.failure}</p>
      <p><button type="button" className="btn"
        onClick={() => fixedSong.commands.retry()}>{t('fixed.retry')}</button></p>
    </section>;
  }

  const percent = state.total ? Math.floor((state.received / state.total) * 100) : 0;
  const progress = state.total
    ? t('fixed.progressPercent', { percent, mb: megabytes(state.total) })
    : t('fixed.progressBytes', { mb: megabytes(state.received) });

  return <section id="dropzone" className="dropzone">
    <p className="big">{t('fixed.loading')}</p>
    <p id="fixed-song-progress" className="dim" data-percent={state.total ? percent : ''}>
      {state.phase === 'downloading' ? progress : t('fixed.preparing')}
    </p>
    <p className="dim">{t('fixed.privacy')}</p>
  </section>;
}

/**
 * Takes the header slot the Load button occupies on the ordinary player. A fixed-song page
 * cannot accept a file, but the zip it plays is a file the viewer can keep — and then open
 * in the ordinary player, offline, like any other stems zip.
 */
export function FixedSongDownload() {
  const state = useFixedSong();
  if (!state.active) return null;
  return <div className="loadzone">
    <a className="btn" id="fixed-song-download" href={state.url} download>
      <span>{t('fixed.download')}</span>
    </a>
  </div>;
}
