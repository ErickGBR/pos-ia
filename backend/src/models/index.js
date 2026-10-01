'use strict';

/**
 * REGISTRO DE MODELOS — backend/src/models/index.js
 *
 * Punto único donde se definen las tablas de Sequelize y sus asociaciones.
 * `container.js` es el único que lo invoca y el único que tiene la instancia
 * de la base: aquí NO se crea ninguna.
 *
 * Modelos de solo lectura (D2): `Venta` y `VentaDetalle` existen SOLO para lectura
 * (listados UC-3 y UC-4). La escritura de ventas es EXCLUSIVAMENTE vía SP.
 */

const Producto = require('./Producto');
const Venta = require('./Venta');
const VentaDetalle = require('./VentaDetalle');

/**
 * Define todos los modelos sobre la instancia de base recibida.
 * @param {Object} sequelize instancia creada en `container.js`
 * @returns {{Producto: Object, Venta: Object, VentaDetalle: Object}} mapa de modelos ya definidos
 */
function definirModelos(sequelize) {
  const ProductoModel = Producto(sequelize);
  const VentaModel = Venta(sequelize);
  const VentaDetalleModel = VentaDetalle(sequelize);

  // --- Asociaciones -------------------------------------------------------
  // ventas 1..N venta_detalle
  VentaModel.hasMany(VentaDetalleModel, {
    foreignKey: 'venta_id',
    sourceKey: 'id',
    as: 'items',
  });
  VentaDetalleModel.belongsTo(VentaModel, {
    foreignKey: 'venta_id',
    targetKey: 'id',
    as: 'venta',
  });

  // producto 1..N venta_detalle (para JOINs de lectura en UC-4)
  ProductoModel.hasMany(VentaDetalleModel, {
    foreignKey: 'producto_id',
    sourceKey: 'id',
    as: 'ventasDetalle',
  });
  VentaDetalleModel.belongsTo(ProductoModel, {
    foreignKey: 'producto_id',
    targetKey: 'id',
    as: 'producto',
  });
  // -----------------------------------------------------------------------

  return { Producto: ProductoModel, Venta: VentaModel, VentaDetalle: VentaDetalleModel };
}

module.exports = definirModelos;
