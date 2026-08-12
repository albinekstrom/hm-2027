# hm-2027

A training tracker for one athlete, one race: half marathon, Saturday 22 May 2027, target 1:20:00.

Forty weeks, fixed. The plan lives in `data/plan.json` and is read-only — the site displays it and
records what actually happened. No build step, no dependencies, no third-party scripts.

- **This repo (`hm-2027`, public)** — the site, served by GitHub Pages.
- **`hm-2027-data` (private)** — one file, `log.json`. The training log.

The split exists because GitHub Pages on a free personal account only serves public repositories,
and training data does not belong in a public repo. The site reads and writes the private repo from
the browser through the GitHub Contents API.

## Using it without a token

It works completely. Everything is written to `localStorage` first and the UI never waits on the
network. With no token configured you get pure local mode plus JSON export and import, so the log
can be backed up or moved between devices by hand.

The token only adds automatic cross-device sync.

## Creating the token

Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.

- **Repository access:** Only select repositories → **`hm-2027-data`** and nothing else.
- **Repository permissions:** **Contents: Read and write.** Nothing else. Leave every other
  permission on "No access".
- **Expiration:** 90 days. Set a calendar reminder; you will need to make a new one three times
  across this build.

Then open the site, tap the sync chip in the top right — it reads **Local only** until this is
done — and fill in your GitHub username, the data repo name (`hm-2027-data`) and the token.
"Test connection" checks it without writing anything. The token is stored in `localStorage` on that
device only, shown masked afterwards, and there is a "Forget token on this device" button. Leave
the token field blank when re-saving and the stored one is kept.

The chip has five states: **Local only** (no token here), **Syncing**, **Synced 3 min ago**,
**Offline**, and **Not synced** — which means exactly what it says and nothing more: your data is
on this device, and the next successful sync will carry it up.

Two actions replace the repo copy instead of merging into it, because merging would silently undo
them: **Clear all my logs** and **Import**. Everything else merges per session and per field, so
two devices editing the same week both keep their edits.

If this token leaks, the worst case is somebody reads or edits your training log.

That is the entire reason it is scoped this tightly. Do not add permissions to it, do not reuse a
token you already have, and do not give it access to your other repositories.

## Layout

```
index.html              shell, tabs, CSP
manifest.webmanifest    PWA manifest
sw.js                   service worker — network-first HTML, cached shell
css/app.css
js/app.js               entry, tab routing, boot
js/plan.js              plan.json loading, week lookup, date helpers
js/store.js             localStorage, state shape, migrations
js/sync.js              GitHub Contents API, merge, conflict handling
js/paces.js             Riegel equivalents, training pace zones
js/views/               week.js, season.js, paces.js, playbook.js
data/plan.json          DO NOT EDIT — the 40-week plan
data/playbook.md        prose guidance, rendered read-only
icons/                  192, 512, maskable
```
