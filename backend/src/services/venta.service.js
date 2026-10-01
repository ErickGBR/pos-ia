'use strict';

/**
 * CASOS DE USO DE VENTAS — backend/src/services/venta.service.js
 *
 * Unica capa con logica de negocio de ventas. Concentra los contratos UC-3
 * (registrar) y UC-4 (listar / ver ticket) de docs/ARQUITECTURA.md §4.
 *
 * D2 (CRITICO): la escritura de la venta ocurre SIEMPRE dentro del stored
 * procedure. Este service arma el JSON del carrito y se lo pasa a
 * `VentaWriteRepository.registrarConSP`, que ejecuta el `CALL`. No importa el ORM,
 * no importa modelos, no construye SQL y no abre ninguna transaccion: la
 * transaccion es la del SP.
 *
 * PROHIBIDO (SRP + DIP + R1/R4/R5): importar el ORM, importar el driver de base,
 * importar modelos, importar Express, recibir `req`/`res` o construir SQL a mano.
 * Solo conoce interfaces, que le inyecta `container.js`.
 *
 * OCP (Regla de Oro 13): `registrar` NO sabe ningun tipo de movimiento. Busca la
 * estrategia en el mapa que le inyecta el composition root y le delega la
 * construccion de las lineas. Agregar un tipo es agregar una clase en
 * `venta-strategies.js` + registrarla en `container.js`, sin tocar este archivo.
 *
 * Validacion en dos niveles (R10): la FORMA (que `items` sea un arreglo, que
 * `productoId` sea un entero, que los campos sean numeros) la revisa
 * `middlewares/validate.js`; las REGLAS DE NEGOCIO que siguen son de este service
 * y no se duplican arriba.
 */

const {
  NotFoundError,
  ValidationError,
  ConflictError,
  PayloadTooLargeError,
} = require('../errors/domain-errors');
const { SpError, ERNO_FUERA_DE_RANGO } = require('../errors/sp-error');
const { redondearADosDecimales } = require('../common/dinero');

/** Precio maximo admitido por la columna DECIMAL(10,2). */
const PRECIO_MAXIMO = 99999999.99;

/** Techo de `limit` si el service se construye sin config (ver `config/app.js`). */
const LIMIT_MAXIMO_POR_DEFECTO = 100;

/**
 * Tope de items por carrito si el service se construye sin config. Mismo valor
 * por defecto que `config/app.js -> ventas.maxItemsPorCarrito`, que es la fuente
 * de verdad: este es solo el fallback para un test que arme el service a mano.
 */
const MAX_ITEMS_POR_CARRITO_POR_DEFECTO = 100;

/** Tipo de movimiento por defecto cuando el cliente no manda ninguno. */
const TIPO_POR_DEFECTO = 'normal';

/**
 * Mensajes de rechazo del SP que son reglas de NEGOCIO ya validadas por esta capa
 * pero que el SP vuelve a verificar (el SP es la autoridad final). Se traducen a
 * `ValidationError` (400) en vez de dejar que un rechazo esperado del dominio
 * termine pareciendo un fallo del servidor.
 */
const PATRONES_VALIDACION_DEL_SP = [
  /detalle de la venta es nulo/i,
  /detalle de la venta debe ser un arreglo/i,
  /detalle de la venta esta vacio/i,
  /no tiene un producto_id valido/i,
  /no tiene una cantidad valida/i,
  /tiene una cantidad invalida/i,
  /no tiene un precio_unitario valido/i,
  /tiene un precio_unitario negativo/i,
];

/** El SP rechaza un `producto_id` que no esta en el catalogo (validacion 8 del SP). */
const PATRON_PRODUCTO_INEXISTENTE = /el producto (\d+) de la linea (\d+) no existe en el catalogo/i;

