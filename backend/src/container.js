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
 * Las ventas quedan cableadas con sus repositorios en estado "hueco preparado":
 * el de escritura no expone ningun metodo de escritura por modelo, solo
 * `registrarConSP` (D2).
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

/** Entorno activo de la configuracion de base de datos. */
const entorno = appConfig.env;

/** @returns {Object} bloque de configuracion del entorno activo */
function configuracionDeBase() {
  const config = databaseConfig[entorno] || databaseConfig.development;
  if (!config) {
    throw new Error('No hay configuracion de base de datos para el entorno "' + entorno + '".');
  }
  return config;
}

// --- 1. Base de datos -------------------------------------------------------
const sequelize = new Sequelize(configuracionDeBase());

// --- 2. Modelos -------------------------------------------------------------
const modelos = definirModelos(sequelize);
const { Producto } = modelos;

// --- 3. Repositorios (implementaciones concretas de los contratos) -----------
const productoReadRepo = new ProductoReadRepository(Producto);
const productoWriteRepo = new ProductoWriteRepository(Producto, sequelize);
const ventaReadRepo = new VentaReadRepository();
const ventaWriteRepo = new VentaWriteRepository();

// --- 4. Services (dependen de interfaces, no de implementaciones) -----------
const productoService = new ProductoService(productoReadRepo, productoWriteRepo, {
  pagination: appConfig.pagination,
});

// --- 5. Controllers (dependen del caso de uso) -----------------------------
const productoController = new ProductoController(productoService);

// --- 6. Routers (dependen del controller ya cableado) ----------------------
const productoRouter = crearProductoRouter(productoController);

module.exports = {
  sequelize,
  modelos,
  config: appConfig,

  // Caso de uso (lo consume `server.js` para el cierre ordenado).
  productoService,

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
};
