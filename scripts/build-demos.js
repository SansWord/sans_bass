import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Vite copies public/ verbatim, preserving self-contained exports and their scripts.
const directory = new URL('../public/demos/', import.meta.url);
const files = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name) && entry.name.toLowerCase() !== 'index.html')
  .map((entry) => entry.name)
  .sort();
const escape = (text) => text.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
const items = files.map((name) => `<li><a href="./${escape(encodeURIComponent(name))}">${escape(name)}</a></li>`).join('\n');

// The list is a Vite entry so its shared i18n module gets bundled and hashed.
const output = new URL('../demos/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demos — sans_bass</title>
  <script type="module" src="../demos.js"></script>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 780px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
    h1 { margin-bottom: 8px; }
    nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
    .lang-toggle { display: inline-flex; gap: 4px; }
    button { font: inherit; padding: 6px 11px; border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
    button[aria-pressed="true"] { background: light-dark(#2455a4, #9dc1ff); color: light-dark(white, #111); }
    a { color: light-dark(#2455a4, #9dc1ff); text-underline-offset: 3px; }
    a:focus-visible { outline: 3px solid currentColor; outline-offset: 5px; }
    ul { list-style: none; padding: 0; margin: 28px 0; }
    li { border-bottom: 1px solid light-dark(#ddd, #444); }
    li a { display: block; padding: 18px 0; overflow-wrap: anywhere; }
    footer { margin-top: 40px; font-size: 0.8rem; opacity: 0.7; }
  </style>
</head>
<body>
  <nav>
    <a href="../" data-i18n="demos.back">← Back to sans_bass player</a>
    <div class="lang-toggle" role="group" data-i18n-attr="aria-label:lang.aria">
      <button type="button" data-lang="zh-TW">中文</button>
      <button type="button" data-lang="en">EN</button>
    </div>
  </nav>
  <main>
    <h1 data-i18n="nav.demos">Demos</h1>
    <p data-i18n="demos.description">Explore shared notation exports and HTML demos.</p>
    <p id="demo-count" data-count="${files.length}">Demos: ${files.length}</p>
    ${files.length ? `<ul>${items}</ul>` : '<p data-i18n="demos.empty">No demos published yet.</p>'}
  </main>
  <footer>sans_bass · <span id="build-sha">${escape(sha)}</span></footer>
</body>
</html>
`);
console.log(`Generated demos/index.html with ${files.length} demo(s).`);
