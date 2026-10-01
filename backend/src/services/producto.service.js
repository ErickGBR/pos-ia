'use strict';

/**
 * CASOS DE USO DE PRODUCTOS — backend/src/services/producto.service.js
 *
 * Unica capa con logica de negocio. Concentra las reglas de UC-1 y UC-2 de
 * docs/ARQUITECTURA.md §4:
 *   - `nombre` no vacio (ni solo espacios)
 *   - `precio > 0`
 *   - `codigo_barras` obligatorio y UNICO (identidad estable)
 *   - `codigo_barras` NO se actualiza
 *   - baja fisica CONDICIONADA: con historial de ventas -> 409, sin borrado
 *   - paginacion valida
 *
 * PROHIBIDO en este archivo (SRP + DIP + R1/R5): importar el ORM, importar
 * modelos, importar Express, recibir `req`/`res`, construir SQL o abrir
 * transacciones. Solo conoce interfaces, que le inyecta `container.js`.
 *
 * Validacion en dos niveles (R10): la FORMA (tipos, requeridos) la revisa
 * `middlewares/validate.js`; las REGLAS DE NEGOCIO que siguen son de este
 * service y no se duplican arriba.
 */

const { NotFoundError, ValidationError, ConflictError } = require('../errors/domain-errors');
const { redondearADosDecimales } = require('../common/dinero');

/** Precio maximo admitido por la columna DECIMAL(10,2). */
const PRECIO_MAXIMO = 99999999.99;

/**
 * Techo de `limit` SOLO como ultimo recurso: la fuente de verdad es
 * `config/app.js -> pagination.maxLimit`, que `container.js` inyecta por
 * constructor. Este valor se usa unicamente si el service se construye sin
 * config (p.ej. un test aislado) o si la config trae algo no numerico.
 */
const LIMIT_MAXIMO_POR_DEFECTO = 100;

class ProductoService {
  /**
   * Inyeccion por constructor de TODAS las dependencias (DIP, sin framework).
   * @param {Object} productoReadRepo contrato de lectura
   * @param {Object} productoWriteRepo contrato de escritura
   * @param {Object} [config] configuracion de la app (defaults de paginacion)
   */
  constructor(productoReadRepo, productoWriteRepo, config = {}) {
    this.read = productoReadRepo;
    this.write = productoWriteRepo;
    this.paginacion = config.pagination || {};

    // Unica fuente de verdad del techo de `limit` (antes estaba hardcodeado
    // aca y tambien en `config/app.js`, con dos numeros que podian divergir).
    const maxLimit = Number(this.paginacion.maxLimit);
    this.maxLimit = Number.isInteger(maxLimit) && maxLimit > 0
      ? maxLimit
      : LIMIT_MAXIMO_POR_DEFECTO;
  }

  // ---------------------------------------------------------------- UC-1 ---

  /**
   * UC-1 — Listar y buscar productos.
   *
   * @param {{q?: string, page?: number|string, limit?: number|string}} [filtros]
   *   `q` filtra por coincidencia parcial en `nombre` o exacta en
   *   `codigo_barras`; vacio lista todo. `page` es 1-based.
   * @returns {Promise<{data: Object[], meta: {total: number, page: number, limit: number}}>}
   * @throws {ValidationError} si la paginacion es invalida
   *   (una lista vacia NUNCA es 404: devuelve `data: []`)
   */
  async listar(filtros = {}) {
    const { page, limit } = this._normalizarPaginacion(filtros);
    const q = typeof filtros.q === 'string' ? filtros.q.trim() : '';

    const { data, total } = await this.read.listar({
      q,
      limit,
      offset: (page - 1) * limit,
    });

    return { data, meta: { total, page, limit } };
  }

  // ---------------------------------------------------------------- UC-2 ---

  /**
   * UC-2 — Crear producto.
   *
   * @param {{nombre: string, precio: number, codigo_barras: string}} dto
   * @returns {Promise<Object>} producto creado
   * @throws {ValidationError} nombre vacio, precio <= 0 o codigo vacio
   * @throws {ConflictError} el codigo de barras ya existe
   */
  async crear(dto) {
    const datos = this._validarProducto(dto, { completo: true });

    // Pre-chequeo de negocio para dar un mensaje claro. La garantia REAL de
    // unicidad es el indice UNIQUE de la base: si aun asi llegase un duplicado
    // (carrera entre dos peticiones), el repositorio lo traduce a 409.
    const existente = await this.read.buscarPorCodigoBarras(datos.codigo_barras);
    if (existente) {
      throw new ConflictError('Ya existe un producto con ese codigo de barras.', {
        campo: 'codigo_barras',
      });
    }

    return this.write.crear(datos);
  }

  /**
   * UC-2 — Actualizar producto.
   *
   * SOLO `nombre` y `precio`. `codigo_barras` es identidad estable: si viene en
   * el body se ignora (no se propaga al repositorio) y no se considera cambio.
   *
   * @param {number|string} id
   * @param {{nombre?: string, precio?: number, codigo_barras?: string}} cambios
   * @returns {Promise<Object>} producto actualizado
   * @throws {ValidationError} cuerpo vacio, nombre vacio o precio <= 0
   * @throws {NotFoundError} el id no existe
   */
  async actualizar(id, cambios = {}) {
    const productoId = this._validarId(id);
    const patch = {};

    if (cambios.nombre !== undefined) {
      patch.nombre = this._validarNombre(cambios.nombre);
    }
    if (cambios.precio !== undefined) {
      patch.precio = this._validarPrecio(cambios.precio);
    }
    // `cambios.codigo_barras` se ignora a proposito (D4): identidad estable.

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('No hay campos para actualizar: se espera nombre y/o precio.', {
        campos: ['nombre', 'precio'],
      });
    }

