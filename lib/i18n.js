/* Interface i18n: one dictionary, two locales, no dependencies.
 *
 * A CLASSIC script, matching lib/stems.js and lib/unzip.js. It no longer *has* to be —
 * file:// support was dropped in v1.5.0 — but the ESM migration is a separate change
 * (see docs/superpowers/specs/2026-08-21-i18n-design.md, "Deferred").
 *
 * separate.js is an ES module and cannot share scope with app.js, so both read this
 * through window.SansI18n. That is the whole reason there is exactly one dictionary. */
(function (global) {
  const LOCALES = ['zh-TW', 'en'];
  const DEFAULT_LOCALE = 'zh-TW';      // the stated default when nothing else decides
  const STORAGE_KEY = 'sans_bass.lang';

  /* Keys are grouped by where they appear. Latin script is kept deliberately in both
   * locales for: zip, GPU, CPU, WebGPU, .m4a, Demucs, and the loop points A / B. */
  const DICT = {
    'zh-TW': {
      'app.title': 'sans_bass — 分軌播放器',
      'lang.aria': '介面語言',
      'repo.tip': '在 GitHub 上查看原始碼',

      'btn.load': '載入歌曲或分軌.zip',
      'btn.clear': '清除',
      'btn.clearLoopTip': '清除 A–B 循環區間',
      'btn.unmuteAll': '全部取消靜音',
      'btn.muteAll': '全部靜音',
      'btn.restorePrevious': '回復先前狀態',

      'drop.title': '拖放音訊檔或一個分軌.zip 到這裡',
      'drop.explain': '<strong>音訊檔</strong>：會以單一軌道播放，能進一步在瀏覽器裡分離成六軌。<br/><strong>分軌.zip</strong>：音軌已分離的 zip 檔。',
      'drop.explainHandheld': '<strong>音訊檔</strong>：會以單一軌道播放。<br/><strong>分軌.zip</strong>：音軌已分離的 zip 檔。分離功能需要電腦。',
      'drop.privacy': '所有解碼都在你的瀏覽器本機完成，不會上傳任何東西。',

      'drag.title': '放開以載入',
      'drag.sub': '一首歌，或一個分軌.zip',

      'play.aria': '播放／暫停',
      'ctl.play': '播放',
      'ctl.volume': '音量',
      'lane.tip': '點擊以靜音或取消靜音這條軌道',
      'hint.click': '點擊軌道左側的<strong>名稱區塊</strong>，即可靜音或取消靜音該軌',
      'hint.keys': '空白鍵播放 · ←→ 前後 5 秒 · 1-6 選軌 · 0 全部靜音／取消靜音 · <strong>a</strong>/<strong>b</strong> 循環 · <strong>c</strong> 清除 A–B 循環',

      'stem.vocals': '人聲',
      'stem.guitar': '吉他',
      'stem.bass': '貝斯',
      'stem.drums': '鼓組',
      'stem.piano': '鋼琴',
      'stem.other': '其他',
      'stem.mix': '完整混音',

      'mode.only': '只聽{name}',
      'mode.custom': '自訂…',

      'loop.range': 'A–B {a} → {b}（{len} 秒）',
      'loop.aSet': '已設定 A — 按 B 完成循環',
      'loop.bSet': '已設定 B — 按 A 完成循環',

      'status.decodingOne': '解碼中，共 {n} 個檔案…',
      'status.decodingMany': '解碼中，共 {n} 個檔案…',
      'status.decodingProgress': '解碼中… {done}/{total}',
      'status.decodeFailAll': '無法解碼 {names} — 這個瀏覽器可能不支援該編碼格式。請重新編碼為 .m4a 或 .wav。',
      'status.decodeSkipped': '已略過 {names} — 這個瀏覽器不支援該編碼格式。請重新編碼為 .m4a。',
      'status.noStemNames': 'zip 裡沒有任何檔名看起來像分軌，所以它們全部疊在一起播放。把檔名改成 vocals / guitar / bass / drums 就會得到標示好的軌道。',
      'status.readingZip': '讀取 zip 中…',
      'status.noAudioInZip': '那個 zip 裡沒有音訊檔。支援格式：wav、flac、m4a、mp3、opus、aiff。',
      'status.noAudioFiles': '沒有可載入的音訊檔。支援格式：wav、flac、m4a、mp3、opus、aiff。',
      'status.notAudioFile': '{name} 不是音訊檔。支援格式：wav、flac、m4a、mp3、opus、aiff。',
      'status.loopTooShort': 'A 和 B 相距不到 {min} 秒 — 請把播放頭移遠一點再設定第二個點。',
      'status.folderDrop': '不支援拖放資料夾。請先壓縮成 zip — 對資料夾按右鍵選擇「壓縮」— 再拖放該 .zip，或用「載入歌曲或分軌.zip」按鈕選它。',
      'status.tooManyFiles': '一次只能拖放一個檔案：一首要分離的歌，或一個分軌.zip。剛才是 {n} 個檔案 — 如果那些是分軌，請先壓縮成 zip。',
      'status.notSongOrZip': '那不是歌曲，也不是分軌.zip。音訊格式：wav、flac、m4a、mp3、opus、aiff。',
      'status.crash': '播放器發生錯誤。請強制重新整理頁面 — macOS 按 Cmd-Shift-R，其他系統按 Ctrl-Shift-R — 以清除快取中的舊程式。',

      'zipError.not-zip': '那個檔案不是有效的 zip，或它的目錄已損毀。',
      'zipError.zip64': '這個 zip 使用 Zip64，目前不支援。請改用 Finder 的「壓縮」或 `zip -r` 重新壓縮。',
      'zipError.encrypted': '那個 zip 有加密。',
      'zipError.method': '那個 zip 使用了播放器無法讀取的壓縮方式。請改用 Finder 的「壓縮」或 `zip -r` 重新壓縮。',
      'zipError.no-deflate': '這個瀏覽器無法解壓縮那個 zip。請改用 Finder 的「壓縮」或 `zip -r` 重新壓縮。',
      'zipError.corrupt': '那個 zip 已損毀，無法解壓縮。',
      'zipError.read': '那個 zip 不完整 — 檔案比它自己的目錄所宣告的還短。',

      'sep.go': '分離成 6 軌',
      'sep.save': '儲存分軌 (.zip)',
      'sep.cancel': '取消',
      'sep.handheld': '分離功能需要電腦。在電腦上分離後，把 .zip 載入這裡即可。',
      'sep.confirmLong': '這首歌長 {min} 分鐘。分離時每一軌都會留在記憶體中，可能會把記憶體用光。要繼續嗎？',
      'sep.loadingModel': '載入模型中…',
      'sep.downloading': '下載模型中 {loaded} / {total} MB',
      'sep.gpu': '使用 GPU 分離中…',
      'sep.cpu': '使用 CPU 分離中 — 這裡沒有 WebGPU，會花上好幾分鐘',
      'sep.progress': '第 {segment}/{total} 段 — 大約還要 {eta} 秒',
      'sep.workerFailed': 'worker 失敗：{msg} — 試試比較短的歌',
      'sep.oom': '記憶體不足？',
      'sep.cancelled': '已取消',
      'sep.cancelling': '取消中…',
      'sep.failed': '失敗：{msg}',
      'sep.encoding': '編碼 WAV 中…',
      'sep.saved': '已儲存 {mb} MB',
      'sep.saveFailed': '儲存失敗：{msg}',

      'notes.lane': '音符',
      'notes.find': '偵測音符',
      'notes.working': '偵測音符中…',
      'notes.failed': '音符偵測失敗：{message}',
      'notes.count': '{n} 個音符',
      'notes.shortest': '最短音符',
      'notes.advanced': '進階',
      'notes.clip': '裁切八度異常值',
      'notes.muteTip': '點擊以播放或靜音合成的音符',
      'notes.resizeTip': '拖曳以調整高度',
      'notes.zoom': '局部放大',
      'notes.zoomTip': '點擊以跳轉，拖曳以平移，滾輪縮放',
      'notes.zoomIn': '放大',
      'notes.zoomOut': '縮小',
      'notes.hide': '隱藏音符',
      'notes.show': '顯示音符',
    },

    'en': {
      'app.title': 'sans_bass — stem player',
      'lang.aria': 'Interface language',
      'repo.tip': 'View the source on GitHub',

      'btn.load': 'Load song or zip',
      'btn.clear': 'Clear',
      'btn.clearLoopTip': 'Clear the A–B loop',
      'btn.unmuteAll': 'Unmute all',
      'btn.muteAll': 'Mute all',
      'btn.restorePrevious': 'Restore previous',

      'drop.title': 'Drop a song, or a .zip of stems',
      'drop.explain': '<strong>One audio file</strong> — a whole song — plays as a single track, and can be split into six stems right here in the browser. <strong>A .zip</strong> of stems already separated loads them as one lane each.',
      'drop.explainHandheld': '<strong>One audio file</strong> — a whole song — plays as a single track. <strong>A .zip</strong> of stems already separated loads them as one lane each. Separating stems needs a computer.',
      'drop.privacy': 'Everything is decoded locally in your browser. Nothing is uploaded.',

      'drag.title': 'Drop to load',
      'drag.sub': 'One song, or one .zip of stems',

      'play.aria': 'Play/pause',
      'ctl.play': 'Play',
      'ctl.volume': 'Volume',
      'lane.tip': 'Click to mute or unmute this track',
      'hint.click': 'Click a lane’s <strong>name block</strong> on the left to mute or unmute that track',
      'hint.keys': 'space play · ←→ seek 5s · 1-6 stem · 0 mute/unmute all · <strong>a</strong>/<strong>b</strong> loop · <strong>c</strong> clear the A–B loop',

      'stem.vocals': 'Vocals',
      'stem.guitar': 'Guitar',
      'stem.bass': 'Bass',
      'stem.drums': 'Drums',
      'stem.piano': 'Piano',
      'stem.other': 'Other',
      'stem.mix': 'Full mix',

      'mode.only': '{name} only',
      'mode.custom': 'Custom…',

      'loop.range': 'A–B {a} → {b} ({len}s)',
      'loop.aSet': 'A set — press B to close the loop',
      'loop.bSet': 'B set — press A to close the loop',

      'status.decodingOne': 'Decoding {n} file…',
      'status.decodingMany': 'Decoding {n} files…',
      'status.decodingProgress': 'Decoding… {done}/{total}',
      'status.decodeFailAll': 'Could not decode {names} — this browser may not support that codec. Re-encode as .m4a or .wav.',
      'status.decodeSkipped': 'Skipped {names} — codec not supported by this browser. Re-encode as .m4a.',
      'status.noStemNames': 'None of the filenames in that zip looked like stems, so they are all playing layered on top of each other. Rename them vocals / guitar / bass / drums to get labelled lanes.',
      'status.readingZip': 'Reading zip…',
      'status.noAudioInZip': 'No audio files in that zip. Supported: wav, flac, m4a, mp3, opus, aiff.',
      'status.noAudioFiles': 'No audio files to load. Supported: wav, flac, m4a, mp3, opus, aiff.',
      'status.notAudioFile': '{name} is not an audio file. Supported: wav, flac, m4a, mp3, opus, aiff.',
      'status.loopTooShort': 'A and B are less than {min}s apart — move the playhead further before setting the second point.',
      'status.folderDrop': 'Dropping a folder is not supported. Zip it first — right-click the folder and choose Compress — then drop the .zip, or pick it with the Load song or zip button.',
      'status.tooManyFiles': 'Drop one thing at a time: a single song to separate, or one .zip of stems. That was {n} files — if they are stems, zip them first.',
      'status.notSongOrZip': 'That is not a song or a .zip of stems. Audio: wav, flac, m4a, mp3, opus, aiff.',
      'status.crash': 'Something went wrong in the player. Force-reload the page — Cmd-Shift-R on macOS, Ctrl-Shift-R elsewhere — to clear a stale cached script.',

      'zipError.not-zip': 'That file is not a valid zip, or its directory is damaged.',
      'zipError.zip64': 'This zip uses Zip64, which is not supported. Re-zip it with Finder’s Compress, or `zip -r`.',
      'zipError.encrypted': 'That zip is encrypted.',
      'zipError.method': 'That zip uses a compression method this player cannot read. Re-zip it with Finder’s Compress, or `zip -r`.',
      'zipError.no-deflate': 'This browser cannot decompress that zip. Re-zip it with Finder’s Compress, or `zip -r`.',
      'zipError.corrupt': 'That zip is corrupt and could not be decompressed.',
      'zipError.read': 'That zip is truncated — the file is shorter than its own directory says.',

      'sep.go': 'Separate into 6 stems',
      'sep.save': 'Save stems (.zip)',
      'sep.cancel': 'Cancel',
      'sep.handheld': 'Separating stems needs a computer. Separate there, then load the .zip here.',
      'sep.confirmLong': 'This track is {min} minutes long. Separation holds every stem in memory and may exhaust it. Continue?',
      'sep.loadingModel': 'loading model…',
      'sep.downloading': 'downloading model {loaded} / {total} MB',
      'sep.gpu': 'separating on GPU…',
      'sep.cpu': 'separating on CPU — no WebGPU here, so this will take many minutes',
      'sep.progress': 'segment {segment}/{total} — about {eta}s left',
      'sep.workerFailed': 'worker failed: {msg} — try a shorter track',
      'sep.oom': 'out of memory?',
      'sep.cancelled': 'cancelled',
      'sep.cancelling': 'cancelling…',
      'sep.failed': 'failed: {msg}',
      'sep.encoding': 'encoding WAVs…',
      'sep.saved': 'saved {mb} MB',
      'sep.saveFailed': 'save failed: {msg}',

      'notes.lane': 'Notes',
      'notes.find': 'Find notes',
      'notes.working': 'Finding notes…',
      'notes.failed': 'Note detection failed: {message}',
      'notes.count': '{n} notes',
      'notes.shortest': 'Shortest note',
      'notes.advanced': 'Advanced',
      'notes.clip': 'Clip octave outliers',
      'notes.muteTip': 'Click to play or mute the synthesised notes',
      'notes.resizeTip': 'Drag to resize',
      'notes.zoom': 'Zoom',
      'notes.zoomTip': 'Click to seek, drag to pan, scroll to zoom',
      'notes.zoomIn': 'Zoom in',
      'notes.zoomOut': 'Zoom out',
      'notes.hide': 'Hide notes',
      'notes.show': 'Show notes',
    },
  };

  let locale = DEFAULT_LOCALE;
  let booted = false;      // true once init() has claimed this document — see setLocale

  /** True when the active locale (or English) actually defines this key. */
  function has(key) {
    return DICT[locale][key] !== undefined || DICT.en[key] !== undefined;
  }

  /**
   * Look up `key`, interpolating `{name}` placeholders from `params`.
   * Falls back to English, then to the key itself — never to `undefined`, which would
   * put the string "undefined" on screen.
   */
  function t(key, params) {
    let s = DICT[locale][key];
    if (s === undefined) s = DICT.en[key];
    if (s === undefined) s = String(key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? params[name] : whole));
    }
    return s;
  }

  /* zh-TW covers Traditional Chinese; Simplified tags go to English, because the whole
   * point of the zh-TW copy is Taiwan terminology, which does not serve zh-CN readers. */
  function isTraditionalChinese(tag) {
    const s = String(tag).toLowerCase().replace(/_/g, '-');
    if (s === 'zh') return true;                  // bare zh: no region, take the default
    if (!s.startsWith('zh-')) return false;
    if (/\bhans\b/.test(s)) return false;         // zh-Hans, zh-Hans-CN
    if (/-(cn|sg)\b/.test(s)) return false;       // Simplified regions
    if (/\bhant\b/.test(s)) return true;          // zh-Hant, zh-Hant-TW
    return /-(tw|hk|mo)\b/.test(s);
  }

  /**
   * Which locale does this system want? PURE — it never touches storage, so the whole
   * mapping table can be unit-tested without stubbing navigator or localStorage.
   * @param {string[]} [langs] defaults to the browser's language list
   */
  function detectLocale(langs) {
    const list = langs ||
      (global.navigator && navigator.languages) ||
      (global.navigator && navigator.language ? [navigator.language] : []) ||
      [];
    if (!list.length) return DEFAULT_LOCALE;
    for (const tag of list) if (isTraditionalChinese(tag)) return 'zh-TW';
    return 'en';
  }

  /* Every storage access is guarded. Safari private mode and browsers with site data
   * blocked throw on read as well as write, and a throw here would land in app.js's flat
   * run of top-level statements and silently kill every listener below it — the v1.4.0
   * failure mode, and the worst kind of bug to debug from the user's side. */
  function storedLocale() {
    try {
      const v = global.localStorage.getItem(STORAGE_KEY);
      return LOCALES.includes(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getLocale() { return locale; }

  /**
   * Switch language. Does NOT reload — a reload would throw away decoded AudioBuffers and
   * stop playback mid-practice, which is the one thing this player exists to protect.
   * @param {string} loc
   * @param {{persist?: boolean}} [opts] persist defaults to true; boot passes false
   */
  function setLocale(loc, opts) {
    locale = LOCALES.includes(loc) ? loc : DEFAULT_LOCALE;
    const persist = !opts || opts.persist !== false;
    if (persist) {
      try { global.localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* see above */ }
    }
    if (global.document) {
      document.documentElement.lang = locale;
      // Only rewrite the tab title for a document i18n actually booted. tests/test.html
      // loads this file to poke at the dictionary and must keep its own title.
      if (booted) document.title = t('app.title');
      apply(document);
    }
    global.dispatchEvent(new CustomEvent('sansbass:langchange', { detail: { locale } }));
  }

  /**
   * Translate every annotated node under `root`.
   *
   *   data-i18n="key"                         → textContent (the safe default)
   *   data-i18n-html="key"                    → innerHTML, for the handful of strings that
   *                                             carry <strong>/<code>. ONLY EVER our own
   *                                             dictionary values — never user data.
   *   data-i18n-attr="title:key,aria-label:k" → setAttribute, comma-separated pairs
   */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((n) => {
      n.textContent = t(n.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((n) => {
      n.innerHTML = t(n.dataset.i18nHtml);
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((n) => {
      for (const pair of n.dataset.i18nAttr.split(',')) {
        const colon = pair.indexOf(':');
        if (colon < 0) continue;
        const attr = pair.slice(0, colon).trim();
        const key = pair.slice(colon + 1).trim();
        if (attr && key) n.setAttribute(attr, t(key));
      }
    });
  }

  /**
   * Boot. Called from a one-line script in index.html's <head>, so `lang` and the tab
   * title are right before anything paints; the DOM walk waits for the body to exist.
   *
   * Not run on import: tests/test.html loads this file to poke at the dictionary and must
   * not have its own <title> rewritten or its markup walked.
   */
  function init() {
    booted = true;
    locale = storedLocale() || detectLocale();
    document.documentElement.lang = locale;
    document.title = t('app.title');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(document), { once: true });
    } else {
      apply(document);
    }
  }

  global.SansI18n = {
    LOCALES, DICT, t, has, apply, init,
    detectLocale, storedLocale, getLocale, setLocale,
  };
})(window);
