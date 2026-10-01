/**
 * Helper de montaje y aserción para las pruebas unitarias del POS.
 *
 * Reglas del equipo:
 *  - Vue 2 + Vuetify 2: nunca el ecosistema de Vue 3 (este proyecto es Vue 2.7).
 *  - Vuetify se instala sobre el Vue BASE, igual que en src/main.js. Detalle
 *    importante: Vuetify resuelve sus componentes anidados con `baseCtor.extend`,
 *    y si el mixin de `$vuetify` solo viviera en un localVue, los hijos profundos
 *    (p. ej. <v-icon> dentro de <v-data-table>) se quedarían sin `$vuetify` y
 *    revientan con "Cannot read properties of undefined (reading 'icons')".
 *    Jest aísla los módulos por archivo de test, así que instalar en el Vue base
 *    no contamina a los demás archivos.
 *  - Toda prueba mockea la capa `src/api/`: cero llamadas HTTP reales.
 */
import Vue from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';

Vue.config.productionTip = false;
Vue.use(Vuetify);

/**
 * Monta un componente con Vuetify disponible y con la raíz dentro del documento.
 *
 * El DOM se limpia antes de cada montaje para que no queden restos de tests
 * anteriores, y la raíz del montaje se marca como [data-app] (el equivalente al
 * <v-app> de src/App.vue): así los diálogos de Vuetify se despegan HACIA el
 * propio wrapper y el texto del ticket se sigue pidiendo con wrapper.text().
 *
 * @param {Object} componente componente .vue importado por el test
 * @param {Object} [opciones] opciones de @vue/test-utils (mocks, propsData, slots…)
 * @returns {import('@vue/test-utils').Wrapper}
 */
export function montar(componente, opciones = {}) {
  if (document.body) document.body.innerHTML = '';

  const contenedor = document.createElement('div');
  document.body.appendChild(contenedor);

  const wrapper = mount(componente, {
    vuetify: new Vuetify(),
    attachTo: contenedor,
    ...opciones,
  });
  wrapper.element.setAttribute('data-app', '');
  return wrapper;
}

/** Todo el texto renderizado de un wrapper (útil para asserts de contenido). */
export function texto(wrapper) {
  return wrapper.text ? wrapper.text() : String(wrapper);
}

/**
 * Deja correr las microtareas pendientes (promesas resueltas de la capa api/)
 * y repinta: es el equivalente a flushPromises, que en @vue/test-utils v1 no existe.
 * @returns {Promise<void>}
 */
export async function actualizar(wrapper) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (wrapper && wrapper.vm) await wrapper.vm.$nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (wrapper && wrapper.vm) await wrapper.vm.$nextTick();
}

/** Espera real en ms (debounces de los buscadores: 300–350 ms). */
export function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Primer `<button>` cuyo texto contiene la cadena buscada.
 * @param {import('@vue/test-utils').Wrapper} wrapper
 * @param {string} parte texto visible del botón
 */
export function botonPorTexto(wrapper, parte) {
  const botones = wrapper.findAll('button').filter((b) => b.text().includes(parte));
  if (!botones.length) {
    throw new Error(`No se encontró ningún botón con el texto "${parte}". Texto visible: ${wrapper.text()}`);
  }
  return botones.at(0);
}
