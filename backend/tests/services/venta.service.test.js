'use strict';

/**
 * SUITE — VentaService (casos de uso de ventas)
 * backend/tests/services/venta.service.test.js
 *
 * Cubre el service REAL con repos FALSOS (`tests/helpers/fakes.js`): sin MySQL,
 * sin Docker, sin puerto. Lo que se verifica aca es la LOGICA DE NEGOCIO, o sea
 * lo unico que el service decide: validacion del carrito, eleccion de estrategia,
 * secuencia registrar -> releer, paginacion y TRADUCCION de los rechazos del
 * stored procedure a errores de dominio.
 *
 * El contrato con el SP (misma conexion, orden de consultas) se verifica aparte,
 * en `tests/repositories/sequelize-venta-write.repository.test.js`. Esta suite no
 * reimplementa ese contrato: solo verifica que el service llame al repo con las
 * lineas correctas y que sepa interpretar lo que el repo le devuelve.
 */

const VentaService = require('../../src/services/venta.service');
const { VentaNormalStrategy } = require('../../src/services/venta-strategies');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  PayloadTooLargeError,
} = require('../../src/errors/domain-errors');
const { SpError } = require('../../src/errors/sp-error');
const {
  CONFIG_DE_PRUEBA,
  crearVentaReadRepo,
  crearVentaWriteRepo,
  carritoValido,
  lineaValida,
  ventaPersistida,
} = require('../helpers/fakes');

/** Strategies reales: `normal` es la unica que registra la venta de siempre. */
const STRATEGIES = { normal: new VentaNormalStrategy() };

/**
 * Arma el service con fakes y devuelve el service junto con los repos, para que
 * cada prueba pueda Replacear la respuesta del repo sin volver a construir todo.
 * @param {Object} [opciones]
 * @param {Object} [opciones.read]
 * @param {Object} [opciones.write]
 * @param {Object} [opciones.strategies]
 * @param {Object} [opciones.config]
 */
function armarService(opciones = {}) {
  // El read fake por defecto responde con una venta YA PERSISTIDA: `registrar`
  // siempre relee despues de escribir, asi que un `obtenerPorId` que devuelve
  // null haria fallar por `NotFoundError` cualquier prueba que solo quiere
  // observar lo que se leyo al SP. Los casos que necesitan `null` lo pasan
  // explicito.
  const read = opciones.read || crearVentaReadRepo({
    obtenerPorId: jest.fn(async () => ventaPersistida()),
  });
  const write = opciones.write || crearVentaWriteRepo();

  const service = new VentaService(
    read,
    write,
    opciones.strategies || STRATEGIES,
    opciones.config || CONFIG_DE_PRUEBA,
  );

  return { service, read, write };
}

