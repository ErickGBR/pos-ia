'use strict';

/**
 * REPOSITORIO DE ESCRITURA DE VENTAS — HUECO PREPARADO (fase 2, UC-3)
 * backend/src/repositories/sequelize-venta-write.repository.js
 *
 * D2 (CRITICO, no negociable): la venta NUNCA se escribe por ORM. El UNICO
 * camino de escritura es `CALL sp_registrar_venta(:detalle_json)`, que inserta
 * cabecera y detalle en UNA transaccion y calcula los totales.
 *
 * Este archivo esta deliberadamente VACIO de implementacion:
 *  - No expone ningun metodo de escritura por modelo (ni alta, ni alta masiva,
 *    ni update), para que no exista un segundo camino que pueda divergir del SP.
 *  - `registrarConSP` fallara de forma explicita hasta que llegue la fase 2,
 *    con la definicion canonica en `scripts/sp_registrar_venta.sql`.
 *
 * Cuando se implemente, este sera el UNICO archivo del proyecto con
 * `sequelize.query('CALL sp_registrar_venta...')`.
 */

const VentaWriteRepository = require('../interfaces/venta-write.repository');

/** Mensaje unico para el metodo aun no disponible. */
const NO_IMPLEMENTADO =
  'No implementado: la venta se registra con CALL sp_registrar_venta en la fase 2 (UC-3).';

class SequelizeVentaWriteRepository extends VentaWriteRepository {
  /**
   * @inheritdoc
   * @param {Array<{producto_id: number, cantidad: number, precio_unitario: number}>} lineas
   * @returns {Promise<{id: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async registrarConSP(lineas) {
    throw new Error(NO_IMPLEMENTADO);
  }
}

module.exports = SequelizeVentaWriteRepository;
