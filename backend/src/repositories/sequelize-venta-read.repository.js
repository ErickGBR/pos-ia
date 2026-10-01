'use strict';

/**
 * REPOSITORIO DE LECTURA DE VENTAS — HUECO PREPARADO (fase 2, UC-4)
 * backend/src/repositories/sequelize-venta-read.repository.js
 *
 * Las tablas `ventas` / `venta_detalle` todavia NO existen: este repositorio no
 * esta implementado y todos sus metodos fallan de forma explicita para que
 * nadie los use por error creyendo que funcionan.
 *
 * D2: las ventas son de SOLO LECTURA para la aplicacion. Este contrato jamas
 * escribe. El unico camino de escritura es el SP (ver
 * `sequelize-venta-write.repository.js`).
 */

const VentaReadRepository = require('../interfaces/venta-read.repository');

/** Mensaje unico para los metodos aun no disponibles. */
const NO_IMPLEMENTADO =
  'No implementado: el modulo de ventas llega en la fase 2 (UC-4).';

class SequelizeVentaReadRepository extends VentaReadRepository {
  /**
   * @inheritdoc
   */
  // eslint-disable-next-line no-unused-vars
  async listar(parametros) {
    throw new Error(NO_IMPLEMENTADO);
  }

  /**
   * @inheritdoc
   */
  // eslint-disable-next-line no-unused-vars
  async obtenerPorId(id) {
    throw new Error(NO_IMPLEMENTADO);
  }
}

module.exports = SequelizeVentaReadRepository;
