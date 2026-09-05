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
  <link rel="stylesheet" href="../styles.css">
  <style>
    .demo-content, .demo-footer { max-width: 820px; margin: 0 auto; padding: 32px 20px; }
    .demo-content h1 { margin-bottom: 8px; }
    .demo-content a { color: var(--fg); text-underline-offset: 3px; }
    .demo-content ul { list-style: none; padding: 0; margin: 28px 0; }
    .demo-content li { border-bottom: 1px solid var(--line); }
    .demo-content li a { display: block; padding: 18px 0; overflow-wrap: anywhere; }
    .demo-footer { font-size: 0.8rem; color: var(--dim); }
  </style>
</head>
<body>
  <header class="bar" id="site-header"></header>
  <main class="demo-content">
    <a href="../" data-i18n="demos.back">← Back to sans_bass player</a>
    <h1 data-i18n="nav.demos">Demos</h1>
    <p data-i18n="demos.description">Explore shared notation exports and HTML demos.</p>
    <p id="demo-count" data-count="${files.length}">Demos: ${files.length}</p>
    ${files.length ? `<ul>${items}</ul>` : '<p data-i18n="demos.empty">No demos published yet.</p>'}
  </main>
  <footer class="demo-footer">sans_bass · <span id="build-sha">${escape(sha)}</span></footer>
</body>
</html>
`);
console.log(`Generated demos/index.html with ${files.length} demo(s).`);
