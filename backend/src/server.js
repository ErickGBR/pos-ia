'use strict';

/**
 * SERVIDOR — backend/src/server.js
 *
 * UNICO archivo que hace `listen()` y el UNICO que gestiona el cierre. Tambien
 * es quien conecta `container.js` (composition root) con `app.js` (Express).
 *
 * Responsabilidades:
 *  - verificar que la base responde antes de aceptar trafico,
 *  - escuchar en el puerto configurado,
 *  - cerrar de forma ordenada ante SIGINT/SIGTERM: se deja de aceptar
 *    conexiones, se cierra el pool de la base y se sale.
 */

const container = require('./container');
const crearApp = require('./app');

const { sequelize, config } = container;

/**
 * Arranca el servidor.
 * @returns {Promise<import('http').Server>}
 */
async function iniciar() {
  try {
    await sequelize.authenticate();
    console.log('[db] conexion OK -> ' + config.env);
  } catch (error) {
    console.error('[db] no se pudo conectar:', error.message);
    console.error('    revisa que MySQL 8 este arriba (npm run db:up) y el .env');
    process.exit(1);
  }

  const app = crearApp({ productoRouter: container.productoRouter, config });
  const server = app.listen(config.port, () => {
    console.log('[api] POS Basico IA escuchando en http://localhost:' + config.port + '/api');
  });

  const cerrar = (senal) => async () => {
    console.log('\n[api] ' + senal + ' recibido, cerrando...');
    server.close(async () => {
      try {
        await sequelize.close();
        console.log('[db] pool cerrado');
      } catch (error) {
        console.error('[db] error al cerrar el pool:', error.message);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', cerrar('SIGINT'));
  process.on('SIGTERM', cerrar('SIGTERM'));

  return server;
}

iniciar().catch((error) => {
  console.error('[api] fallo al arrancar:', error);
  process.exit(1);
});
