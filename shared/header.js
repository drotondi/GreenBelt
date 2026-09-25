/**
 * Shared page chrome: header (title, back-to-home link, EN|ES|PT switcher),
 * signature accent bar and footer. All text comes from shared i18n keys.
 *
 *   renderHeader({ variant: 'home' })  → hub title + subtitle
 *   renderHeader({ variant: 'sim' })   → "← Home" link + hub name
 */
(function (LSS) {
  'use strict';

  const { USE_BRAND_ASSETS, ROOT_URL, BRAND_ASSETS } = LSS.config;
  const { SUPPORTED_LANGS, getLang, setLang, onLangChange } = LSS.i18n;
  const { icon } = LSS.icons;

  // Explicit index.html: folder links do not resolve to index.html on file://
  const HOME_HREF = new URL('index.html', ROOT_URL).href;

  function applyBrandAssets() {
    if (!USE_BRAND_ASSETS || document.getElementById('brand-font')) return;
    const style = document.createElement('style');
    style.id = 'brand-font';
    style.textContent = `@font-face {
      font-family: "AmcorPro";
      src: url("${new URL(BRAND_ASSETS.font, ROOT_URL).href}") format("truetype");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }`;
    document.head.appendChild(style);
    document.documentElement.style.setProperty('--font-family', 'var(--font-family-brand)');
  }

  function logoMarkup() {
    if (!USE_BRAND_ASSETS) return '';
    const src = new URL(BRAND_ASSETS.logo, ROOT_URL).href;
    return `<img class="brand__logo" src="${src}" alt="" width="28" height="28">`;
  }

  function langSwitchMarkup() {
    const buttons = SUPPORTED_LANGS.map(
      (l) => `<button type="button" class="lang-switch__btn" data-lang="${l}" lang="${l}" data-i18n-attr="aria-label:lang.${l}">${l.toUpperCase()}</button>`
    ).join('');
    return `<div class="lang-switch" role="group" data-i18n-attr="aria-label:lang.label">${buttons}</div>`;
  }

  function renderHeader({ variant = 'home' } = {}) {
    applyBrandAssets();
    const el = document.getElementById('site-header');
    if (!el) return;

    const start =
      variant === 'home'
        ? `<div class="site-header__titles">
             <div class="brand">${logoMarkup()}<h1 class="site-header__title" data-i18n="hub.title"></h1></div>
             <p class="site-header__subtitle" data-i18n="hub.subtitle"></p>
           </div>`
        : `<div class="site-header__nav">
             <a class="back-link" href="${HOME_HREF}" data-keep-lang data-i18n-attr="aria-label:nav.homeAria">
               ${icon('arrowLeft', { size: 18 })}<span data-i18n="nav.home"></span>
             </a>
             <span class="site-header__divider" aria-hidden="true"></span>
             <span class="brand">${logoMarkup()}<span class="site-header__hub" data-i18n="hub.title"></span></span>
           </div>`;

    el.classList.add('site-header', `site-header--${variant}`);
    el.innerHTML = `
      <div class="container site-header__inner">
        ${start}
        ${langSwitchMarkup()}
      </div>
      <div class="accent-bar" aria-hidden="true"></div>`;

    const sync = () => {
      el.querySelectorAll('.lang-switch__btn').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
      });
    };
    el.querySelector('.lang-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-switch__btn');
      if (btn && btn.dataset.lang !== getLang()) setLang(btn.dataset.lang);
    });
    onLangChange(sync);
    sync();
  }

  function renderFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    el.classList.add('site-footer');
    el.innerHTML = `<div class="container"><p data-i18n="footer.credit"></p></div>`;
  }

  LSS.header = { renderHeader, renderFooter };
})(window.LSS = window.LSS || {});
