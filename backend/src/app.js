'use strict';

/**
 * APLICACION EXPRESS — backend/src/app.js
 *
 * Arma la instancia de Express: parser de JSON, CORS, rutas y el middleware
 * final de errores. NO escucha el puerto (eso es `server.js`) y NO contiene
 * logica de negocio.
 *
 * Las dependencias llegan por parametro en vez de importarse, para que este
 * archivo se pueda montar en un test sin levantar la base de datos. Quien las
 * cablea es `server.js`, leyendo el composition root (`container.js`).
 */

const express = require('express');
const cors = require('cors');
const errorHandler = require('./middlewares/errorHandler');

/**
 * @param {Object} deps
 * @param {import('express').Router} deps.productoRouter router ya cableado
 * @param {import('express').Router} deps.ventaRouter router ya cableado
 * @param {Object} deps.config configuracion de la app; `config.cors.origin` es
 *   OBLIGATORIO y viene parseado desde `config/app.js` (sin default a `'*'`)
 * @returns {import('express').Express}
 */
function crearApp({ productoRouter, ventaRouter, config = {} }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // El `origin` llega YA parseado y validado desde `config/app.js`: array si hay
  // varios origenes, string si hay uno, y en `production` un `'*'` o una lista
  // vacia cortan el arranque antes de llegar aca.
  //
  // ACA NO hay fallback a `'*'`, a proposito: un default que abre la API a
  // cualquier origen es justo el agujero que se cierra. Si falta la config,
  // preferimos morir con un mensaje claro antes que servir la API abierta.
  const origenCors = config.cors && config.cors.origin;
  if (!origenCors) {
    throw new Error(
      'crearApp necesita config.cors.origin para configurar CORS. No hay default ' +
      'a "*" por seguridad: define CORS_ORIGIN en el .env de la raiz del monorepo ' +
      '(ver .env.example) y pasa `config` desde container.js.',
    );
  }
  app.use(cors({ origin: origenCors }));

  // Raiz: responde para comprobar que la API esta viva sin tocar la base.
  app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use('/api', productoRouter);
  app.use('/api', ventaRouter);

  // Ruta no registrada -> mismo cuerpo de error que el resto de la API, en vez
  // del HTML por defecto de Express. El status lo decide `errorHandler`.
  app.use((req, res, next) => {
    const error = new Error('Ruta no encontrada: ' + req.method + ' ' + req.originalUrl);
    error.status = 404;
    next(error);
  });

  // Middleware de errores: SIEMPRE al final.
  app.use(errorHandler);

  return app;
}

module.exports = crearApp;
