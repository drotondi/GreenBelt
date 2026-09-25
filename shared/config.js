/**
 * Site configuration.
 *
 * USE_BRAND_ASSETS
 *   false (default, safe for a public repo): Arial/Helvetica font stack, no logo.
 *   true: loads assets/fonts/AmcorPro-Book.ttf and assets/logo-amcor-mark.png.
 *         Those files are git-ignored and must be added locally; never commit them.
 */
export const USE_BRAND_ASSETS = false;

/** Absolute URL of the site root, derived from this file's location. */
export const ROOT_URL = new URL('../', import.meta.url);

export const BRAND_ASSETS = {
  font: 'assets/fonts/AmcorPro-Book.ttf',
  logo: 'assets/logo-amcor-mark.png',
};
