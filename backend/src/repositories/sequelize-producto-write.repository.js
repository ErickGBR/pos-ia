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
 *     Esa verificacion es FAIL-CLOSED: si no puede ejecutarse, el error
 *     propaga y NO hay borrado (nunca se responde "0" por fallar).
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
   * FAIL-CLOSED (D4): si la verificacion NO puede realizarse —tabla
   * `venta_detalle` inexistente, SP/indice ausente, falta de permisos, caida de
   * la base— el error PROPAGA tal cual llega desde el driver y el `eliminar`
   * jamas se ejecuta. No hay red de seguridad que degrade el conteo a 0: un 0
   * implicito significaria "no tiene historial" y habilitaria un `destroy()`
   * a ciego, que D4 prohibe. Mejor un 500 visible que una venta borrada.
   *
   * Tampoco se traduce a un error de dominio: la jerarquia de
   * `errors/domain-errors.js` modela reglas de negocio (404/400/409) y un fallo
   * de infraestructura no es ninguna de ellas. Se propaga y `errorHandler` lo
   * responde como 500 (clase de error generica, sin estado de la base).
   *
   * El nombre de la tabla va LITERAL en la sentencia y no concatenado: MySQL
   * solo acepta placeholders para VALORES (`:id`), nunca para identificadores,
   * y concatenar un identificador es el patron tipico de una SQL injection.
   * `venta_detalle` sale del schema fijado en docs/ARQUITECTURA.md §0.1 (no es
   * dato de usuario ni configurable), y asi `replacements:` queda reservado
   * exclusivamente para el parametro, igual que en el resto del repo.
   * @param {number} id
   * @returns {Promise<number>} ventas asociadas (0 = sin historial)
   * @throws {Error} si la verificacion no pudo ejecutarse (fail-closed)
   */
  async contarVentasAsociadas(id) {
    const sql = 'SELECT COUNT(*) AS total FROM `venta_detalle` WHERE producto_id = :id';
    const [filas] = await this.sequelize.query(sql, {
      replacements: { id },
      type: this.sequelize.constructor.QueryTypes.SELECT,
    });
    return Number(filas.total) || 0;
  }

  /**
   * @inheritdoc
   * UNICO `destroy()` del codebase. No re-verifica historial: la regla la aplico
   * el `ProductoService` llamando antes a `contarVentasAsociadas`, que corta con
   * 409 sin llegar aca si el producto tiene ventas, y que PROPAGA el error (sin
   * borrar) si la verificacion no pudo hacerse (D4 / R5, fail-closed).
   * @param {number} id
   * @returns {Promise<number>} filas afectadas
   */
  async eliminar(id) {
    return this.productos.destroy({ where: { id } });
  }
}

module.exports = SequelizeProductoWriteRepository;
module.exports.traducirDuplicado = traducirDuplicado;
