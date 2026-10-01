'use strict';

/**
 * SUITE — VentaController (traduccion HTTP, sin abrir un socket)
 * backend/tests/controllers/venta.controller.test.js
 *
 * Los controllers son la UNICA capa que toca `req`/`res`, y lo unico que deciden
 * es el STATUS y el CUERPO de la respuesta: toda regla de negocio ya esta
 * resuelta en el service. Por eso se prueban con un service FALSO y un `res`
 * minimo (`tests/helpers/fakes.js`), sin supertest y sin Express conectado: si
 * el controllerinxigiera de que Express este montado, la prueba estaria probando
 * el framework, no el controller.
 *
 * Lo que se verifica:
 *   - cada caso de uso responde el status del contrato (201 / 200),
 *   - el controller NO elige reglas de negocio ni captura errores: lo que el
 *     service lanza sube tal cual para que `errorHandler` lo mapee,
 *   - el controller no inventa ni reordena datos: devuelve el objeto del service.
 */

const VentaController = require('../../src/controllers/venta.controller');
const { NotFoundError, ValidationError } = require('../../src/errors/domain-errors');
const {
  crearVentaReadRepo,
  crearVentaWriteRepo,
  carritoValido,
  ventaPersistida,
  reqFalso,
  resFalso,
} = require('../helpers/fakes');
const VentaService = require('../../src/services/venta.service');
const { VentaNormalStrategy } = require('../../src/services/venta-strategies');

const STRATEGIES = { normal: new VentaNormalStrategy() };
const CONFIG = { pagination: { defaultPage: 1, defaultLimit: 20, maxLimit: 100 }, ventas: { maxItemsPorCarrito: 100 } };

/** Service real sobre repos falsos: el controller se prueba con logica real. */
function armarController(sobrescrituras = {}) {
  const read = sobrescrituras.read || crearVentaReadRepo({
    obtenerPorId: jest.fn(async () => ventaPersistida()),
  });
  const write = sobrescrituras.write || crearVentaWriteRepo();
  const servicio = new VentaService(read, write, STRATEGIES, CONFIG);

  return { controller: new VentaController(servicio), servicio, read, write };
}

