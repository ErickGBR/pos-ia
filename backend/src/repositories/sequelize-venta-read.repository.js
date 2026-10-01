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
 * Construye el include que trae el nombre del producto en la MISMA fila de la linea.
 *
 * Es una FUNCION y no una constante porque el modelo `Producto` no existe todavia
 * cuando se carga este archivo: los modelos los define `container.js` despues de
 * inyectarlos. Si el include se armara al importar, `model` seria la factory
 * (una funcion) y Sequelize fallaria con
 * `include.model.getTableName is not a function` (medido). Ademas el include
 * depende de como se llame, asi que se arma por consulta.
 *
 * LEFT JOIN, no INNER: el objetivo es que la lectura de un historico NUNCA pueda
 * perder una linea. Con `INNER JOIN`, una linea cuya fila de producto no exista
 * (o un `producto_id` huerfano) desaparecia del ticket en silencio y el total
 * dejaba de cuadrar con las lineas. Con `LEFT JOIN` la linea siempre sale, y si
 * el nombre no aparece se ve explicitamente como `null` en vez de desaparecer.
 *
 * D4 + `venta_detalle.producto_id` con FK `ON DELETE RESTRICT` garantizan, ademas,
 * que la fila del producto exista siempre que haya una venta: la baja fisica
 * esta CONDICIONADA a no tener historial (409). El LEFT JOIN no depende de esa
 * garantia para no perder lineas: es la segunda barrera, no la unica.
 *
 * @param {Object} ProductoModel modelo `productos` ya instanciado
 * @returns {Object} include de Sequelize (`required: false` -> LEFT JOIN)
 */
function includeProducto(ProductoModel) {
  return {
    model: ProductoModel,
    as: 'producto',
    attributes: ['nombre'],
    required: false,
  };
}

/**
 * Proyecta una cabecera de venta con sus lineas al objeto plano del contrato.
 *
 * CRITERIO PARA EL NOMBRE, y su limite asumido a conciencia
 * -------------------------------------------------------
 * Se une contra el producto ACTUAL y no se guarda una instantanea del nombre en
 * `venta_detalle`. Se midieron las dos salidas antes de elegir:
 *
 *   - Instantanea (columna + trigger `BEFORE INSERT`): es lo unico que sobrevive
 *     a un renombre, pero NO se puede hacer sin tocar el SP (prohibido por D2),
 *     sin un segundo write path en la aplicacion (prohibido por Regla de Oro 7,
 *     y ademas rompe la atomicidad: si el proceso muere entre el CALL y el
 *     UPDATE la venta queda sin nombre) o sin relajar
 *     `--log-bin-trust-function-creators=1` en el servidor, que es una decision
 *     de seguridad del operador y no algo que deba colarse en un bugfix.
 *   - JOIN contra `productos`: cero cambios de esquema, cero permisos nuevos,
 *     cero escrituras extra, y no puede perder una venta (arriba).
 *
 * El limite que se acepta: si se RENOMBRA un producto, los tickets viejo
 * muestran el nombre nuevo. El precio no sufre esto porque ya viene congelado en
 * `venta_detalle.precio_unitario` (Regla de Oro 8). Si alguna vez hace falta
 * cerrar tambien el nombre, el camino es la columna + trigger del primer punto,
 * y es una migracion del operador, no un arreglo de lectura.
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
    items: ordenados.map(({ datos: d }) => {
      const producto = Array.isArray(d.producto) ? d.producto[0] : d.producto;

      return {
        producto_id: d.producto_id,
        // `null` (no un texto inventado) si el nombre no se puede resolver: el
        // frontend decide que mostrar y queda trazable que el dato falta, en vez
        // de esconder un error de datos detras de un "Producto 7" convincente.
        nombre: producto && producto.nombre != null ? producto.nombre : null,
        cantidad: Number(d.cantidad),
        precio_unitario: Number(d.precio_unitario),
        subtotal: Number(d.subtotal),
      };
    }),
  };
}

class SequelizeVentaReadRepository extends VentaReadRepository {
  /**
   * @param {Object} VentaModel modelo `ventas` ya instanciado
   * @param {Object} VentaDetalleModel modelo `venta_detalle` ya instanciado
   * @param {Object} ProductoModel modelo `productos` ya instanciado. Se injecta
   *   para el include que trae el `nombre` de cada linea: este archivo no importa
   *   modelos (DIP / R3 / R8), los recibe.
   */
  constructor(VentaModel, VentaDetalleModel, ProductoModel) {
    super();
    this.ventas = VentaModel;
    this.ventaDetalles = VentaDetalleModel;
    this.productos = ProductoModel;
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
        include: [
          {
            model: this.ventaDetalles,
            as: 'items',
            // El nombre cuelga de la LINEA, no de la cabecera: `producto_id` esta
            // en `venta_detalle`. Por eso el include va anidado adentro de `items`,
            // sobre la asociacion `VentaDetalle.belongsTo(Producto, as:'producto')`
            // que ya define `models/index.js`.
            include: [includeProducto(this.productos)],
          },
        ],
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
      include: [
        {
          model: this.ventaDetalles,
          as: 'items',
          include: [includeProducto(this.productos)],
        },
      ],
    });
    return ventaAPlano(fila);
  }
}

module.exports = SequelizeVentaReadRepository;
module.exports.ventaAPlano = ventaAPlano;