class VentaService {
  /**
   * Inyeccion por constructor de TODAS las dependencias (DIP, sin framework).
   * @param {Object} ventaReadRepo contrato de lectura (ISP: solo lectura)
   * @param {Object} ventaWriteRepo contrato de escritura (ISP: solo `registrarConSP`)
   * @param {Object} [strategies] mapa `tipo -> estrategia` (OCP)
   * @param {Object} [config] configuracion de la app (`pagination`, `ventas`)
   */
  constructor(ventaReadRepo, ventaWriteRepo, strategies = {}, config = {}) {
    this.read = ventaReadRepo;
    this.write = ventaWriteRepo;
    this.strategies = strategies;
    this.paginacion = config.pagination || {};
    this.reglasVentas = config.ventas || {};

    // Misma fuente de verdad que `ProductoService`: el techo de `limit` sale de
    // `config/app.js -> pagination.maxLimit`, no de un numero repetido aca.
    const maxLimit = Number(this.paginacion.maxLimit);
    this.maxLimit = Number.isInteger(maxLimit) && maxLimit > 0
      ? maxLimit
      : LIMIT_MAXIMO_POR_DEFECTO;

    // Idem para el tope de items del carrito (M-01): sale de
    // `config/app.js -> ventas.maxItemsPorCarrito`, que a su vez lo lee de
    // `VENTAS_MAX_ITEMS_CARRIZO`. El numero NO esta enterrado en este archivo.
    const maxItems = Number(this.reglasVentas.maxItemsPorCarrito);
    this.maxItemsPorCarrito = Number.isInteger(maxItems) && maxItems > 0
      ? maxItems
      : MAX_ITEMS_POR_CARRITO_POR_DEFECTO;
  }

  // ---------------------------------------------------------------- UC-3 ---

  /**
   * UC-3 — Registrar venta (carrito -> `sp_registrar_venta`).
   *
   * Secuencia del contrato:
   *  1. valida la forma y las reglas de negocio del carrito,
   *  2. delega en la Strategy del `tipo` la construccion de las lineas,
   *  3. `ventaWriteRepo.registrarConSP(lineas)` (el SP valida existencia de
   *     productos, calcula subtotales y total, e inserta cabecera + detalle en UNA
   *     transaccion),
   *  4. re-lee la venta por el read repo y la devuelve ya con sus items.
   *
   * @param {Array<{productoId: number, cantidad: number, precioUnitario: number}>} carrito
   * @param {string} [tipo] tipo de movimiento; `'normal'` si no se indica
   * @returns {Promise<{id: number, total: number, createdAt: *, items: Object[]}>}
   * @throws {PayloadTooLargeError} el carrito supera `ventas.maxItemsPorCarrito`
   * @throws {ValidationError} carrito vacio, cantidad o precio invalidos, tipo desconocido
   * @throws {NotFoundError} el SP rechazo porque un producto no existe en el catalogo
   * @throws {ConflictError} el SP rechazo por un conflicto de la operacion
   */
  async registrar(carrito, tipo = TIPO_POR_DEFECTO) {
    const items = this._validarCarrito(carrito);
    const lineas = this._construirLineas(items, tipo);

    let id;
    try {
      ({ id } = await this.write.registrarConSP(lineas));
    } catch (error) {
      // El repositorio ya detecto que el fallo vino de un `SIGNAL` del SP; aqui se
      // decide que error de DOMINIO es. Un rechazo del SP nunca sale como 500.
      throw this._traducirErrorDelSP(error);
    }

    // Paso 4 del contrato: la respuesta se arma con lo que quedo PERSISTIDO, no con
    // lo que el cliente pidio. Asi el total que ve el cliente es el que calculo el
    // SP y nunca una version recalculada aca.
    const venta = await this.read.obtenerPorId(id);
    if (!venta) {
      // No deberia ser posible: el SP acaba de insertar la cabecera. Si igualmente
      // no se puede leer, se dice con claridad en vez de devolver una venta vacia.
      throw new NotFoundError('Venta', id);
    }

    return venta;
  }