describe('VentaController', () => {
  describe('registrar — POST /api/ventas', () => {
    it('responde 201 con la venta persistida', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.registrar(
        reqFalso({ bodyValidado: { items: carritoValido() }, method: 'POST' }),
        res,
      );

      expect(res.statusCode).toBe(201);
      expect(res.respondio).toBe(true);
      expect(res.cuerpo).toMatchObject({ id: 1, items: expect.any(Array) });
    });

    it('manda al service el carrito ya normalizado por el middleware de forma', async () => {
      const espia = { registrar: jest.fn(async () => ventaPersistida()) };
      const controller = new VentaController(espia);
      const items = carritoValido();

      await controller.registrar(reqFalso({ bodyValidado: { items } }), resFalso());

      // El controller NO revalida ni transforma: pasa el body al service tal cual.
      // `bodyValidado` es la salida de `middlewares/validate.js`.
      expect(espia.registrar).toHaveBeenCalledWith(items, undefined);
    });

    it('propaga el tipo de movimiento cuando el cliente lo manda', async () => {
      const espia = { registrar: jest.fn(async () => ventaPersistida()) };
      const controller = new VentaController(espia);

      await controller.registrar(reqFalso({ bodyValidado: { items: carritoValido(), tipo: 'normal' } }), resFalso());

      expect(espia.registrar).toHaveBeenCalledWith(expect.any(Array), 'normal');
    });

    it('el 404 del service sube sin que el controller lo capture', async () => {
      const espia = {
        registrar: jest.fn(async () => {
          throw new NotFoundError('Producto', 77);
        }),
      };
      const controller = new VentaController(espia);

      // El controller NO elige codigos de error: si atrapara el error y eligiera
      // un status, tendria dos mapas de error en el proyecto y divergirian.
      await expect(controller.registrar(reqFalso({ bodyValidado: { items: carritoValido() } }), resFalso()))
        .rejects.toBeInstanceOf(NotFoundError);
    });

    it('un 400 del service tambien sube sin capturarse', async () => {
      const espia = {
        registrar: jest.fn(async () => {
          throw new ValidationError('carrito vacio');
        }),
      };
      const controller = new VentaController(espia);

      await expect(controller.registrar(reqFalso({ bodyValidado: { items: [] } }), resFalso()))
        .rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('listar — GET /api/ventas', () => {
    it('responde 200 con data y meta', async () => {
      const espia = { listar: jest.fn(async () => ({ data: [ventaPersistida()], meta: { total: 1, page: 1, limit: 20 } })) };
      const controller = new VentaController(espia);
      const res = resFalso();

      await controller.listar(reqFalso({ queryValidado: { page: 1, limit: 20 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo.meta).toEqual({ total: 1, page: 1, limit: 20 });
    });

    it('pasa page y limit ya parseados desde el middleware de forma', async () => {
      const espia = { listar: jest.fn(async () => ({ data: [], meta: {} })) };
      const controller = new VentaController(espia);

      await controller.listar(reqFalso({ queryValidado: { page: 2, limit: 5 } }), resFalso());

      expect(espia.listar).toHaveBeenCalledWith({ page: 2, limit: 5 });
    });

    it('una lista vacia responde 200 con data vacia, no 404', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.listar(reqFalso({ queryValidado: { page: 1, limit: 20 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo.data).toEqual([]);
    });

    it('ignora el query crudo y usa el validado (evita leer `req.query` sin validar)', async () => {
      const espia = { listar: jest.fn(async () => ({ data: [], meta: {} })) };
      const controller = new VentaController(espia);

      await controller.listar(
        reqFalso({ query: { page: '999', limit: 'no-numero' }, queryValidado: { page: 1, limit: 20 } }),
        resFalso(),
      );

      expect(espia.listar).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });
  });

  describe('obtenerPorId — GET /api/ventas/:id', () => {
    it('responde 200 con el ticket', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.obtenerPorId(reqFalso({ paramsValidado: { id: 1 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo.items).toBeInstanceOf(Array);
    });

    it('usa el id de paramsValidado, no el texto crudo de params', async () => {
      const espia = { obtenerPorId: jest.fn(async () => ventaPersistida()) };
      const controller = new VentaController(espia);

      await controller.obtenerPorId(
        reqFalso({ params: { id: '1' }, paramsValidado: { id: 1 } }),
        resFalso(),
      );

      expect(espia.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('una venta inexistente: el 404 del service sube sin capturarse', async () => {
      const espia = {
        obtenerPorId: jest.fn(async () => {
          throw new NotFoundError('Venta', 999);
        }),
      };
      const controller = new VentaController(espia);
      const res = resFalso();

      await expect(controller.obtenerPorId(reqFalso({ paramsValidado: { id: 999 } }), res))
        .rejects.toBeInstanceOf(NotFoundError);

      // No escribio nada: sin una respuesta half-made.
      expect(res.respondio).toBe(false);
    });
  });

  describe('frontera de la capa', () => {
    it('no responde si el service lanza (no hay estado parcial)', async () => {
      const espia = {
        registrar: jest.fn(async () => {
          throw new Error('fallo de base');
        }),
      };
      const controller = new VentaController(espia);
      const res = resFalso();

      await expect(controller.registrar(reqFalso({ bodyValidado: { items: carritoValido() } }), res))
        .rejects.toThrow('fallo de base');

      expect(res.statusCode).toBeNull();
      expect(res.respondio).toBe(false);
    });

    it('los handlers son campos de clase: vienen ligados a `this`', () => {
      // Los handlers se referencian como `router.post('/', registrar)`. Al estar
      // definidos como campos de clase, son PROPIEDADES DE LA INSTANCIA (no del
      // prototipo): por eso no pierden `this.servicio` al separarse.
      const { controller } = armarController();

      expect(Object.prototype.hasOwnProperty.call(controller, 'registrar')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(controller), 'registrar')).toBe(false);
    });

    it('un handler separado de la instancia sigue funcionando (this ligado)', async () => {
      const { controller, read } = armarController();
      const { registrar } = controller;
      const res = resFalso();

      await registrar(reqFalso({ bodyValidado: { items: carritoValido() } }), res);

      expect(res.statusCode).toBe(201);
      expect(read.obtenerPorId).toHaveBeenCalledTimes(1);
    });
  });
});