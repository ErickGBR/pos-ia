'use strict';

/**
 * CONTRATO DE LECTURA DE PRODUCTOS — backend/src/interfaces/producto-read.repository.js
 *
 * ISP (docs/ARQUITECTURA.md §2): lectura y escritura estan segregadas en
 * interfaces distintas porque cambian por razones distintas y porque un caso de
 * uso de lectura no necesita permiso de escritura.
 *
 * Este archivo define el CONTRATO, no la implementacion. La implementacion real
 * (ORM) vive en `repositories/sequelize-producto-read.repository.js` y un fake
 * de test puede sustituirla respetando exactamente estas firmas (LSP).
 *
 * PROHIBIDO: imports de Express, del ORM, de modelos o de `config/`.
 */

/**
 * @typedef {Object} Producto
 * @property {number} id
 * @property {string} nombre
 * @property {number} precio
 * @property {string} codigo_barras
 * @property {string} createdAt ISO-8601
 * @property {string} updatedAt ISO-8601
 */

/**
 * @typedef {Object} FiltroListadoProductos
 * @property {string} [q] texto libre: parcial en `nombre`, exacto en `codigo_barras`.
 *   Vacio o ausente = listar todo.
 * @property {number} page 1-based
 * @property {number} limit maximo de filas por pagina
 * @property {number} offset calculado por el service (page * limit)
 */

/**
 * @typedef {Object} ResultadoPaginado
 * @property {Producto[]} data
 * @property {number} total total de filas que cumplen el filtro (sin paginar)
 */

class ProductoReadRepository {
  /**
   * Lista productos con filtro opcional, orden `createdAt DESC` y paginacion.
   * @param {FiltroListadoProductos} filtros
   * @returns {Promise<ResultadoPaginado>}
   */
  // eslint-disable-next-line no-unused-vars
  async listar(filtros) {
    throw new Error('No implementado: corresponde al repositorio de lectura.');
  }

  /**
   * Busca un producto por su clave primaria.
   * @param {number} id
   * @returns {Promise<Producto|null>} null si no existe
   */
  // eslint-disable-next-line no-unused-vars
  async buscarPorId(id) {
    throw new Error('No implementado: corresponde al repositorio de lectura.');
  }

  /**
   * Busca un producto por codigo de barras EXACTO (identidad estable, no parcial).
   * @param {string} codigoBarras
   * @returns {Promise<Producto|null>} null si no existe
   */
  // eslint-disable-next-line no-unused-vars
  async buscarPorCodigoBarras(codigoBarras) {
    throw new Error('No implementado: corresponde al repositorio de lectura.');
  }
}

module.exports = ProductoReadRepository;
