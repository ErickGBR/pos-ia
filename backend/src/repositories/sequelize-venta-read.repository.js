'use strict';

/**
 * REPOSITORIO DE LECTURA DE VENTAS (implementacion ORM)
 * backend/src/repositories/sequelize-venta-read.repository.js
 *
 * UNICA capa autorizada a leer `ventas` / `venta_detalle`. Implementa el contrato
 * `interfaces/venta-read.repository.js` (UC-4).
 *
 * D2: las ventas son de SOLO LECTURA para la aplicacion. Ningun metodo de este
 * archivo escribe nada: no hay `create`, ni `update`, ni `destroy`, ni una sola
 * consulta cruda. El unico camino de escritura es el SP, en
 * `sequelize-venta-write.repository.js`.
 *
 * Sin logica de negocio y sin transacciones propias. Devuelve OBJETOS PLANOS
 * (ver `ventaAPlano` al final del archivo), no instancias del modelo, para que
 * services y controllers no dependan del ORM. El mapeo vive aqui y no en un
 * mapper aparte porque el arbol de §3 de docs/ARQUITECTURA.md es definitivo y no
 * contempla un `venta-mapper.js`.
 *
 * Los modelos llegan POR CONSTRUCTOR desde `container.js`: este archivo no
 * instancia nada (DIP / R3 / R8).
 */

const VentaReadRepository = require('../interfaces/venta-read.repository');

/**
 * Proyecta una cabecera de venta con sus lineas al objeto plano del contrato.
 *
 * @param {Object|null} fila modelo `Venta` con `items`, o null
 * @returns {Object|null} `{ id, total, createdAt, items }`, o null si no existe
 */
function ventaAPlano(fila) {
  if (!fila) return null;

  const datos = typeof fila.toJSON === 'function' ? fila.toJSON() : fila;
  const itemsCrudos = Array.isArray(datos.items) ? datos.items : [];

  // El `include` no garantiza un orden y el contrato de UC-4 no expone el id de
  // linea, asi que se ordena por el id de `venta_detalle` (que si viene) ANTES de
  // proyectar al contrato. Asi dos lecturas de la misma venta devuelven las
  // lineas en el mismo orden, sin prometer nada sobre el orden de MySQL.
  const ordenados = itemsCrudos
    .map((item) => {
      const datosItem = typeof item.toJSON === 'function' ? item.toJSON() : item;
      return { datos: datosItem, orden: Number(datosItem.id) || 0 };
    })
    .sort((a, b) => a.orden - b.orden);

  return {
    id: datos.id,
    // DECIMAL(10,2) vuelve del driver como texto: se normaliza a number una sola
    // vez, en el borde de datos, para que el JSON de la API no lleve "8.10".
    total: Number(datos.total),
    createdAt: datos.createdAt,
    items: ordenados.map(({ datos: d }) => ({
      producto_id: d.producto_id,
      cantidad: Number(d.cantidad),
      precio_unitario: Number(d.precio_unitario),
      subtotal: Number(d.subtotal),
    })),
  };
}

class SequelizeVentaReadRepository extends VentaReadRepository {
  /**
   * @param {Object} VentaModel modelo `ventas` ya instanciado
   * @param {Object} VentaDetalleModel modelo `venta_detalle` ya instanciado
   */
  constructor(VentaModel, VentaDetalleModel) {
    super();
    this.ventas = VentaModel;
    this.ventaDetalles = VentaDetalleModel;
  }

  /**
   * @inheritdoc
   * Listado paginado `ORDER BY createdAt DESC` con las lineas de cada venta. El
   * `id` desempata ventas del mismo segundo, para que la paginacion sea estable y
   * no repita ni salte una cabecera.
   * @param {{page: number, limit: number, offset: number}} parametros
   * @returns {Promise<{data: Object[], total: number}>}
   */
  async listar({ limit, offset }) {
    const [filas, total] = await Promise.all([
      this.ventas.findAll({
        include: [{ model: this.ventaDetalles, as: 'items' }],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit,
        offset,
        subQuery: true,
      }),
      this.ventas.count(),
    ]);

    return { data: filas.map(ventaAPlano), total };
  }

  /**
   * @inheritdoc
   * @param {number} id
   * @returns {Promise<Object|null>} cabecera con sus lineas, o null si no existe
   */
  async obtenerPorId(id) {
    const fila = await this.ventas.findByPk(id, {
      include: [{ model: this.ventaDetalles, as: 'items' }],
    });
    return ventaAPlano(fila);
  }
}

module.exports = SequelizeVentaReadRepository;
module.exports.ventaAPlano = ventaAPlano;
