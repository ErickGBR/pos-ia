'use strict';

/**
 * REGISTRO DE MODELOS — backend/src/models/index.js
 *
 * Punto unico donde se definen las tablas de Sequelize y sus asociaciones.
 * `container.js` es el unico que lo invoca y el unico que tiene la instancia
 * de la base: aca NO se crea ninguna.
 *
 * Modelos de solo lectura (fase 2): `Venta` y `VentaDetalle` todavia no existen.
 * Sus asociaciones se declararan en `Venta` (ventas 1..N venta_detalle) sin tocar
 * este archivo de forma incompatible.
 */

const Producto = require('./Producto');

/**
 * Define todos los modelos sobre la instancia de base recibida.
 * @param {Object} sequelize instancia creada en `container.js`
 * @returns {{Producto: Object}} mapa de modelos ya definidos
 */
function definirModelos(sequelize) {
  const ProductoModel = Producto(sequelize);

  // --- Asociaciones (fase 2) -------------------------------------------
  // ventas 1..N venta_detalle: Producto hasMany VentaDetalle.
  // Se agrega junto con los modelos de ventas, que son de SOLO LECTURA (D2).
  // -----------------------------------------------------------------------

  return { Producto: ProductoModel };
}

module.exports = definirModelos;
