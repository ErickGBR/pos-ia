'use strict';

/**
 * CONTRATO DE LECTURA DE VENTAS — backend/src/interfaces/venta-read.repository.js
 *
 * HUECO PREPARADO para la fase 2 (UC-4: listar ventas / ver ticket).
 *
 * Estado actual: la tabla `ventas` todavia NO existe en la base y este modulo no
 * esta implementado. El contrato queda declarado para que `container.js` cablee
 * la implementacion sin tocar services ni controllers.
 *
 * D2 (critico): las ventas son de SOLO LECTURA para la aplicacion. Ningun
 * metodo de este contrato escribe nada.
 *
 * PROHIBIDO: imports de Express, del ORM, de modelos o de `config/`.
 */

class VentaReadRepository {
  /**
   * Listado paginado de ventas, orden `createdAt DESC`, con sus lineas.
   * @param {{page: number, limit: number, offset: number}} parametros
   * @returns {Promise<{data: Object[], total: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async listar(parametros) {
    throw new Error('No implementado: reserved para la fase de ventas (UC-4).');
  }

  /**
   * Cabecera de una venta con su detalle, para el ticket.
   * @param {number} id
   * @returns {Promise<Object|null>} null si no existe
   */
  // eslint-disable-next-line no-unused-vars
  async obtenerPorId(id) {
    throw new Error('No implementado: reservado para la fase de ventas (UC-4).');
  }
}

module.exports = VentaReadRepository;
