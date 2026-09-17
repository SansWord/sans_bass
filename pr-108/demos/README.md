# Published demos

Put self-contained `.html` (or `.htm`) files directly in this folder and merge the
change into `main`. The existing Pages workflow publishes them and rebuilds the
list at <https://sansword.github.io/sans_bass/demos/> automatically.

The list uses filenames, sorted alphabetically. Keep filenames descriptive. Do not
create `index.html`: that name belongs to the generated list. Subfolders are not
listed. Files here are public; keep local test fixtures in `examples/`.

Run `npm run dev` to generate and view the list at <http://localhost:8777/demos/>.
Restart the dev server after adding, renaming, or deleting a demo. `npm run build`
regenerates the list and copies the demos unchanged into `dist/demos/`.
