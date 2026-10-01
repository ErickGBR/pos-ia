'use strict';

/**
 * FAKES DE TEST — backend/tests/helpers/fakes.js
 *
 * Implementaciones en memoria de los CONTRATOS que los services reciben por
 * constructor (DIP / LSP). Son las unicas piezas que comparten con los tests.
 *
 * Por que fakes y no `jest.mock()` del modulo entero: los services del proyecto
 * reciben sus dependencias por constructor, o sea que alcanza con pasarles un
 * objeto que cumpla el contrato. El modulo bajo prueba se carga REAL, con su
 * codigo real; lo unico que se sustituye es el borde (repositorios, base,
 * `req`/`res`). Esa es la diferencia entre una prueba unitaria y una de
 * integracion: aca no hay MySQL, ni Docker, ni puerto abierto.
 *
 * Ningun fake decide nada de negocio: no sabe si un producto existe, no valida
 * precios, no calcula totales. Si un test necesita que el SP rechace, el fake
 * lanza el `SpError` que el repositorio real lanzaria.
 */

/** Config de app equivalente a `config/app.js` en valores por defecto. */
const CONFIG_DE_PRUEBA = {
  pagination: { defaultPage: 1, defaultLimit: 20, maxLimit: 100 },
  ventas: { maxItemsPorCarrito: 100 },
};

/**
 * Repo de lectura de ventas: dos metodos, ambos solo lectura.
 * @param {{listar?: Function, obtenerPorId?: Function}} [sobrescrituras]
 */
function crearVentaReadRepo(sobrescrituras = {}) {
  return {
    listar: jest.fn(async () => ({ data: [], total: 0 })),
    obtenerPorId: jest.fn(async () => null),
    ...sobrescrituras,
  };
}

/**
 * Repo de escritura de ventas. Su UNICO metodo es `registrarConSP` (D2): si un
 * test necesita mas que esto, ya estaria inventando un segundo camino de
 * escritura, que es justo lo que el diseno prohibe.
 * @param {{registrarConSP?: Function}} [sobrescrituras]
 */
function crearVentaWriteRepo(sobrescrituras = {}) {
  return {
    registrarConSP: jest.fn(async () => ({ id: 1 })),
    ...sobrescrituras,
  };
}

/**
 * Repo de lectura de productos.
 * @param {Object} [sobrescrituras]
 */
function crearProductoReadRepo(sobrescrituras = {}) {
  return {
    listar: jest.fn(async () => ({ data: [], total: 0 })),
    buscarPorId: jest.fn(async () => null),
    buscarPorCodigoBarras: jest.fn(async () => null),
    ...sobrescrituras,
  };
}

/**
 * Repo de escritura de productos.
 * @param {Object} [sobrescrituras]
 */
function crearProductoWriteRepo(sobrescrituras = {}) {
  return {
    crear: jest.fn(async (datos) => ({ id: 1, ...datos })),
    actualizar: jest.fn(async (id, patch) => ({ id, ...patch })),
    eliminar: jest.fn(async () => undefined),
    contarVentasAsociadas: jest.fn(async () => 0),
    ...sobrescrituras,
  };
}

/**
 * Una linea de carrito valida, para partir de aca y romper solo el campo que el
 * test necesita romper.
 * @param {{productoId?: number, cantidad?: number, precioUnitario?: number}} [campos]
 */
function lineaValida(campos = {}) {
  return { productoId: 1, cantidad: 1, precioUnitario: 100, ...campos };
}

/**
 * Carrito valido de una linea, con el producto 1 y el precio 100.
 * @param {Object} [campos]
 */
function carritoValido(campos = {}) {
  return [lineaValida(campos)];
}

/** Venta ya persistida, tal como la devuelve el repo de lectura. */
function ventaPersistida(campos = {}) {
  return {
    id: 1,
    total: 100,
    createdAt: '2026-10-01T10:00:00.000Z',
    items: [{ producto_id: 1, nombre: 'Producto', cantidad: 1, precio_unitario: 100, subtotal: 100 }],
    ...campos,
  };
}

/**
 * `res` de Express minimo, con la misma cadena que usan los controllers:
 * `res.status(n).json(cuerpo)`. Graba lo que se le pidio responder.
 *
 * Por que no supertest para los controllers: los controllers no dependen de que
 * Express este conectado. Con este stub se verifica la UNICA cosa que el
 * controller decide (el status y el cuerpo) sin abrir un socket. El paso por
 * HTTP real, con router y middlewares, se cubre aparte en `tests/http/`.
 */
function resFalso() {
  return {
    statusCode: null,
    cuerpo: undefined,
    respondio: false,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      this.respondio = true;
      return this;
    },
  };
}

/**
 * `req` de Express minimo. Los controllers leen de `bodyValidado`,
 * `queryValidado`, `paramsValidado` y `params`: los cuatro los deja el
 * middleware `validate.js` antes de llegar al controller.
 * @param {{bodyValidado?: Object, queryValidado?: Object, paramsValidado?: Object, params?: Object}} [campos]
 */
function reqFalso(campos = {}) {
  return {
    body: {},
    query: {},
    params: {},
    method: 'GET',
    originalUrl: '/',
    ...campos,
  };
}

/**
 * Instancia de Sequelize falsa para probar el repositorio del SP.
 *
 * `query` se puede reponer con una implementacion propia: eso es lo que permite
 * verificar el CONTRATO (misma conexion en las tres consultas, orden de las
 * consultas, `replacements`) sin MySQL.
 *
 * @param {{query?: Function, idDevuelto?: *}} [opciones]
 *   `idDevuelto` es lo que devuelve el `SELECT @pos_venta_id`.
 */
function crearSequelizeFalsa(opciones = {}) {
  const { query, idDevuelto = 42 } = opciones;

  const sequelize = {
    connectionManager: {
      getConnection: jest.fn(async () => ({ id: 'conexion-falsa' })),
      releaseConnection: jest.fn(),
    },
    constructor: { QueryTypes: { SELECT: 'SELECT' } },
    query: jest.fn(query || (async (sql) => {
      if (/^\s*SELECT/i.test(sql)) return [{ id: idDevuelto }];
      return undefined;
    })),
  };

  return sequelize;
}

module.exports = {
  CONFIG_DE_PRUEBA,
  crearVentaReadRepo,
  crearVentaWriteRepo,
  crearProductoReadRepo,
  crearProductoWriteRepo,
  lineaValida,
  carritoValido,
  ventaPersistida,
  resFalso,
  reqFalso,
  crearSequelizeFalsa,
};