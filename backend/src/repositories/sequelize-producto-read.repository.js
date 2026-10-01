'use strict';

/**
 * REPOSITORIO DE LECTURA DE PRODUCTOS (implementacion ORM)
 * backend/src/repositories/sequelize-producto-read.repository.js
 *
 * UNICA capa autorizada a leer `productos` de la base. Implementa el contrato
 * `interfaces/producto-read.repository.js`.
 *
 * Reglas de esta capa:
 *  - CERO logica de negocio: no valida duplicados, no inventa defaults, no
 *    decide status HTTP.
 *  - CERO transacciones propias.
 *  - Devuelve OBJETOS PLANOS (via `producto-mapper`), no instancias del modelo,
 *    para que services/controllers no dependan del ORM.
 *
 * La dependencia (el modelo) llega POR CONSTRUCTOR desde `container.js`: este
 * archivo no instancia nada (DIP / R3 / R8).
 */

const { Op } = require('sequelize');
const ProductoReadRepository = require('../interfaces/producto-read.repository');
const { productoAPlano } = require('./producto-mapper');

class SequelizeProductoReadRepository extends ProductoReadRepository {
  /**
   * @param {Object} ProductoModel modelo `productos` ya instanciado
   */
  constructor(ProductoModel) {
    super();
    this.productos = ProductoModel;
  }

  /**
   * @inheritdoc
   * Filtro (UC-1): `nombre LIKE %q%` (parcial) o `codigo_barras = q` (exacto).
   * Sin `q`: listar todo. Orden `createdAt DESC`, paginado por limit/offset.
   * El COUNT reutiliza el MISMO where que el listado para que `meta.total`
   * sea consistente con las filas devueltas.
   * @param {{q?: string, limit: number, offset: number}} filtros
   * @returns {Promise<{data: Object[], total: number}>}
   */
  async listar(filtros) {
    const { q, limit, offset } = filtros;
    const busqueda = typeof q === 'string' ? q.trim() : '';

    const where = busqueda
      ? {
          [Op.or]: [
            { nombre: { [Op.like]: `%${busqueda}%` } },
            { codigo_barras: busqueda },
          ],
        }
      : undefined;

    const [filas, total] = await Promise.all([
      this.productos.findAll({ where, order: [['createdAt', 'DESC']], limit, offset }),
      this.productos.count({ where }),
    ]);

    return { data: filas.map(productoAPlano), total };
  }

  /**
   * @inheritdoc
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(id) {
    return productoAPlano(await this.productos.findByPk(id));
  }

  /**
   * @inheritdoc
   * @param {string} codigoBarras coincidencia EXACTA (identidad estable)
   * @returns {Promise<Object|null>}
   */
  async buscarPorCodigoBarras(codigoBarras) {
    const fila = await this.productos.findOne({ where: { codigo_barras: codigoBarras } });
    return productoAPlano(fila);
  }
}

module.exports = SequelizeProductoReadRepository;
