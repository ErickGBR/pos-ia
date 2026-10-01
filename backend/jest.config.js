'use strict';

/**
 * CONFIGURACION DE JEST — backend/jest.config.js
 *
 * Decisiones y por que:
 *
 *  - `testEnvironment: 'node'`: el backend es una API Express/Sequelize, no corre
 *    en navegador. El entorno por defecto de Jest ya es node, pero se declara
 *    explicito para que el archivo sea autocontenido y no dependa del default.
 *
 *  - `roots: ['<rootDir>/tests']`: los tests viven FUERA de `src/`. Razon
 *    concreto: `container.js` y `config/app.js` recorren su propia carpeta
 *   Requireando todo lo que hay adentro; si los tests vivieran en `src/`, un
 *    `require` accidental podria terminar cargando un archivo de test como si
 *    fuera parte de la aplicacion. Ademas el arbol de `src/` documentado en
 *    docs/ARQUITECTURA.md §3 queda intacto: los tests no son codigo de
 *    produccion.
 *
 *  - `collectCoverageFrom` excluye `server.js` y `container.js`: son los unicos
 *    dos archivos que arrancan el proceso real (puerto y pool de conexiones).
 *    Cubrirlos exigiria levantar MySQL, que es justo lo que estas pruebas NO
 *    hacen (REGLA: pruebas unitarias, sin base de datos y sin Docker).
 *
 *  - `clearMocks` / `restoreMocks`: evita que un `jest.fn()` de una suite pise al
 *    de la siguiente. Sin esto, el estado de llamada de un fake se filtra entre
 *    archivos y las aserciones de "llamo una vez" dan falsos negativos segun el
 *    orden de ejecucion.
 *
 *  - Sin `setupFiles` a proposito: ningun test necesita Mongoz, timers falsos ni
 *    variables globales. Lo que se necesita (env por caso) se resuelve en el
 *    propio test con `tests/helpers/entorno.js`.
 */

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/container.js',
    '!src/migrations/**',
    '!src/seeders/**',
  ],
  coverageReporters: ['text-summary', 'text'],
  // Si un test queda colgado, que no tape la consola: el diagnostico util es el
  // mensaje de la prueba que fallo, no un timeout de 5 minutos.
  testTimeout: 10000,
};