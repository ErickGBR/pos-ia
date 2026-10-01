'use strict';

/**
 * CONTRATO DE LECTURA DE VENTAS — backend/src/interfaces/venta-read.repository.js
 *
 * Contrato de UC-4 (listar ventas / ver ticket). Implementado en
 * `repositories/sequelize-venta-read.repository.js`, que devuelve las ventas en
 * objetos planos (sin instancias del ORM), porque JSON.stringify no serializa
 * bien los getters de los modelos.
 *
 * D2 (critico): las ventas son de SOLO LECTURA para la aplicacion. Ningun
 * metodo de este contrato escribe nada.
 *
 * El `throw` de los cuerpos base es intencional: si la implementacion real no
 * fuera inyectada por `container.js`, la llamada falla ruidosamente en vez de
 * devolver datos silenciosamente vacios.
 *
 * PROHIBIDO: imports de Express, del ORM, de modelos o de `config/`.
 */

class VentaReadRepository {
  /**
   * Listado paginado de ventas, orden `createdAt DESC`, con sus lineas.
   *
   * Cada linea sale con `nombre` (del producto actual, por JOIN con LEFT): sin
   * el, el frontend cae en un fallback y muestra "Producto 1". La linea nunca
   * se pierde por falta del nombre: si no se puede resolver, sale `null`.
   * @param {{page: number, limit: number, offset: number}} parametros
   * @returns {Promise<{data: Object[], total: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async listar(parametros) {
    throw new Error('La implementacion real la inyecta container.js (contrato, no logica).');
  }

  /**
   * Cabecera de una venta con su detalle, para el ticket.
   * @param {number} id
   * @returns {Promise<Object|null>} null si no existe
   */
  // eslint-disable-next-line no-unused-vars
  async obtenerPorId(id) {
    throw new Error('La implementacion real la inyecta container.js (contrato, no logica).');
  }
}

module.exports = VentaReadRepository;
