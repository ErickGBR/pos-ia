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
    timezone: process.env.DB_TIMEZONE || '-03:00',
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
