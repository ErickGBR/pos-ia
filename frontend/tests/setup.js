/**
 * Preparación del entorno jsdom para las pruebas del POS.
 *
 * jsdom no implementa algunas APIs que Vuetify 2 y el navegador usan en
 * runtime; sin estos stubs los componentes revientan al montar.
 */

// Breakpoints de Vuetify (vuetify/src/services/breakpoint usa matchMedia).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (consulta) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom de Jest no expone requestAnimationFrame por defecto.
if (typeof global.requestAnimationFrame !== 'function') {
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  window.requestAnimationFrame = global.requestAnimationFrame;
  window.cancelAnimationFrame = global.cancelAnimationFrame;
}

// NOTA: la raíz [data-app] (equivalente al <v-app> de src/App.vue) la crea el
// helper tests/helpers/montar.js por montaje, para que cada test tenga DOM fresco.
