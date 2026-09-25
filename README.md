# Lean Six Sigma simulations

A hub of small, interactive simulations that make core Lean Six Sigma concepts visible, styled with the Amcor visual identity. The first simulation is the **Galton Board** (variation and the normal distribution).

**Live site:** https://drotondi.github.io/GreenBelt/

- Pure static site: vanilla HTML, CSS and JavaScript (ES modules). No frameworks, no build step, no npm.
- No external CDNs, remote fonts or analytics. Works offline once loaded.
- English, Spanish and Portuguese (`?lang=en|es|pt`, persisted across pages).

## Run locally

ES modules need an HTTP server (opening the files directly with `file://` will not work):

```sh
python3 -m http.server
```

Run it from the repository root, then open http://localhost:8000/.

## Brand assets flag

`shared/config.js`:

```js
export const USE_BRAND_ASSETS = false;
```

- `false` (default, safe for a public repo): Arial/Helvetica font stack, no logo.
- `true`: loads `assets/fonts/AmcorPro-Book.ttf` (with `font-display: swap` and Arial fallback) and shows `assets/logo-amcor-mark.png` in the header.

`assets/fonts/` and `assets/logo-*` are git-ignored. **Never commit Amcor font or logo files.** Add them locally only.

## Structure

```
index.html                 Home: renders cards from simulations/registry.js
shared/                    Design tokens, base styles, i18n, header, icons, config
simulations/registry.js    List of simulations shown on Home
simulations/galton-board/  Galton Board simulation
simulations/_template/     Copyable skeleton (status "draft", hidden from Home)
```

All colors, radii, shadows and motion values live in `shared/tokens.css`.

## How to add a new simulation

1. Copy `simulations/_template/` to `simulations/<your-id>/`.
2. Implement the simulation in `sim.js` / `sim.css`. Put every visible string in the folder's `i18n.js` (EN / ES / PT) under your own key prefix; no hardcoded UI text.
3. Replace `thumbnail.svg` with a 320×180 preview.
4. Add one entry to `simulations/registry.js`:

   ```js
   {
     id: 'your-id',
     path: 'simulations/your-id/',
     thumbnail: 'simulations/your-id/thumbnail.svg',
     status: 'draft',            // "live" shows it on Home
     tags: ['variation'],        // labels from shared i18n "tags.<id>", else a readable id
     title: { en: '…', es: '…', pt: '…' },
     description: { en: '…', es: '…', pt: '…' },
   }
   ```

5. When it is ready, set `status: 'live'`. Nothing else changes.

## License

All rights reserved. See [LICENSE](LICENSE).
