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
      id: 'littles-law',
      path: 'simulations/littles-law/index.html',
      thumbnail: 'simulations/littles-law/thumbnail.svg',
      status: 'live',
      tags: ['flow', 'wip', 'lead-time'],
      title: {
        en: "Little's Law: 3-process line",
        es: 'Ley de Little: línea de 3 procesos',
        pt: 'Lei de Little: linha com 3 processos',
      },
      description: {
        en: 'Run a live 3-step line and see why WIP = Throughput × Lead time: to cut lead time, cut WIP.',
        es: 'Opera una línea de 3 pasos en vivo y descubre por qué WIP = Throughput × Lead time: para bajar el lead time, baja el WIP.',
        pt: 'Opere uma linha de 3 etapas ao vivo e veja por que WIP = Throughput × Lead time: para reduzir o lead time, reduza o WIP.',
      },
    },
    {
      id: 'push-pull',
      path: 'simulations/push-pull/index.html',
      thumbnail: 'simulations/push-pull/thumbnail.svg',
      status: 'live',
      tags: ['pull', 'kanban', 'planning', 'inventory'],
      title: {
        en: 'Push vs. Pull: planning game',
        es: 'Push vs. Pull: juego de planificación',
        pt: 'Push vs. Pull: jogo de planejamento',
      },
      description: {
        en: 'Plan a forecast-driven line against a kanban line and feel why pull serves customers with far less inventory.',
        es: 'Planifica una línea guiada por pronóstico contra una línea kanban y siente por qué pull atiende a los clientes con mucho menos inventario.',
        pt: 'Planeje uma linha guiada por previsão contra uma linha kanban e sinta por que o pull atende os clientes com muito menos estoque.',
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
    {
      id: 'process-capability',
      path: 'simulations/process-capability/index.html',
      thumbnail: 'simulations/process-capability/thumbnail.svg',
      status: 'live',
      tags: ['capability', 'cpk', 'spc', 'control-chart'],
      title: {
        en: 'Process capability (Cp/Cpk)',
        es: 'Capacidad de proceso (Cp/Cpk)',
        pt: 'Capacidade do processo (Cp/Cpk)',
      },
      description: {
        en: 'Move the mean, spread and spec limits to see Cp, Cpk and defects change, then watch capability decay on a live X̄-R chart.',
        es: 'Mueve la media, la dispersión y los límites de especificación para ver cambiar Cp, Cpk y los defectos, y observa cómo cae la capacidad en una carta X̄-R en vivo.',
        pt: 'Mova a média, a dispersão e os limites de especificação para ver Cp, Cpk e defeitos mudarem, e veja a capacidade cair em uma carta X̄-R ao vivo.',
      },
    },
  ];

  const liveSimulations = () => SIMULATIONS.filter((s) => s.status === 'live');

  LSS.registry = { SIMULATIONS, liveSimulations };
})(window.LSS = window.LSS || {});
