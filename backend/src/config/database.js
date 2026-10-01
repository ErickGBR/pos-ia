'use strict';

/**
 * CONFIG DE BASE DE DATOS — backend/src/config/database.js
 *
 * Lee el `.env` de la raiz del proyecto (dotenv) y expone la configuracion de
 * MySQL 8. Este archivo NO abre conexiones: solo describe COMO conectarse.
 *
 * Dos consumidores legitimos:
 *  1. `sequelize-cli` (migraciones) via `backend/.sequelizerc` -> `config`.
 *     El CLI exige un objeto plano indexado por nombre de entorno.
 *  2. `backend/src/container.js`, que es el UNICO lugar del codebase que
 *     ejecuta `new Sequelize(...)` con esta configuracion (DIP, R8).
 *
 * PROHIBIDO importarlo desde controllers/services/routes (R1).
 * NO contiene logica de negocio ni logica de acceso a datos.
 */

const path = require('path');
const dotenv = require('dotenv');

// El `.env` vive en la RAIZ del monorepo (D1) porque `docker-compose.yml` lo lee
// desde ahi, pero Node corre con cwd=backend/. Un `dotenv.config()` a secas
// buscaria `backend/.env`, no lo encontraria y TODAS las variables quedarian en
// undefined (incluido DB_PASSWORD): la app conectaria por suerte con los fallbacks
// de abajo y CORS/NODE_ENV/PORT se ignorarian en silencio. Por eso se carga por
// ruta explicita.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
// Un `.env` local de backend/ tiene prioridad si existe (override de desarrollo).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

/**
 * Zona horaria de TODAS las conexiones de la aplicacion. UTC, FIJO.
 *
 * NO es un knob de operacion: antes lo era (`process.env.DB_TIMEZONE`) y su
 * default era `'-03:00'`. Ese default rompio el historial de ventas (ver
 * "POR QUE UTC Y NO UN OFFSET" mas abajo) y ahora esta fijado a proposito.
 *
 * Se declara ANTES de `config` a proposito: `ajustesComunes()` lo lee al construir
 * los bloques, asi que declararlo despues lo deja en TDZ y el arranque revienta
 * con `ReferenceError` (medido, no supuesto).
 */
const ZONA_HORARIA_UTC = '+00:00';

/** Lee un entero del entorno con fallback (las variables llegan como texto). */
function entero(valor, porDefecto) {
  const n = Number.parseInt(valor, 10);
  return Number.isNaN(n) ? porDefecto : n;
}

/** Configuracion de MySQL. Se indexa por entorno porque asi la exige sequelize-cli. */
const config = {
  /**
   * Desarrollo local (Docker, `docker-compose.yml`): UNICO bloque con
   * credenciales de ejemplo, para que `npm run migrate` y el server arranquen
   * sin tocar nada. Estas credenciales viven solo en el compose local.
   */
  development: {
    username: process.env.DB_USER || 'pos_user',
    password: process.env.DB_PASSWORD || 'PosApp_2024_local',
    database: process.env.DB_NAME || 'pos_basic_ia',
    host: process.env.DB_HOST || '127.0.0.1',
    port: entero(process.env.DB_PORT, 3307),
    ...ajustesComunes(),
  },

  /**
   * Produccion: SOLO variables de entorno, sin NINGUN fallback.
   *
   * Antes no existia este bloque: `NODE_ENV=production` hacia que
   * `databaseConfig[entorno]` fuera `undefined`, el `|| development` de
   * `container.js` lo tapaba, el `if (!config) throw` nunca se disparaba y
   * `new Sequelize(undefined)` reventaba en el arranque con un TypeError
   * inentendible (hallazgo A1).
   *
   * Se eligio "fail-fast con mensaje accionable" y no "defaults de produccion"
   * porque este repo es una prueba tecnica PUBLICA: aqui NO pueden vivir
   * credenciales reales, y un fallback silencioso al bloque `development`
   * significaria que un deploy apuntaria por suerte a la base local. Si falta
   * una variable, `container.js` corta el arranque indicando cual es.
   */
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: entero(process.env.DB_PORT, 3307),
    ...ajustesComunes(),
  },
};

/**
 * Ajustes identicos en TODOS los entornos (dialecto, zona horaria, pool).
 * @returns {Object}
 */
function ajustesComunes() {
  return {
    dialect: 'mysql',
    logging: false,

    /**
     * UTC FIJO. Medido, no supuesto (el sintoma era "las ventas nuevas caen al
     * final del historial").
     *
     * QUE HACE ESTA OPCION, que es lo que nadie espera: Sequelize NO la usa solo
     * para interpretar los DATETIME que LEE. Al abrir cada conexion del pool le
     * manda al servidor un `SET time_zone = '<timezone>'`
     * (`sequelize/lib/dialects/mysql/connection-manager.js`, rama
     * `if (!this.sequelize.config.keepDefaultTimezone)`). O sea: esta opcion
     * cambia la zona horaria DE LA SESION DE MYSQL.
     *
     * Y eso levanta el punto grave: `sp_registrar_venta` inserta la cabecera con
     * `INSERT INTO ventas (total, createdAt, updatedAt) VALUES (v_total, NOW(),
     * NOW())`. `NOW()` se evalua en el servidor, con la zona de la sesion. Con la
     * sesion en `-03:00` el NOW() valia tres horas menos que el UTC real y ese
     * valor equivocado QUEDABA ESCRITO en la fila. No era un error de lectura:
     * el dato ya estaba corrupto en disco.
     *
     * Como `GET /api/ventas` ordena `ORDER BY createdAt DESC`, las ventas nuevas
     * (3h mas temprano de lo que deberian) quedaban POR DEBAJO de las viejas: el
     * historial al reves.
     *
     * MEDICION de la causa raiz (no una teoria):
     *   host            America/El_Salvador, UTC-6   (`date +%z`)
     *   contenedor MySQL TZ=UTC, offset +0000
     *   base, por CLI   @@system_time_zone=UTC, NOW() == UTC_TIMESTAMP()  (03:50:21)
     *   base, por la app @@session.time_zone='-03:00', NOW()=00:51:03 vs
     *                    UTC_TIMESTAMP()=03:51:03
     *   Node            process.env.TZ undefined, toISOString() correcto
     * Con `timezone:'+00:00'` la misma consulta devuelve NOW() == UTC_TIMESTAMP().
     *
     * POR QUE UTC Y NO UN OFFSET LOCAL: con `+00:00` la sesion de MySQL coincide
     * con el UTC real, asi que `NOW()` del SP, la hora que ve Node y la que se
     * lee por API son la MISMA, y el valor es correcto en la base y no depende de
     * desde donde se lea. Fijarlo aqui ademas neutraliza el `@@global.time_zone`
     * del servidor: si ese dia alguien configura la base en otra zona, la
     * aplicacion sigue escribiendo UTC.
     */
    timezone: ZONA_HORARIA_UTC,

    dialectOptions: {
      dateStrings: true,
      typeCast: true,
    },
    define: {
      underscored: false,
      freezeTableName: true,
    },
    pool: {
      max: entero(process.env.DB_POOL_MAX, 10),
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  };
}

module.exports = config;
