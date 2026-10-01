'use strict';

/**
 * COMPOSITION ROOT — backend/src/container.js
 *
 * ★ UNICO lugar del codebase que conoce el driver de base de datos, los modelos
 *   y las implementaciones concretas (DIP, R8, §2 de docs/ARQUITECTURA.md).
 *
 * Aca se hace TODO el cableado:
 *   config -> instancia de base -> modelos -> repositorios -> services -> controller
 *
 * Ningun otro archivo ejecuta `new Sequelize(...)`, `new Servicio(...)` ni
 * `new Repositorio(...)`: todos los reciben por constructor. Para cambiar la
 * implementacion (por un fake en test, por otro motor) se toca SOLO este archivo.
 *
 * Las ventas se cablean con la MISMA disciplina: repositorios -> service ->
 * controller -> router, con las estrategias de movimiento de venta registradas en el
 * mapa que recibe el service (OCP). El repositorio de escritura no expone ningun
 * metodo de escritura por modelo, solo `registrarConSP` (D2).
 */

const { Sequelize } = require('sequelize');

const databaseConfig = require('./config/database');
const appConfig = require('./config/app');
const definirModelos = require('./models');

const ProductoReadRepository = require('./repositories/sequelize-producto-read.repository');
const ProductoWriteRepository = require('./repositories/sequelize-producto-write.repository');
const VentaReadRepository = require('./repositories/sequelize-venta-read.repository');
const VentaWriteRepository = require('./repositories/sequelize-venta-write.repository');

const ProductoService = require('./services/producto.service');
const ProductoController = require('./controllers/producto.controller');
const crearProductoRouter = require('./routes/producto.routes');

const VentaService = require('./services/venta.service');
const { VentaNormalStrategy } = require('./services/venta-strategies');
const VentaController = require('./controllers/venta.controller');
const crearVentaRouter = require('./routes/venta.routes');

/** Entorno activo de la configuracion de base de datos. */
const entorno = appConfig.env;

/** @returns {Object} bloque de configuracion del entorno activo */
function configuracionDeBase() {
  const config = databaseConfig[entorno];

  // FAIL-FAST, sin fallback a `development` (hallazgo A1). Antes decia
  // `databaseConfig[entorno] || databaseConfig.development`, asi que con
  // NODE_ENV=production el `||` entregaba el bloque de desarrollo, el
  // `if (!config) throw` nunca se disparaba y el arranque moria despues,
  // dentro de `new Sequelize(undefined)`, con un TypeError inentendible.
  // Un deploy tiene que morir ACA, nombrando el entorno y diciendo que tocar.
  if (!config) {
    throw new Error(
      'No hay configuracion de base de datos para el entorno "' + entorno + '". ' +
      'Entornos disponibles: ' + Object.keys(databaseConfig).join(', ') + '. ' +
      'Defini el bloque en src/config/database.js o ajusta NODE_ENV.',
    );
  }

  // El bloque existe pero viene incompleto (p.ej. `production` sin DB_HOST,
  // DB_USER ni DB_NAME en el .env): mismo criterio, cortar antes de que
  // Sequelize intente conectar con `undefined` y devuelva un error opaco.
  const variables = { host: 'DB_HOST', username: 'DB_USER', database: 'DB_NAME' };
  const faltantes = Object.keys(variables).filter((campo) => !config[campo]);
  if (faltantes.length > 0) {
    throw new Error(
      'Configuracion de base de datos incompleta para el entorno "' + entorno + '": ' +
      'faltan ' + faltantes.map((campo) => variables[campo]).join(', ') + '. ' +
      'Definilas en el .env de la raiz del monorepo (ver .env.example).',
    );
  }

  return config;
}

// --- 1. Base de datos -------------------------------------------------------
const sequelize = new Sequelize(configuracionDeBase());

// --- 2. Modelos -------------------------------------------------------------
const modelos = definirModelos(sequelize);
const { Producto, Venta, VentaDetalle } = modelos;

// --- 3. Repositorios (implementaciones concretas de los contratos) -----------
const productoReadRepo = new ProductoReadRepository(Producto);
const productoWriteRepo = new ProductoWriteRepository(Producto, sequelize);
const ventaReadRepo = new VentaReadRepository(Venta, VentaDetalle);
const ventaWriteRepo = new VentaWriteRepository(sequelize);

// --- 4. Services (dependen de interfaces, no de implementaciones) -----------
const productoService = new ProductoService(productoReadRepo, productoWriteRepo, {
  pagination: appConfig.pagination,
});

/**
 * Mapa de estrategias de movimiento de venta (OCP, Regla de Oro 13).
 * ESTE es el lugar donde se registra un tipo nuevo: se agrega su clase al mapa y
 * no hay que tocar `venta.service.js`, que no conoce ningun tipo.
 */
const ventaStrategies = {
  normal: new VentaNormalStrategy(),
};

const ventaService = new VentaService(ventaReadRepo, ventaWriteRepo, ventaStrategies, {
  pagination: appConfig.pagination,
});

// --- 5. Controllers (dependen del caso de uso) -----------------------------
const productoController = new ProductoController(productoService);
const ventaController = new VentaController(ventaService);

// --- 6. Routers (dependen del controller ya cableado) ----------------------
const productoRouter = crearProductoRouter(productoController);
const ventaRouter = crearVentaRouter(ventaController);

module.exports = {
  sequelize,
  modelos,
  config: appConfig,

  // Casos de uso (los consume `server.js` para el cierre ordenado).
  productoService,
  ventaService,

  // Repositorios: se exportan para poder inyectar fakes en tests sin tocar
  // services ni controllers (LSP).
  repositories: {
    productoReadRepo,
    productoWriteRepo,
    ventaReadRepo,
    ventaWriteRepo,
  },

  // Superficie HTTP.
  productoController,
  productoRouter,
  ventaController,
  ventaRouter,
};
