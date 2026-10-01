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

const appConfig = {
  env: process.env.NODE_ENV || 'development',
  // `BACKEND_PORT` es el nombre del blueprint (§3); `PORT` es el que esta en el
  // `.env` real. Se aceptan ambos para no depender de uno solo.
  port: entero(process.env.BACKEND_PORT || process.env.PORT, 3000),

  /** CORS abierto porque el frontend corre en otro origen (Vue dev server). */
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
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
