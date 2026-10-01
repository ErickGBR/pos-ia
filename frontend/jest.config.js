/**
 * Configuración de Jest para el frontend (Vue 2 + Vuetify 2).
 *
 * Puntos clave:
 *  - Ecosistema Vue 2: transform de .vue con @vue/vue2-jest y @vue/test-utils v1.
 *  - babel.config.js ya detecta NODE_ENV=test y transpila a CommonJS
 *    (@vue/babel-preset-app fija targets node + modules commonjs), por eso no
 *    hace falta tocar la config de Babel del build.
 *  - Las pruebas viven en tests/unit/**\/*.spec.js y son SIEMPRE unitarias:
 *    montan el componente y mockean la capa src/api/, nunca hay HTTP real.
 */
module.exports = {
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['js', 'json', 'vue'],
  transform: {
    '^.+\\.vue$': '@vue/vue2-jest',
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|styl|sass|scss|less)$': '<rootDir>/tests/mocks/estilos.mock.js',
  },
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/unit/**/*.spec.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.{js,vue}',
    '!src/main.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov'],
};