    const actualizado = await this.write.actualizar(productoId, patch);
    if (!actualizado) throw new NotFoundError('Producto', productoId);

    return actualizado;
  }

  /**
   * UC-2 — Eliminar producto (baja fisica CONDICIONADA, D4).
   *
   * Secuencia obligatoria: verificar que existe -> verificar que NO tiene
   * historial de ventas -> recien ahi borrar. Con historial se corta con 409 y
   * NO se borra nada. Nunca hay un borrado a ciegas.
   *
   * @param {number|string} id
   * @returns {Promise<{id: number, eliminado: true}>}
   * @throws {ValidationError} id no numerico
   * @throws {NotFoundError} el id no existe
   * @throws {ConflictError} el producto tiene ventas asociadas
   */
  async eliminar(id) {
    const productoId = this._validarId(id);

    const existente = await this.read.buscarPorId(productoId);
    if (!existente) throw new NotFoundError('Producto', productoId);

    const ventas = await this.write.contarVentasAsociadas(productoId);
    if (ventas > 0) {
      throw new ConflictError(
        'No se puede eliminar: el producto tiene historial de ventas asociado.',
        { id: productoId, ventas },
      );
    }

    await this.write.eliminar(productoId);
    return { id: productoId, eliminado: true };
  }

  // ------------------------------------------------------- validaciones ----

  /**
   * Valida y normaliza el DTO de alta.
   * @param {Object} dto
   * @param {{completo: boolean}} opciones
   * @returns {{nombre: string, precio: number, codigo_barras: string}}
   * @throws {ValidationError}
   */
  _validarProducto(dto, { completo }) {
    if (!dto || typeof dto !== 'object') {
      throw new ValidationError('El cuerpo de la peticion es invalido.');
    }

    const nombre = this._validarNombre(dto.nombre, { requerido: completo });
    const precio = this._validarPrecio(dto.precio, { requerido: completo });

    if (completo) {
      const codigo_barras = typeof dto.codigo_barras === 'string' ? dto.codigo_barras.trim() : '';
      if (!codigo_barras) {
        throw new ValidationError('El codigo de barras es obligatorio.', {
          codigo_barras: 'es obligatorio',
        });
      }
      return { nombre, precio, codigo_barras };
    }

    return { nombre, precio };
  }

  /**
   * Regla de negocio: el nombre debe tener contenido real, no solo espacios.
   * @param {*} nombre
   * @param {{requerido?: boolean}} [opciones]
   * @returns {string} nombre normalizado
   * @throws {ValidationError}
   */
  _validarNombre(nombre, opciones = {}) {
    if (nombre === undefined || nombre === null) {
      if (opciones.requerido === false) return undefined;
      throw new ValidationError('El nombre es obligatorio.', { nombre: 'es obligatorio' });
    }
    if (typeof nombre !== 'string') {
      throw new ValidationError('El nombre debe ser texto.', { nombre: 'debe ser texto' });
    }

    const limpio = nombre.trim();
    if (!limpio) {
      throw new ValidationError('El nombre no puede estar vacio.', { nombre: 'no puede estar vacio' });
    }
    if (limpio.length > 255) {
      throw new ValidationError('El nombre no puede superar los 255 caracteres.', {
        nombre: 'maximo 255 caracteres',
      });
    }
    return limpio;
  }

  /**
   * Regla de negocio: el precio debe ser un numero mayor que cero.
   * @param {*} precio
   * @param {{requerido?: boolean}} [opciones]
   * @returns {number|undefined} precio normalizado
   * @throws {ValidationError}
   */
  _validarPrecio(precio, opciones = {}) {
    if (precio === undefined || precio === null) {
      if (opciones.requerido === false) return undefined;
      throw new ValidationError('El precio es obligatorio.', { precio: 'es obligatorio' });
    }

    const numero = typeof precio === 'number' ? precio : Number(String(precio).replace(',', '.'));
    if (!Number.isFinite(numero)) {
      throw new ValidationError('El precio debe ser un numero.', { precio: 'debe ser un numero' });
    }
    if (numero <= 0) {
      throw new ValidationError('El precio debe ser mayor a 0.', { precio: 'debe ser mayor a 0' });
    }
    if (numero > PRECIO_MAXIMO) {
      throw new ValidationError('El precio excede el maximo permitido (99999999.99).', {
        precio: 'excede el maximo permitido',
      });
    }
    // DECIMAL(10,2): 2 decimales, EXACTOS, half-up comercial sobre centavos
    // enteros (ver `common/dinero.js`). Mismo criterio que el precio congelado
    // en `venta.service.js -> _validarPrecioUnitario`, para que el catalogo y el
    // ticket no puedan divergir. Politica: los precios con mas de 2 decimales se
    // REDONDEAN (no se rechazan).
    return redondearADosDecimales(numero);
  }

  /**
   * Regla de negocio: el id debe ser un entero positivo.
   * @param {*} id
   * @returns {number}
   * @throws {ValidationError}
   */
  _validarId(id) {
    const numero = Number(id);
    if (!Number.isInteger(numero) || numero <= 0) {
      throw new ValidationError('El id del producto debe ser un numero entero positivo.', {
        id: 'debe ser un entero positivo',
      });
    }
    return numero;
  }

  /**
   * Regla de negocio: la paginacion tiene rango valido. Aplica defaults.
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
}

module.exports = ProductoService;