  // ---------------------------------------------------------------- UC-4 ---

  /**
   * UC-4 — Listar ventas, paginadas y de la mas reciente a la mas vieja.
   * @param {{page?: number|string, limit?: number|string}} [filtros]
   * @returns {Promise<{data: Object[], meta: {total: number, page: number, limit: number}}>}
   * @throws {ValidationError} si la paginacion es invalida
   */
  async listar(filtros = {}) {
    const { page, limit } = this._normalizarPaginacion(filtros);

    const { data, total } = await this.read.listar({
      limit,
      offset: (page - 1) * limit,
    });

    return { data, meta: { total, page, limit } };
  }

  /**
   * UC-4 — Ver el ticket de una venta.
   * @param {number|string} id
   * @returns {Promise<{id: number, total: number, createdAt: *, items: Object[]}>}
   * @throws {ValidationError} id no numerico
   * @throws {NotFoundError} la venta no existe
   */
  async obtenerPorId(id) {
    const ventaId = this._validarId(id, 'venta');

    const venta = await this.read.obtenerPorId(ventaId);
    if (!venta) throw new NotFoundError('Venta', ventaId);

    return venta;
  }

  // --------------------------------------------------------------- OCP ------

  /**
   * Resuelve la estrategia del tipo pedido y le delega la construccion de las
   * lineas. NO hay ningun `switch` por tipo: el mapa llega completo desde
   * `container.js`, asi que un tipo nuevo no se registra aca.
   * @param {Array<Object>} items carrito ya validado
   * @param {string} tipo
   * @returns {Array<{producto_id: number, cantidad: number, precio_unitario: number}>}
   * @throws {ValidationError} tipo desconocido o sin estrategia usable
   */
  _construirLineas(items, tipo) {
    if (typeof tipo !== 'string' || !tipo.trim()) {
      throw new ValidationError('El tipo de movimiento es obligatorio.', {
        tipo: 'debe ser un texto no vacio',
      });
    }

    const estrategia = this.strategies[tipo];
    if (!estrategia || typeof estrategia.construirLineas !== 'function') {
      throw new ValidationError('Tipo de movimiento no soportado: ' + tipo, {
        tipo,
        soportados: Object.keys(this.strategies),
      });
    }

    return estrategia.construirLineas(items);
  }

  // ------------------------------------------------------- validaciones -----

  /**
   * Valida el carrito completo y lo devuelve normalizado.
   * @param {*} carrito
   * @returns {Array<{productoId: number, cantidad: number, precioUnitario: number}>}
   * @throws {ValidationError}
   */
  _validarCarrito(carrito) {
    if (!Array.isArray(carrito)) {
      throw new ValidationError(
        'El detalle de la venta debe ser un arreglo de lineas de producto.',
        { items: 'debe ser un arreglo' },
      );
    }
    if (carrito.length === 0) {
      throw new ValidationError(
        'El detalle de la venta esta vacio: se debe enviar al menos una linea de producto.',
        { items: 'debe tener al menos una linea' },
      );
    }

    // M-01 (DoS / agotamiento de recursos). Va DESPUES de las dos reglas de
    // forma y ANTES del `.map` que valida linea por linea, a proposito:
    //   - despues, para no cambiar el contrato de un carrito vacio o no-arreglo
    //     (se siguen respondiendo 400 con su mensaje de siempre);
    //   - antes del `.map` y antes de llamar al SP, porque el costo crece con la
    //     cantidad de items: primero se rechaza el carrito enorme con un 413
    //     barato, y solo un carrito ya acotado paga la validacion completa, el
    //     `JSON_TABLE` del SP y los locks de la transaccion.
    if (carrito.length > this.maxItemsPorCarrito) {
      throw new PayloadTooLargeError(
        `El carrito tiene ${carrito.length} items y el maximo permitido es ` +
        `${this.maxItemsPorCarrito}. Dividi la compra en varias ventas.`,
        {
          items: `se recibieron ${carrito.length} items`,
          maxItemsPorCarrito: this.maxItemsPorCarrito,
        },
      );
    }

    return carrito.map((item, indice) => ({
      productoId: this._validarProductoId(item, indice),
      cantidad: this._validarCantidad(item, indice),
      precioUnitario: this._validarPrecioUnitario(item, indice),
    }));
  }

