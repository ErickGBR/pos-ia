'use strict';

/**
 * REPOSITORIO DE ESCRITURA DE PRODUCTOS (implementacion ORM)
 * backend/src/repositories/sequelize-producto-write.repository.js
 *
 * UNICA capa autorizada a escribir `productos` en la base. Implementa el
 * contrato `interfaces/producto-write.repository.js`.
 *
 * Aqui viven las dos garantias mecanicas de D4:
 *  1) `actualizar` arma el SET campo a campo y NUNCA incluye `codigo_barras` en
 *     el patch: la identidad comercial no se edita ni por error, aunque el
 *     cliente mande el campo.
 *  2) La baja fisica queda CONDICIONADA: `contarVentasAsociadas` responde si el
 *     producto tiene historial y `eliminar` borra. `eliminar` es el UNICO
 *     `destroy()` del codebase y su unica llamada real esta precedida por esa
 *     verificacion, que hace el `ProductoService` (R5).
 *
 * Sin logica de negocio: la DECISION de borrar o rechazar con 409 la toma el
 * service. Aqui solo se responden preguntas de datos y se traduce el rechazo de
 * unicidad de la base a `ConflictError` (traduccion de capa de datos).
 *
 * Las dependencias (modelo e instancia de base) llegan POR CONSTRUCTOR desde
 * `container.js`: este archivo no instancia nada (DIP / R3 / R8).
 */

const ProductoWriteRepository = require('../interfaces/producto-write.repository');
const { productoAPlano } = require('./producto-mapper');
const { ConflictError } = require('../errors/domain-errors');

/** Tabla de detalle de ventas: donde vive la FK hacia `productos`. */
const TABLA_VENTA_DETALLE = 'venta_detalle';

/**
 * Traduce el rechazo de unicidad de MySQL a error de dominio.
 * Se mira el campo implicito y no el nombre del indice, porque el UNIQUE de
 * codigo_barras puede reportarse como clave de columna o con nombre propio.
 * @param {Error} error error original de la capa de datos
 * @returns {ConflictError|null} error de dominio, o null si no es un duplicado
 */
function traducirDuplicado(error) {
  if (!error || error.name !== 'SequelizeUniqueConstraintError') return null;

  const detalle = JSON.stringify({
    fields: error.fields || null,
    message: error.message || '',
  });
  if (!detalle.includes('codigo_barras')) return null;

  return new ConflictError('Ya existe un producto con ese codigo de barras.', {
    campo: 'codigo_barras',
  });
}

class SequelizeProductoWriteRepository extends ProductoWriteRepository {
  /**
   * @param {Object} ProductoModel modelo `productos` ya instanciado
   * @param {Object} sequelize instancia de base, para la consulta de integridad
   */
  constructor(ProductoModel, sequelize) {
    super();
    this.productos = ProductoModel;
    this.sequelize = sequelize;
  }

  /**
   * @inheritdoc
   * @param {{nombre: string, precio: number, codigo_barras: string}} datos
   * @returns {Promise<Object>} producto creado
   * @throws {ConflictError} si el codigo de barras ya existe
   */
  async crear(datos) {
    try {
      const fila = await this.productos.create({
        nombre: datos.nombre,
        precio: datos.precio,
        codigo_barras: datos.codigo_barras,
      });
      return productoAPlano(fila);
    } catch (error) {
      throw traducirDuplicado(error) || error;
    }
  }

  /**
   * @inheritdoc
   * Actualiza SOLO `nombre` y `precio`. El patch se arma descartando los
   * campos `undefined`, de modo que un `codigo_barras` entrante se ignora por
   * construccion: nunca llega a la sentencia SQL (D4 / R5).
   * @param {number} id
   * @param {{nombre?: string, precio?: number}} cambios
   * @returns {Promise<Object|null>} producto actualizado o null si no existe
   */
  async actualizar(id, cambios) {
    const patch = {};
    if (cambios.nombre !== undefined) patch.nombre = cambios.nombre;
    if (cambios.precio !== undefined) patch.precio = cambios.precio;

    if (Object.keys(patch).length === 0) {
      return productoAPlano(await this.productos.findByPk(id));
    }

    const filasAfectadas = await this.productos.update(patch, { where: { id } });
    if (filasAfectadas === 0) return null;

    return productoAPlano(await this.productos.findByPk(id));
  }

  /**
   * @inheritdoc
   * Verificacion de integridad referencial de D4: cuenta las lineas de venta que
   * apuntan al producto.
   *
   * Fase 1 (sin `venta_detalle`): la tabla aun no existe y MySQL responde
   * ER_NO_SUCH_TABLE. Se degrada a 0 en vez de romper la baja, para que los
   * productos se puedan eliminar mientras el modulo de ventas no existe. En la
   * fase de ventas la tabla aparecera y esta misma consulta empezara a devolver
   * el conteo real, sin tocar el service ni el controller.
   * @param {number} id
   * @returns {Promise<number>} ventas asociadas (0 = sin historial)
   */
  async contarVentasAsociadas(id) {
    const sql = 'SELECT COUNT(*) AS total FROM `' + TABLA_VENTA_DETALLE + '` WHERE producto_id = :id';
    try {
      const [filas] = await this.sequelize.query(sql, {
        replacements: { id },
        type: this.sequelize.constructor.QueryTypes.SELECT,
      });
      return Number(filas.total) || 0;
    } catch (error) {
      const codigo = error && (error.parent ? error.parent.code : error.code);
      if (codigo === 'ER_NO_SUCH_TABLE' || codigo === 'ER_BAD_TABLE_ERROR') {
        return 0; // fase 1: todavia no existe el detalle de ventas
      }
      throw error;
    }
  }

  /**
   * @inheritdoc
   * UNICO `destroy()` del codebase. No re-verifica historial: la regla la aplico
   * el `ProductoService` llamando antes a `contarVentasAsociadas`, que corta con
   * 409 sin llegar aca si el producto tiene ventas (D4 / R5).
   * @param {number} id
   * @returns {Promise<number>} filas afectadas
   */
  async eliminar(id) {
    return this.productos.destroy({ where: { id } });
  }
}

module.exports = SequelizeProductoWriteRepository;
module.exports.traducirDuplicado = traducirDuplicado;