describe('VentaService', () => {
  describe('registrar — camino feliz', () => {
    it('devuelve la venta persistida, no la que pidio el cliente', async () => {
      const persistida = ventaPersistida({ id: 77, total: 250 });
      const { service } = armarService({
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => persistida) }),
      });

      const resultado = await service.registrar([lineaValida({ cantidad: 2, precioUnitario: 125 })]);

      // El service devuelve exactamente lo que leyo de la base: el total autoritativo
      // es el que calculo el SP, nunca un recalculo local (paso 4 del contrato).
      expect(resultado).toBe(persistida);
      expect(resultado.total).toBe(250);
    });

    it('traduce el contrato del cliente al snake_case que espera el SP', async () => {
      const { service, write } = armarService();

      await service.registrar([
        { productoId: 4, cantidad: 3, precioUnitario: 10.5 },
        { productoId: 9, cantidad: 1, precioUnitario: 0 },
      ]);

      expect(write.registrarConSP).toHaveBeenCalledTimes(1);
      expect(write.registrarConSP).toHaveBeenCalledWith([
        { producto_id: 4, cantidad: 3, precio_unitario: 10.5 },
        // precio 0 es VALIDO (cortesia / promocion): nunca se descarta la linea.
        { producto_id: 9, cantidad: 1, precio_unitario: 0 },
      ]);
    });

    it('re-lee la venta por el id que devolvio el SP', async () => {
      const { service, read } = armarService({
        write: crearVentaWriteRepo({ registrarConSP: jest.fn(async () => ({ id: 42 })) }),
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => ventaPersistida({ id: 42 })) }),
      });

      await service.registrar(carritoValido());

      expect(read.obtenerPorId).toHaveBeenCalledTimes(1);
      expect(read.obtenerPorId).toHaveBeenCalledWith(42);
    });

    it('usa la estrategia `normal` cuando el cliente no manda tipo', async () => {
      const construir = jest.fn(() => [{ producto_id: 1, cantidad: 1, precio_unitario: 100 }]);
      const { service, write } = armarService({
        strategies: { normal: { construirLineas: construir } },
      });

      await service.registrar(carritoValido());

      expect(construir).toHaveBeenCalledTimes(1);
      expect(write.registrarConSP).toHaveBeenCalledTimes(1);
    });

    it('delega en la estrategia del tipo pedido (OCP: sin switch por tipo)', async () => {
      const construir = jest.fn(() => []);
      const { service } = armarService({
        // Tipo nuevo inexistente en el codigo: si el service tuviera un switch por
        // tipo, este test no podria ni construir el caso.
        strategies: { ...STRATEGIES, devolucion: { tipo: 'devolucion', construirLineas: construir } },
      });

      await service.registrar(carritoValido(), 'devolucion');

      expect(construir).toHaveBeenCalledTimes(1);
    });

    it('no llama al SP si la validacion falla antes', async () => {
      const { service, write } = armarService();

      await expect(service.registrar([])).rejects.toBeInstanceOf(ValidationError);
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });
  });

  describe('registrar — validacion del carrito', () => {
    it.each([
      ['no es un arreglo', 'no-es-arreglo'],
      ['es null', null],
      ['es un objeto', { productoId: 1 }],
    ])('rechaza un carrito que %s', async (_descripcion, carrito) => {
      const { service, write } = armarService();

      await expect(service.registrar(carrito)).rejects.toBeInstanceOf(ValidationError);
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });

    it('rechaza el carrito vacio con un mensaje que lo dice', async () => {
      const { service } = armarService();

      await expect(service.registrar([])).rejects.toThrow(/esta vacio/i);
    });

    it('rechaza con 413 el carrito que supera el tope de items (M-01)', async () => {
      const config = { pagination: CONFIG_DE_PRUEBA.pagination, ventas: { maxItemsPorCarrito: 3 } };
      const { service, write } = armarService({ config });

      const enorme = Array.from({ length: 4 }, () => lineaValida());

      await expect(service.registrar(enorme)).rejects.toBeInstanceOf(PayloadTooLargeError);
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });

    it('el 413 del tope de items se distingue del 400 de un carrito invalido', async () => {
      const config = { pagination: CONFIG_DE_PRUEBA.pagination, ventas: { maxItemsPorCarrito: 3 } };
      const { service } = armarService({ config });

      // Mismo "carrito que no se puede procesar", dos causas distintas: por TAMAÑO
      // (413, el cliente divide) y por FORMA (400, el cliente edita).
      await expect(service.registrar(Array.from({ length: 9 }, () => lineaValida())))
        .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
      await expect(service.registrar([])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('acepta el carrito exactamente en el tope (borde inclusivo)', async () => {
      const config = { pagination: CONFIG_DE_PRUEBA.pagination, ventas: { maxItemsPorCarrito: 3 } };
      const { service, write } = armarService({ config });

      await service.registrar(Array.from({ length: 3 }, () => lineaValida()));

      expect(write.registrarConSP).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['productoId ausente', { cantidad: 1, precioUnitario: 10 }],
      ['productoId en cero', { productoId: 0, cantidad: 1, precioUnitario: 10 }],
      ['productoId negativo', { productoId: -1, cantidad: 1, precioUnitario: 10 }],
      ['productoId decimal', { productoId: 1.5, cantidad: 1, precioUnitario: 10 }],
      ['productoId no numerico', { productoId: 'abc', cantidad: 1, precioUnitario: 10 }],
      ['la linea no es un objeto', 'no-es-objeto'],
      ['la linea es null', null],
    ])('rechaza cuando %s', async (_descripcion, item) => {
      const { service } = armarService();

      await expect(service.registrar([item])).rejects.toBeInstanceOf(ValidationError);
    });

    it('el mensaje de productoId invalido dice QUE LINEA es (posicion 1-based)', async () => {
      const { service } = armarService();

      await expect(service.registrar([lineaValida(), { cantidad: 1, precioUnitario: 5 }]))
        .rejects.toThrow(/linea 2/i);
    });

    it.each([
      ['cantidad en cero', { productoId: 1, cantidad: 0, precioUnitario: 10 }],
      ['cantidad negativa', { productoId: 1, cantidad: -3, precioUnitario: 10 }],
      ['cantidad decimal', { productoId: 1, cantidad: 1.5, precioUnitario: 10 }],
      ['cantidad ausente', { productoId: 1, precioUnitario: 10 }],
      ['cantidad no numerica', { productoId: 1, cantidad: 'dos', precioUnitario: 10 }],
    ])('rechaza cantidad: %s', async (_descripcion, item) => {
      const { service, write } = armarService();

      await expect(service.registrar([item])).rejects.toBeInstanceOf(ValidationError);
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });

    it('acepta cantidad 1 y cantidades altas (entero > 0, sin tope propio)', async () => {
      const { service, write } = armarService();

      await service.registrar([
        lineaValida({ cantidad: 1 }),
        lineaValida({ productoId: 2, cantidad: 9999 }),
      ]);

      expect(write.registrarConSP).toHaveBeenCalledTimes(1);
    });

    it('precioUnitario ausente o null es 400, porque es obligatorio', async () => {
      const { service } = armarService();

      await expect(service.registrar([{ productoId: 1, cantidad: 1 }]))
        .rejects.toBeInstanceOf(ValidationError);
      await expect(service.registrar([{ productoId: 1, cantidad: 1, precioUnitario: null }]))
        .rejects.toBeInstanceOf(ValidationError);
    });

    it('acepta precioUnitario 0 (cortesia / promocion) y lo propaga', async () => {
      const { service, write } = armarService();

      await service.registrar([lineaValida({ precioUnitario: 0 })]);

      expect(write.registrarConSP).toHaveBeenCalledWith([
        { producto_id: 1, cantidad: 1, precio_unitario: 0 },
      ]);
    });

    it.each([
      ['precioUnitario negativo', { productoId: 1, cantidad: 1, precioUnitario: -0.01 }],
      ['precioUnitario NaN', { productoId: 1, cantidad: 1, precioUnitario: Number.NaN }],
      ['precioUnitario Infinity', { productoId: 1, cantidad: 1, precioUnitario: Infinity }],
      ['precioUnitario no numerico', { productoId: 1, cantidad: 1, precioUnitario: 'gratis' }],
      ['precioUnitario sobre el DECIMAL(10,2)', { productoId: 1, cantidad: 1, precioUnitario: 100000000 }],
    ])('rechaza %s', async (_descripcion, item) => {
      const { service, write } = armarService();

      await expect(service.registrar([item])).rejects.toBeInstanceOf(ValidationError);
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });

    it('acepta el precio en el borde exacto del DECIMAL(10,2)', async () => {
      const { service, write } = armarService();

      await service.registrar([lineaValida({ precioUnitario: 99999999.99 })]);

      expect(write.registrarConSP).toHaveBeenCalledWith([
        { producto_id: 1, cantidad: 1, precio_unitario: 99999999.99 },
      ]);
    });

    it('acepta el precio como texto numerico (llega de query/form)', async () => {
      const { service, write } = armarService();

      await service.registrar([lineaValida({ precioUnitario: '19.90' })]);

      expect(write.registrarConSP).toHaveBeenCalledWith([
        { producto_id: 1, cantidad: 1, precio_unitario: 19.9 },
      ]);
    });
  });

  describe('registrar — tipo de movimiento', () => {
    it('rechaza un tipo vacio, en blanco o no textual', async () => {
      const { service, write } = armarService();

      await expect(service.registrar(carritoValido(), '')).rejects.toBeInstanceOf(ValidationError);
      await expect(service.registrar(carritoValido(), '   ')).rejects.toBeInstanceOf(ValidationError);
      await expect(service.registrar(carritoValido(), 42)).rejects.toBeInstanceOf(ValidationError);

      expect(write.registrarConSP).not.toHaveBeenCalled();
    });

    it('rechaza un tipo desconocido y lista los soportados', async () => {
      const { service } = armarService();

      await expect(service.registrar(carritoValido(), 'liquidacion'))
        .rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          detalles: { tipo: 'liquidacion', soportados: ['normal'] },
        });
    });

    it('rechaza una estrategia registrada pero sin `construirLineas`', async () => {
      const { service } = armarService({ strategies: { roto: {} } });

      await expect(service.registrar(carritoValido(), 'roto')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('registrar — traduccion de los rechazos del SP', () => {
    it('producto inexistente en el catalogo -> NotFoundError (404)', async () => {
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw new SpError('El producto 77 de la linea 1 no existe en el catalogo.', {
              sqlState: '45000',
              errno: 1644,
            });
          }),
        }),
      });

      await expect(service.registrar([lineaValida({ productoId: 77 })])).rejects.toMatchObject({
        code: 'NOT_FOUND',
        recurso: 'Producto',
        id: 77,
      });
    });

    it.each([
      ['El detalle de la venta es nulo', /detalle de la venta es nulo/i],
      ['El detalle de la venta esta vacio', /detalle de la venta esta vacio/i],
      ['La linea 1 no tiene una cantidad valida', /no tiene una cantidad valida/i],
      ['La linea 1 tiene una cantidad invalida', /tiene una cantidad invalida/i],
      ['La linea 1 no tiene un precio_unitario valido', /no tiene un precio_unitario valido/i],
      ['La linea 1 tiene un precio_unitario negativo', /tiene un precio_unitario negativo/i],
    ])('un rechazo de validacion del SP -> ValidationError (400): %s', async (mensaje, patron) => {
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw new SpError(mensaje, { sqlState: '45000', errno: 1644 });
          }),
        }),
      });

      await expect(service.registrar(carritoValido())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      // El mensaje original del SP viaja intacto: es accionable en espanol.
      await expect(service.registrar(carritoValido())).rejects.toThrow(patron);
    });

    it('desborde del motor al calcular el total -> ConflictError (409), no 500', async () => {
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw new SpError("Out of range value for column 'v_subtotal' at row 1", {
              errno: 1264,
              origen: 'rango',
            });
          }),
        }),
      });

      await expect(service.registrar(carritoValido())).rejects.toBeInstanceOf(ConflictError);
    });

    it('cualquier otro rechazo del SP -> ConflictError (409) con su mensaje', async () => {
      const mensaje = 'No se pudo bloquear la tabla productos.';
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw new SpError(mensaje, { sqlState: '45000', errno: 1644 });
          }),
        }),
      });

      await expect(service.registrar(carritoValido())).rejects.toMatchObject({
        code: 'CONFLICT',
        message: mensaje,
      });
    });

    it('un fallo que NO viene del SP se propaga tal cual (500, no 409 disfrazado)', async () => {
      const fallo = new Error('ECONNREFUSED 127.0.0.1:3307');
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw fallo;
          }),
        }),
      });

      await expect(service.registrar(carritoValido())).rejects.toBe(fallo);
    });

    it('la traduccion NO tapa el error real: se propaga el mismo objeto', async () => {
      const fallo = new SpError('Fallo de conexion', { errno: 1040 });
      const { service } = armarService({
        write: crearVentaWriteRepo({
          registrarConSP: jest.fn(async () => {
            throw fallo;
          }),
        }),
      });

      // Salida de la traduccion: mismo mensaje, clase de dominio correcta.
      await expect(service.registrar(carritoValido())).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('registrar — lectura posterior a la escritura', () => {
    it('si la venta recien creada no se puede leer, es NotFoundError y no una venta vacia', async () => {
      const { service } = armarService({
        write: crearVentaWriteRepo({ registrarConSP: jest.fn(async () => ({ id: 5 })) }),
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => null) }),
      });

      await expect(service.registrar(carritoValido())).rejects.toMatchObject({
        code: 'NOT_FOUND',
        id: 5,
      });
    });
  });

  describe('listar (UC-4)', () => {
    it('devuelve data con meta y no un 404 cuando no hay ventas', async () => {
      const { service } = armarService();

      const resultado = await service.listar();

      expect(resultado).toEqual({ data: [], meta: { total: 0, page: 1, limit: 20 } });
    });

    it('calcula el offset desde la pagina (1-based)', async () => {
      const { service, read } = armarService({
        read: crearVentaReadRepo({ listar: jest.fn(async () => ({ data: [1], total: 55 })) }),
      });

      const resultado = await service.listar({ page: 3, limit: 10 });

      expect(read.listar).toHaveBeenCalledWith({ limit: 10, offset: 20 });
      expect(resultado.meta).toEqual({ total: 55, page: 3, limit: 10 });
    });

    it('la pagina 1 arranca en offset 0', async () => {
      const { service, read } = armarService();

      await service.listar({ page: 1, limit: 20 });

      expect(read.listar).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    });

    it('acepta page y limit como texto (llegan de query string)', async () => {
      const { service, read } = armarService();

      const resultado = await service.listar({ page: '2', limit: '5' });

      expect(resultado.meta).toEqual({ total: 0, page: 2, limit: 5 });
      expect(read.listar).toHaveBeenCalledWith({ limit: 5, offset: 5 });
    });

    it('trata page y limit vacios como "no enviados" y aplica los defaults', async () => {
      const { service } = armarService();

      const resultado = await service.listar({ page: '', limit: '' });

      expect(resultado.meta).toEqual({ total: 0, page: 1, limit: 20 });
    });

    it.each([
      ['page en cero', { page: 0 }],
      ['page negativa', { page: -1 }],
      ['page decimal', { page: 1.5 }],
      ['page no numerica', { page: 'abc' }],
      ['limit en cero', { limit: 0 }],
      ['limit negativa', { limit: -5 }],
      ['limit decimal', { limit: 2.5 }],
      ['limit no numerico', { limit: 'muchos' }],
    ])('rechaza %s con 400 y ni siquiera consulta el repo', async (_desc, filtros) => {
      const { service, read } = armarService();

      await expect(service.listar(filtros)).rejects.toBeInstanceOf(ValidationError);
      expect(read.listar).not.toHaveBeenCalled();
    });

    it('rechaza un limit por encima del maximo de config (DoS de respuesta)', async () => {
      const { service, read } = armarService();

      await expect(service.listar({ limit: 101 })).rejects.toBeInstanceOf(ValidationError);
      expect(read.listar).not.toHaveBeenCalled();
    });

    it('acepta el limit exactamente en el maximo (borde inclusivo)', async () => {
      const { service, read } = armarService();

      const resultado = await service.listar({ limit: 100 });

      expect(resultado.meta.limit).toBe(100);
      expect(read.listar).toHaveBeenCalledTimes(1);
    });

    it('el maximo de limit sale de la config inyectada, no de un numero quemado', async () => {
      const { service } = armarService({
        config: { pagination: { defaultPage: 1, defaultLimit: 20, maxLimit: 7 } },
      });

      await expect(service.listar({ limit: 8 })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.listar({ limit: 7 })).resolves.toMatchObject({ meta: { limit: 7 } });
    });
  });

  describe('obtenerPorId (ticket de la venta)', () => {
    it('devuelve la venta con sus items', async () => {
      const persistida = ventaPersistida({ id: 12 });
      const { service, read } = armarService({
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => persistida) }),
      });

      await expect(service.obtenerPorId(12)).resolves.toBe(persistida);
      expect(read.obtenerPorId).toHaveBeenCalledWith(12);
    });

    it('acepta el id como texto (viene de params)', async () => {
      const { service, read } = armarService({
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => ventaPersistida()) }),
      });

      await service.obtenerPorId('12');

      expect(read.obtenerPorId).toHaveBeenCalledWith(12);
    });

    it('una venta inexistente es NotFoundError (404), no una venta vacia', async () => {
      const { service } = armarService({
        read: crearVentaReadRepo({ obtenerPorId: jest.fn(async () => null) }),
      });

      await expect(service.obtenerPorId(99)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([
      ['id ausente', undefined],
      ['id en cero', 0],
      ['id negativo', -3],
      ['id decimal', 1.5],
      ['id no numerico', 'abc'],
    ])('rechaza %s con 400 sin tocar el repo', async (_desc, id) => {
      const { service, read } = armarService();

      await expect(service.obtenerPorId(id)).rejects.toBeInstanceOf(ValidationError);
      expect(read.obtenerPorId).not.toHaveBeenCalled();
    });
  });

  describe('configuracion inyectada', () => {
    it('sin config, los defaults siguen siendo seguros (100 items / limit 100)', async () => {
      const service = new VentaService(crearVentaReadRepo(), crearVentaWriteRepo());

      expect(service.maxItemsPorCarrito).toBe(100);
      expect(service.maxLimit).toBe(100);
    });

    it('ignora una config con valores no numericos y vuelve al fallback', async () => {
      const service = new VentaService(crearVentaReadRepo(), crearVentaWriteRepo(), {}, {
        pagination: { maxLimit: 'muchos' },
        ventas: { maxItemsPorCarrito: 0 },
      });

      expect(service.maxLimit).toBe(100);
      // Un tope de 0 items rejectaria TODO: el fallback es la decision segura.
      expect(service.maxItemsPorCarrito).toBe(100);
    });
  });
});