  /**
   * @param {*} item linea del carrito
   * @param {number} indice posicion (0-based) para el mensaje
   * @returns {number} productoId normalizado
   * @throws {ValidationError}
   */
  _validarProductoId(item, indice) {
    const linea = indice + 1;

    if (!item || typeof item !== 'object') {
      throw new ValidationError(`La linea ${linea} del carrito no es un objeto valido.`, {
        items: `linea ${linea} invalida`,
      });
    }

    const productoId = Number(item.productoId);
    if (!Number.isInteger(productoId) || productoId <= 0) {
      throw new ValidationError(
        `La linea ${linea} no tiene un productoId valido: debe ser un entero mayor que 0.`,
        { items: `linea ${linea} sin productoId valido` },
      );
    }
    return productoId;
  }

  /**
   * Regla de negocio: la cantidad es un entero MAYOR QUE 0.
   * @param {Object} item
   * @param {number} indice
   * @returns {number}
   * @throws {ValidationError}
   */
  _validarCantidad(item, indice) {
    const linea = indice + 1;
    const cantidad = Number(item.cantidad);

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new ValidationError(
        `La linea ${linea} tiene una cantidad invalida: debe ser un numero entero mayor que 0.`,
        { items: `linea ${linea} con cantidad invalida` },
      );
    }
    return cantidad;
  }

  /**
   * Regla de negocio: el precio unitario es editable y por eso puede ser 0
   * (cortesia, promocion, donation), pero NUNCA negativo. El valor que valida aca
   * es el que se congela en `venta_detalle.precio_unitario` (D3).
   * @param {Object} item
   * @param {number} indice
   * @returns {number} precio con 2 decimales
   * @throws {ValidationError}
   */
  _validarPrecioUnitario(item, indice) {
    const linea = indice + 1;

    if (item.precioUnitario === undefined || item.precioUnitario === null) {
      throw new ValidationError(
        `La linea ${linea} no tiene precioUnitario: es obligatorio y puede ser 0.`,
        { items: `linea ${linea} sin precioUnitario` },
      );
    }

    const precio = Number(item.precioUnitario);
    if (!Number.isFinite(precio)) {
      throw new ValidationError(
        `La linea ${linea} tiene un precioUnitario invalido: debe ser un numero.`,
        { items: `linea ${linea} con precioUnitario no numerico` },
      );
    }
    if (precio < 0) {
      throw new ValidationError(
        `La linea ${linea} tiene un precioUnitario negativo: debe ser mayor o igual a 0.`,
        { items: `linea ${linea} con precioUnitario negativo` },
      );
    }
    if (precio > PRECIO_MAXIMO) {
      throw new ValidationError(
        `La linea ${linea} tiene un precioUnitario fuera de rango (maximo ${PRECIO_MAXIMO}).`,
        { items: `linea ${linea} con precioUnitario fuera de rango` },
      );
    }

    // DECIMAL(10,2): el SP redondea el subtotal a 2 decimales, asi que el precio se
    // manda ya redondeado para que lo que se ve y lo que se guarda coincidan.
    //
    // El redondeo es EXACTO a 2 decimales, half-up comercial, sobre centavos
    // enteros (ver `common/dinero.js`). NO usar `Math.round(precio * 100) / 100`:
    // en coma flotante 1.005 * 100 es 100.49999999999999 y el precio quedaba en
    // 1.00 en vez de 1.01, perdiendo un centavo por linea.
    //
    // Precios con MAS de 2 decimales: SE REDONDEAN (half-up), no se rechazan.
    // Es la politica documentada en `common/dinero.js`: el contrato de la API,
    // el frontend y el SP ya asumen que esta capa normaliza a 2 decimales, y
    // rechazar romperia flujos que hoy pasan. 1.0054 -> 1.01, 1.0044 -> 1.00.
    return redondearADosDecimales(precio);
  }

  /**
   * @param {*} id
   * @param {string} recurso nombre del recurso para el mensaje
   * @returns {number}
   * @throws {ValidationError}
   */
  _validarId(id, recurso) {
    const numero = Number(id);
    if (!Number.isInteger(numero) || numero <= 0) {
      throw new ValidationError(
        `El id de la ${recurso} debe ser un numero entero positivo.`,
        { id: 'debe ser un entero positivo' },
      );
    }
    return numero;
  }

  /**
   * @param {{page?: *, limit?: *}} filtros
   * @returns {{page: number, limit: number}}
   * @throws {ValidationError}
   */
  _normalizarPaginacion(filtros) {
    const porDefecto = this.paginacion;

    const page = filtros.page === undefined || filtros.page === null || filtros.page === ''
      ? (porDefecto.defaultPage || 1)
      : Number(filtros.page);

    const limit = filtros.limit === undefined || filtros.limit === null || filtros.limit === ''
      ? (porDefecto.defaultLimit || 20)
      : Number(filtros.limit);

    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('El parametro page debe ser un entero mayor o igual a 1.', {
        page: 'debe ser un entero >= 1',
      });
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ValidationError('El parametro limit debe ser un entero mayor o igual a 1.', {
        limit: 'debe ser un entero >= 1',
      });
    }
    if (limit > this.maxLimit) {
      throw new ValidationError('El parametro limit no puede superar ' + this.maxLimit + '.', {
        limit: 'maximo ' + this.maxLimit,
      });
    }

    return { page, limit };
  }

  // ------------------------------------------------- traduccion del SP -------

  /**
   * Convierte un `SpError` (hecho tecnico de la capa de datos) en el error de
   * dominio que corresponde. Cualquier error que NO venga del SP se propaga tal
   * cual: un fallo de conexion o de sintaxis es un 500, no un 409 disfrazado.
   *
   * Traduccion vigente (mensajes del propio SP, ver
   * scripts/sp_registrar_venta.sql "VALIDACIONES Y ERRORES QUE PUEDE LANZAR"):
   *   - producto inexistente en el catalogo  -> NotFoundError (404)
   *   - forma / cantidad / precio invalidos  -> ValidationError (400)
   *   - total fuera del rango DECIMAL(10,2)   -> ConflictError (409)
   *   - cualquier otro rechazo del SP         -> ConflictError (409)
   * @param {Error} error
   * @returns {Error} error de dominio
   */
  _traducirErrorDelSP(error) {
    if (!(error instanceof SpError)) return error;

    const mensaje = error.message || '';
    const productoInexistente = PATRON_PRODUCTO_INEXISTENTE.exec(mensaje);
    if (productoInexistente) {
      return new NotFoundError('Producto', Number(productoInexistente[1]));
    }

    if (PATRONES_VALIDACION_DEL_SP.some((patron) => patron.test(mensaje))) {
      return new ValidationError(mensaje, { origen: 'sp_registrar_venta' });
    }

    // Desborde del motor al calcular o insertar el total: el cliente lo corrige
    // bajando la cantidad o el precio, asi que es un conflicto con el estado
    // pedido y no una caida del servidor.
    if (error.origen === 'rango' || ERNO_FUERA_DE_RANGO.includes(error.errno)) {
      return new ConflictError(
        'La venta no se pudo registrar: el total supera el maximo permitido por el esquema.',
        { origen: 'sp_registrar_venta', errno: error.errno },
      );
    }

    return new ConflictError(mensaje, { origen: 'sp_registrar_venta' });
  }
}

module.exports = VentaService;
