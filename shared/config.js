/**
 * Site configuration.
 *
 * USE_BRAND_ASSETS
 *   false (default, safe for a public repo): Arial/Helvetica font stack, no logo.
 *   true: loads assets/fonts/AmcorPro-Book.ttf and assets/logo-amcor-mark.png.
 *         Those files are git-ignored and must be added locally; never commit them.
 *
 * Classic script (no ES modules) so the site also works opened from disk (file://).
 * Everything shared lives under the global namespace window.LSS.
 */
(function (LSS) {
  'use strict';
  const src = document.currentScript && document.currentScript.src;

  LSS.config = {
    USE_BRAND_ASSETS: false,
    /** Absolute URL of the site root, derived from this file's location. */
    ROOT_URL: new URL('../', src || location.href),
    BRAND_ASSETS: {
      font: 'assets/fonts/AmcorPro-Book.ttf',
      logo: 'assets/logo-amcor-mark.png',
    },
  };
})(window.LSS = window.LSS || {});
