'use strict';

/**
 * CONFIG DE LA APLICACION — backend/src/config/app.js
 *
 * Parametros de infraestructura de la API (puerto, CORS, paginacion por
 * defecto). NO es configuracion de negocio: las reglas de negocio viven en
 * `services/`. NO abre conexiones ni registra middlewares.
 *
 * PROHIBIDO importarlo desde controllers/services/routes (R1 no aplica aqui,
 * pero la intencion es la misma: las capas internas no conocen el entorno).
 */

const path = require('path');
const dotenv = require('dotenv');

// Mismo criterio que `config/database.js`: el `.env` canonico esta en la RAIZ del
// monorepo y se carga por ruta explicita, porque el cwd de Node es `backend/`.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

/** Lee un entero del entorno con fallback. */
function entero(valor, porDefecto) {
  const n = Number.parseInt(valor, 10);
  return Number.isNaN(n) ? porDefecto : n;
}

/**
 * Convierte `CORS_ORIGIN` en el valor que espera el paquete `cors`.
 *
 * `CORS_ORIGIN` es una LISTA separada por comas
 * (`"http://localhost:8080,http://localhost:5173"`), pero el paquete `cors`
 * trata un string como UN ORIGEN LITERAL, nunca como lista: si se le pasa la
 * cadena entera responde `Access-Control-Allow-Origin` con la lista pegada y el
 * browser no matchea ninguno, asi que bloquea todas las llamadas. Por eso se
 * parte por coma y se entrega SIEMPRE UN ARRAY.
 *
 * SIEMPRE array, incluso con un solo origen (fix del menor de CORS). El
 * comportamiento del paquete `cors` esta verificado en su codigo y con curl, no
 * de cabeza (`cors/lib/index.js`, `configureOrigin`):
 *
 *   - `options.origin === '*'`  -> comodin, responde `Access-Control-Allow-Origin: *`
 *   - `isString(options.origin)` -> responds SIEMPRE con ese valor fijo, SIN
 *                                  comparar el `Origin` de la peticion
 *   - ARRAY                      -> `isOriginAllowed(origin, lista)`: COMPARA y
 *                                  solo refleja el origen si esta en la lista
 *
 * Antes, con un solo origen configurado se entregaba un string, o sea la rama
 * que NO compara. Hoy eso no abre la API (el ACAO que sale sigue siendo el
 * configurado, nunca el del atacante, asi que su browser lo bloquea igual), pero
 * es una bomba de tiempo: en cuanto se agregue `credentials: true` el string
 * fijo se_combina con el allow-credentials y deja de proteger. Con array, la
 * comparacion esta siempre activa.
 *
 * EXCEPCION DELVAGUIO, que se deja como string a proposito: cuando no hay
 * ningun origen configurado se devuelve `'*'`, el centinela de comodin del
 * paquete. Devolver `['*']` NO seria "dejarlo como array": caeria en la rama de
 * comparacion, `'*'` nunca matchea un `Origin` real y CORS quedaria
 * DESACTIVADO en desarrollo (curl, Postman y los tests de integracion lo
 * necesitan). O sea, un array silenciosamente rompe donde el string abre. El
 * comodin se reconoce por la forma, no por el contenido.
 *
 * Sin dependencias nuevas: `split` / `trim` / `filter` alcanzan.
 *
 * @param {string|undefined} valor crudo de `process.env.CORS_ORIGIN`
 * @returns {string|string[]} `'*'` si no hay ninguno (solo tolerable en
 *   desarrollo), o SIEMPRE un array de origenes si hay uno o mas
 */
function origenesCors(valor) {
  const lista = String(valor || '')
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen !== '');

  if (lista.length === 0) return '*';
  return lista;
}

/**
 * FAIL-CLOSED de CORS en produccion, con el mismo criterio que el fail-fast de
 * base de datos en `container.js`: cortar el arranque con un mensaje que diga
 * que tocar, en vez de seguir sirviendo una API abierta.
 *
 * Un `'*'` —o una lista vacia, que degrada a `'*'`— deja la API aceptando
 * peticiones de CUALQUIER origen. En `development` se tolera porque curl,
 * Postman y los tests de integracion lo necesitan.
 *
 * @param {string|string[]} origenes valor ya parseado por {@link origenesCors}
 * @param {string} env entorno activo (`appConfig.env`)
 * @throws {Error} si el entorno es `production` y `origenes` abre a cualquier origen
 */
function exigirOrigenesFijos(origenes, env) {
  if (env !== 'production') return;

  // Un '*' suelto, o escondido dentro de la lista, es el mismo agujero.
  const abierto = origenes === '*' || (Array.isArray(origenes) && origenes.includes('*'));
  if (!abierto) return;

  throw new Error(
    'CORS_ORIGIN no puede ser "*" ni quedar vacio en produccion: eso deja la ' +
    'API abierta a CUALQUIER origen. Define la lista explicita de origenes ' +
    'separados por coma en el .env de la raiz del monorepo (ver .env.example), ' +
    'por ejemplo: CORS_ORIGIN=https://pos.midominio.example',
  );
}

const env = process.env.NODE_ENV || 'development';
const origenCors = origenesCors(process.env.CORS_ORIGIN);

// Corta ANTES de que exista una app que pueda escuchar: cargar este modulo con
// un origen abierto en produccion es un error, no una configuracion valida.
exigirOrigenesFijos(origenCors, env);

const appConfig = {
  env,
  // `BACKEND_PORT` es el nombre del blueprint (§3); `PORT` es el que esta en el
  // `.env` real. Se aceptan ambos para no depender de uno solo.
  port: entero(process.env.BACKEND_PORT || process.env.PORT, 3000),

  /**
   * Origenes permitidos, YA parseados por {@link origenesCors}: SIEMPRE un array
   * cuando hay al menos un origen configurado, para que el paquete `cors`
   * compare el `Origin` entrante en vez de devolver un valor fijo. Solo queda
   * como string el comodin `'*'` (sin origenes configurados), que es el
   * centinela del propio paquete. En `production`, `'*'` y la lista vacia cortan
   * el arranque.
   */
  cors: {
    origin: origenCors,
  },

  /**
   * Paginacion por defecto de los casos de uso de listado.
   * Coincide con el contrato UC-1/UC-4 de docs/ARQUITECTURA.md.
   */
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100,
  },
};

module.exports = appConfig;
