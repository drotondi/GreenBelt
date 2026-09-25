/**
 * Simulation registry — the Home page renders its cards exclusively from this list.
 *
 * To add a simulation: copy simulations/_template/, build it, add one entry here
 * and set status to "live". Paths are relative to the site root and point to the
 * index.html file itself (folder links do not open index.html from disk).
 *
 * status: "live" (shown on Home) | "draft" (hidden from Home, still reachable by URL)
 * tags:   ids; labels come from shared i18n "tags.<id>" (falls back to a readable id)
 */
(function (LSS) {
  'use strict';

  const SIMULATIONS = [
    {
      id: 'galton-board',
      path: 'simulations/galton-board/index.html',
      thumbnail: 'simulations/galton-board/thumbnail.svg',
      status: 'live',
      tags: ['variation', 'normal-distribution'],
      title: {
        en: 'Galton Board',
        es: 'Tablero de Galton',
        pt: 'Tabuleiro de Galton',
      },
      description: {
        en: 'See how many small, independent random events add up to a bell curve: the root of common-cause variation.',
        es: 'Mira cómo muchos eventos aleatorios pequeños e independientes forman una curva de campana: el origen de la variación por causas comunes.',
        pt: 'Veja como muitos eventos aleatórios pequenos e independentes formam uma curva em sino: a origem da variação por causas comuns.',
      },
    },
    {
      id: 'template',
      path: 'simulations/_template/index.html',
      thumbnail: 'simulations/_template/thumbnail.svg',
      status: 'draft',
      tags: [],
      title: { en: 'Simulation template', es: 'Plantilla de simulación', pt: 'Modelo de simulação' },
      description: {
        en: 'Copyable skeleton for new simulations.',
        es: 'Estructura base para crear nuevas simulaciones.',
        pt: 'Estrutura base para criar novas simulações.',
      },
    },
  ];

  const liveSimulations = () => SIMULATIONS.filter((s) => s.status === 'live');

  LSS.registry = { SIMULATIONS, liveSimulations };
})(window.LSS = window.LSS || {});
