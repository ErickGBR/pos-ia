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
 *
 * ARRANQUE FAIL-CLOSED, Y POR QUE `require('./container')` ESTA DENTRO DE LA
 * FUNCION Y NO ARRIBA DEL MODULO
 * -------------------------------------------------------------------
 * `container.js` LANZA al cargarse, y muy a proposito: es el unico lugar que
 * conoce el driver y las implementaciones concretas, y ahi viven los dos
 * fail-fast del proyecto (config de base incompleta o ausente, y CORS abierto en
 * produccion). Antes este archivo hacia
 *
 *     const container = require('./container');   // nivel superior del modulo
 *
 * o sea FUERA del `try` de `iniciar()`. Un `throw` en un `require` de nivel
 * superior no lo captura nadie: el proceso muere con el stack completo de Node
 * impreso por el "Uncaught exception", que es ruido de implementacion para el
 * operador que tiene que leerlo. Peor: el mensaje real (que variable falta, que
 * entorno, que tocar) queda buried en medio del stack.
 *
 * Ahora el `require` esta DENTRO de `iniciar()`, dentro del `try`, y cada fallo
 * conocido se reporta con un mensaje limpio que dice que corregir. El
 * comportamiento NO cambia: `process.exit(1)` en todos los caminos de fallo, y en
 * ninguno se levanta un servidor a medias. Fail-closed igual, pero legible.
 *
 * `crearApp` se importa arriba a proposito: no puede fallar por configuracion
 * (solo cablea lo que le inyectan) y asi la ruta de arranque del servidor queda
 * visible de un vistazo.
 */

const crearApp = require('./app');

/** Codigo de salida para "arranque imposible": 1, como siempre. */
const CODIGO_FALLO_ARRANQUE = 1;

/**
 * Arranca el servidor.
 * @returns {Promise<import('http').Server>}
 */
async function iniciar() {
  // El composition root se carga AQUI y no a nivel de modulo, para que sus
  // fail-fast caigan en el `catch` de abajo y salgan como mensaje y no como
  // stack. Ver la nota del encabezado del archivo.
  const container = require('./container');
  const { sequelize, config } = container;

  try {
    await sequelize.authenticate();
    console.log('[db] conexion OK -> ' + config.env);
  } catch (error) {
    console.error('[db] no se pudo conectar: ' + error.message);
    console.error('    revisa que MySQL 8 este arriba (npm run db:up) y el .env');
    process.exit(CODIGO_FALLO_ARRANQUE);
    return;
  }

  // Un router por modulo, los dos cableados en `container.js`. Es el unico punto
  // de contacto entre el composition root y Express: `app.js` no importa nada.
  const app = crearApp({
    productoRouter: container.productoRouter,
    ventaRouter: container.ventaRouter,
    config,
  });
  const server = app.listen(config.port, () => {
    console.log('[api] POS Basico IA escuchando en http://localhost:' + config.port + '/api');
  });

  // `app.listen()` NO propaga sus errores por la promesa: los emite en el evento
  // 'error' de forma ASINCRONA, cuando el `try` de esta funcion y el `.catch` de
  // abajo ya quedaron atras. `EADDRINUSE` (el puerto ocupado, que es el fallo de
  // arranque mas comun en la vida real) y `EACCES` (puerto <1024 sin permisos)
  // escapaban como "Unhandled 'error' event" con el stack completo de Node, que
  // es justo lo que este archivo existe para evitar. Se atajan aca.
  server.on('error', (error) => {
    const motivo = error && error.code === 'EADDRINUSE'
      ? 'el puerto ' + config.port + ' ya esta en uso'
      : (error && error.message ? error.message : String(error));

    console.error('[api] no se pudo escuchar en el puerto ' + config.port + ': ' + motivo + '.');
    console.error('    liberá el puerto o cambiá PORT en el .env de la raiz del monorepo, y volve a levantar.');
    process.exit(CODIGO_FALLO_ARRANQUE);
  });

  const cerrar = (senal) => async () => {
    console.log('\n[api] ' + senal + ' recibido, cerrando...');
    server.close(async () => {
      try {
        await sequelize.close();
        console.log('[db] pool cerrado');
      } catch (error) {
        console.error('[db] error al cerrar el pool: ' + error.message);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', cerrar('SIGINT'));
  process.on('SIGTERM', cerrar('SIGTERM'));

  return server;
}

iniciar().catch((error) => {
  // Todo lo que `iniciar()` no pudo resolver entra por aca: los fail-fast de
  // `container.js` (config de base incompleta, CORS abierto en produccion) y
  // cualquier fallo de `listen()`.
  //
  // Se imprime `error.message`, NO el error completo: el operador necesita el
  // motivo accionable, no veinte lineas de stack de Sequelize. El detalle crudo
  // queda disponible para depurar (`npm start` con NODE_DEBUG, o el stack del
  // proceso en un gestor) sin que ensucie el log de arranque.
  console.error('[api] el servidor no pudo arrancar:');
  console.error('    ' + (error && error.message ? error.message : String(error)));
  console.error('');
  console.error('    El arranque se detiene a proposito (fail-closed): no se sirve tráfico');
  console.error('    con la configuracion incompleta. Corrijo lo de arriba y volve a levantar.');
  process.exit(CODIGO_FALLO_ARRANQUE);
});
