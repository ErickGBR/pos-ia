'use strict';

/**
 * AISLAR EL ENTORNO — backend/tests/helpers/entorno.js
 *
 * `config/app.js` lee `process.env` UNA sola vez, al importarse, y despues falla
 * rapido si el entorno es `production` con CORS abierto. Eso es correcto en
 * produccion e incomodo en tests: para probar cada rama del fail-closed hay que
 * cargar el modulo con distintos valores de entorno en el MISMO proceso.
 *
 * La tecnica es `jest.resetModules()` + `require` dentro del callback: el modulo
 * se vuelve a evaluar con el entorno nuevo y se devuelve recien evaluado. Como
 * `require` cachea por ruta, sin el reset la segunda prueba recibiria la config
 * de la primera (el fallo clasico: "el caso de produccion no dispara porque
 * `require` devolvio el modulo de la suite de desarrollo").
 *
 * `dotenv` no pisa variables ya definidas, asi que lo que se setea aca manda
 * sobre el `.env` real del monorepo: los tests no dependen de ese archivo ni lo
 * modifican.
 *
 * POR QUE UNA VARIABLE "AUSENTE" SE SETEA A `''` Y NO SE BORRA
 * ---------------------------------------------------------
 * Borrar la clave NO desconfigura nada: `dotenv` no pisa lo que ya existe pero SI
 * crea lo que falta, asi que `delete process.env.CORS_ORIGIN` le deja el lugar
 * libre y el `dotenv.config()` de `config/app.js` vuelve a poner el valor real del
 * `.env` de la maquina. El test terminaria midiendo el entorno de quien lo corre.
 *
 * Por eso `undefined` significa "configuralo vacio": la clave existe con `''`,
 * `dotenv` la respeta, y el modulo lo lee como no configurado. Para este modulo es
 * indistinguible de ausente porque todos sus lectores usan `||` o
 * `String(valor || '')`.
 */

/**
 * Corre `fn` con `variables` puestas en `process.env` y el modulo de config de
 * la app recien evaluado. Al terminar restaura el entorno original.
 *
 * @param {Object} variables pares entorno -> valor a setear. `undefined` = "sin
 *   configurar": se setea la clave a `''` en vez de borrarla (ver la nota de
 *   arriba sobre `dotenv`).
 * @param {(appConfig: Object) => void} fn recibe `require('src/config/app')` ya evaluado
 */
function conEntorno(variables, fn) {
  const previas = {};
  Object.keys(variables).forEach((clave) => {
    previas[clave] = process.env[clave];
  });

  Object.keys(variables).forEach((clave) => {
    process.env[clave] = variables[clave] === undefined ? '' : variables[clave];
  });

  jest.resetModules();
  try {
    const appConfig = require('../../src/config/app');
    return fn(appConfig);
  } finally {
    Object.keys(previas).forEach((clave) => {
      if (previas[clave] === undefined) {
        delete process.env[clave];
      } else {
        process.env[clave] = previas[clave];
      }
    });
    jest.resetModules();
  }
}

/**
 * Igual que {@link conEntorno}, pero devuelve el config en vez de pasarlo a un
 * callback. Para los casos en que la prueba es una expresion.
 *
 * @param {Object} variables
 * @returns {Object}
 */
function configCon(variables) {
  let capturado;
  conEntorno(variables, (appConfig) => {
    capturado = appConfig;
  });
  return capturado;
}

/**
 * Indica si cargar el modulo con este entorno LANZA (que es como se expresa el
 * fail-closed: no devuelve una config invalida, corta).
 *
 * @param {Object} variables
 * @returns {Error|null} el error lanzado, o null si cargo bien
 */
function errorAlCargarCon(variables) {
  try {
    configCon(variables);
    return null;
  } catch (error) {
    return error;
  }
}

module.exports = { conEntorno, configCon, errorAlCargarCon };