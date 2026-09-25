# Lean Six Sigma simulations

A hub of small, interactive simulations that make core Lean Six Sigma concepts visible, styled with the Amcor visual identity.

| Simulation | Concept |
|---|---|
| **Galton Board** | Variation and the normal distribution |
| **Little's Law: 3-process line** | WIP = Throughput × Lead time, bottlenecks, variability, push vs. pull (CONWIP) |
| **Push vs. Pull: planning game** | Forecast-driven (MRP) vs. kanban release, card sizing; Explore mode and a 6-round classroom game with facilitator seed |

**Live site:** https://drotondi.github.io/GreenBelt/

- Pure static site: vanilla HTML, CSS and JavaScript. No frameworks, no build step, no npm.
- Runs by double-clicking `index.html`: no server, no installation.
- No external CDNs, remote fonts or analytics. Works offline once loaded.
- English, Spanish and Portuguese (`?lang=en|es|pt`, persisted across pages).

## Run locally

No server or installation needed: download or copy the folder and **double-click `index.html`**. Everything (simulations, language switch, navigation) works from disk (`file://`), including inside a corporate network where the public site may be blocked.

- From GitHub: **Code → Download ZIP**, unzip, open `index.html`.
- To share with a team: zip the folder and distribute it (Teams, SharePoint, email). Recipients unzip and open `index.html`.

Optional, if you prefer a local web server (same behavior):

```sh
python3 -m http.server
```

Run it from the repository root, then open http://localhost:8000/.

### Why classic scripts

Browsers block ES modules on `file://`, so all JavaScript uses classic `<script defer>` tags and a single global namespace, `window.LSS` (`LSS.config`, `LSS.i18n`, `LSS.icons`, `LSS.motion`, `LSS.header`, `LSS.registry`, `LSS.sim`). Script order in each page matters. Links always point to an explicit `index.html`, because folder links do not open `index.html` from disk.

## Brand assets flag

`shared/config.js`:

```js
LSS.config = { USE_BRAND_ASSETS: false, … }
```

- `false` (default, safe for a public repo): Arial/Helvetica font stack, no logo.
- `true`: loads `assets/fonts/AmcorPro-Book.ttf` (with `font-display: swap` and Arial fallback) and shows `assets/logo-amcor-mark.png` in the header. Note: some browsers (e.g. Chrome, Edge) block font files opened from `file://`; the logo still shows and text falls back to Arial.

`assets/fonts/` and `assets/logo-*` are git-ignored. **Never commit Amcor font or logo files.** Add them locally only.

## Structure

```
index.html                 Home: renders cards from simulations/registry.js
shared/                    Design tokens, base styles, i18n, header, icons, config, motion
shared/sim/random.js       Seeded RNG and distributions shared by all simulation engines
simulations/registry.js    List of simulations shown on Home
simulations/galton-board/  Galton Board simulation
simulations/littles-law/   Little's Law simulation (engine.js = pure discrete-event model)
simulations/push-pull/     Push vs. Pull simulation (engine.js model, game.js rounds)
simulations/_template/     Copyable skeleton (status "draft", hidden from Home)
```

All colors, radii, shadows and motion values live in `shared/tokens.css`. Status colors have reserved meanings: orange = bottleneck, green = verified, magenta = unstable.

## Tests

Simulation engines have dependency-free unit tests:

```sh
node simulations/littles-law/engine.test.js   # hand-calculated cases, Little within 5%, M/M/1, CONWIP cap
node simulations/push-pull/engine.test.js     # card cap, identical demand stream, 100% fill with CV 0, bias, mix shift
```

## Push vs. Pull in class

Open the simulation, switch to **Game**, open **Facilitator** and share the seed: everyone who enters the same seed plays the same hidden demand events. Tick **Hide KPIs until the end** so candidates decide without live results. Costs are illustrative (holding 1, backorder 5), not Amcor figures.

## How to add a new simulation

1. Copy `simulations/_template/` to `simulations/<your-id>/`.
2. Implement the simulation in `sim.js` / `sim.css`. Put every visible string in the folder's `i18n.js` (EN / ES / PT) under your own key prefix; no hardcoded UI text. Keep classic scripts (no `import` / `export`): shared helpers are available as `LSS.i18n`, `LSS.header`, `LSS.icons`.
3. Replace `thumbnail.svg` with a 320×180 preview.
4. Add one entry to `simulations/registry.js`:

   ```js
   {
     id: 'your-id',
     path: 'simulations/your-id/index.html',   // explicit index.html (works from disk)
     thumbnail: 'simulations/your-id/thumbnail.svg',
     status: 'draft',            // "live" shows it on Home
     tags: ['variation'],        // labels from shared i18n "tags.<id>", else a readable id
     title: { en: '…', es: '…', pt: '…' },
     description: { en: '…', es: '…', pt: '…' },
   }
   ```

5. Open `index.html` from disk and check the new simulation (you can test a draft by opening its `index.html` directly).
6. When it is ready, set `status: 'live'` and push it to GitHub. Nothing else changes.

## License

All rights reserved. See [LICENSE](LICENSE).
