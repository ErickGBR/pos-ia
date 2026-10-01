'use strict';

/**
 * SUITE — ProductoController (traduccion HTTP, sin abrir un socket)
 * backend/tests/controllers/producto.controller.test.js
 *
 * Mismo criterio que la suite del controller de ventas: el controller solo elige
 * status y cuerpo, asi que se prueba con un service FALSO y un `res` minimo
 * (`tests/helpers/fakes.js`), sin Express ni supertest.
 *
 * El punto donde este controller SÍ tiene una decision propia —y por eso se
 * prueba— es `actualizar`: solo manda `nombre` y `precio` al service y deja
 * fuera `codigo_barras`, que es identidad estable (D4). Si el campo llegara al
 * service, la capa de negocio tendria que defenderse de el.
 */

const ProductoController = require('../../src/controllers/producto.controller');
const { NotFoundError, ConflictError, ValidationError } = require('../../src/errors/domain-errors');
const { reqFalso, resFalso } = require('../helpers/fakes');

const PRODUCTO = { id: 1, nombre: 'Cafe', precio: 2.5, codigo_barras: '7501234567890' };

/** Controller sobre un service falso que responde lo que le pidan. */
function armarController(sobrescrituras = {}) {
  const servicio = {
    listar: jest.fn(async () => ({ data: [PRODUCTO], meta: { total: 1, page: 1, limit: 20 } })),
    crear: jest.fn(async () => PRODUCTO),
    actualizar: jest.fn(async () => PRODUCTO),
    eliminar: jest.fn(async () => ({ id: 1, eliminado: true })),
    ...sobrescrituras,
  };

  return { controller: new ProductoController(servicio), servicio };
}

describe('ProductoController', () => {
  describe('listar — GET /api/productos', () => {
    it('responde 200 con data y meta', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.listar(reqFalso({ queryValidado: { page: 1, limit: 20 } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo).toEqual({ data: [PRODUCTO], meta: { total: 1, page: 1, limit: 20 } });
    });

    it('pasa q, page y limit del query validado', async () => {
      const { controller, servicio } = armarController();

      await controller.listar(reqFalso({ queryValidado: { q: 'cafe', page: 2, limit: 5 } }), resFalso());

      expect(servicio.listar).toHaveBeenCalledWith({ q: 'cafe', page: 2, limit: 5 });
    });

    it('no lee `req.query` crudo (el middleware ya lo normalizo)', async () => {
      const { controller, servicio } = armarController();

      await controller.listar(
        reqFalso({ query: { q: 'x', page: '999' }, queryValidado: { page: 1, limit: 20 } }),
        resFalso(),
      );

      expect(servicio.listar).toHaveBeenCalledWith({ q: undefined, page: 1, limit: 20 });
    });
  });

  describe('crear — POST /api/productos', () => {
    it('responde 201 con el producto creado', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.crear(
        reqFalso({ bodyValidado: { nombre: 'Cafe', precio: 2.5, codigo_barras: '7501234567890' } }),
        res,
      );

      expect(res.statusCode).toBe(201);
      expect(res.cuerpo).toBe(PRODUCTO);
    });

    it('manda al service solo los tres campos del alta', async () => {
      const { controller, servicio } = armarController();

      await controller.crear(
        reqFalso({ bodyValidado: { nombre: 'Cafe', precio: 2.5, codigo_barras: '7501234567890', extra: 'ignorado' } }),
        resFalso(),
      );

      expect(servicio.crear).toHaveBeenCalledWith({
        nombre: 'Cafe',
        precio: 2.5,
        codigo_barras: '7501234567890',
      });
    });

    it('un 409 por codigo duplicado sube sin capturarse', async () => {
      const { controller } = armarController({
        crear: jest.fn(async () => {
          throw new ConflictError('Ya existe un producto con ese codigo de barras.', {
            campo: 'codigo_barras',
          });
        }),
      });

      await expect(
        controller.crear(reqFalso({ bodyValidado: { nombre: 'Cafe', precio: 2.5, codigo_barras: 'x' } }), resFalso()),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('actualizar — PUT /api/productos/:id', () => {
    it('responde 200 con el producto actualizado', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.actualizar(
        reqFalso({ params: { id: '1' }, bodyValidado: { nombre: 'Te', precio: 5 } }),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo).toBe(PRODUCTO);
    });

    it('NUNCA propaga codigo_barras al service (identidad estable, D4)', async () => {
      const { controller, servicio } = armarController();

      await controller.actualizar(
        reqFalso({
          params: { id: '1' },
          // El cliente manda el campo; el controller lo descarta antes de que
          // llegue a la capa de negocio.
          bodyValidado: { nombre: 'Te', precio: 5, codigo_barras: '9999999999999' },
        }),
        resFalso(),
      );

      expect(servicio.actualizar).toHaveBeenCalledWith('1', { nombre: 'Te', precio: 5 });
      expect(servicio.actualizar.mock.calls[0][1]).not.toHaveProperty('codigo_barras');
    });

    it('toma el id de params, que sigue siendo texto en Express', async () => {
      const { controller, servicio } = armarController();

      await controller.actualizar(reqFalso({ params: { id: '7' }, bodyValidado: { precio: 5 } }), resFalso());

      // El controller no castea el id: el service valida que sea entero positivo.
      expect(servicio.actualizar).toHaveBeenCalledWith('7', { precio: 5 });
    });

    it('un 404 sube sin capturarse', async () => {
      const { controller } = armarController({
        actualizar: jest.fn(async () => {
          throw new NotFoundError('Producto', 7);
        }),
      });

      await expect(
        controller.actualizar(reqFalso({ params: { id: '7' }, bodyValidado: { precio: 5 } }), resFalso()),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('eliminar — DELETE /api/productos/:id', () => {
    it('responde 200 con el confirmado de baja', async () => {
      const { controller } = armarController();
      const res = resFalso();

      await controller.eliminar(reqFalso({ params: { id: '1' } }), res);

      expect(res.statusCode).toBe(200);
      expect(res.cuerpo).toEqual({ id: 1, eliminado: true });
    });

    it('un 409 por historial de ventas sube sin capturarse y no responde 200', async () => {
      const { controller } = armarController({
        eliminar: jest.fn(async () => {
          throw new ConflictError('No se puede eliminar: el producto tiene historial de ventas asociado.');
        }),
      });
      const res = resFalso();

      await expect(controller.eliminar(reqFalso({ params: { id: '1' } }), res))
        .rejects.toBeInstanceOf(ConflictError);

      // Si el controller respondiera 200 antes de dejar propagar el error, el
      // mostrador creeria que borro un producto que sigue con ventas.
      expect(res.respondio).toBe(false);
    });

    it('un 400 de validacion sube sin capturarse', async () => {
      const { controller } = armarController({
        eliminar: jest.fn(async () => {
          throw new ValidationError('El id del producto debe ser un numero entero positivo.');
        }),
      });

      await expect(controller.eliminar(reqFalso({ params: { id: 'abc' } }), resFalso()))
        .rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('frontera de la capa', () => {
    it('el controller no elige codigos de error: propaga y no responde', async () => {
      const { controller } = armarController({
        listar: jest.fn(async () => {
          throw new Error('ETIMEDOUT');
        }),
      });
      const res = resFalso();

      await expect(controller.listar(reqFalso({ queryValidado: { page: 1, limit: 20 } }), res))
        .rejects.toThrow('ETIMEDOUT');

      expect(res.respondio).toBe(false);
    });

    it('recibe el service por constructor y lo expone como `servicio`', () => {
      const { controller, servicio } = armarController();

      expect(controller.servicio).toBe(servicio);
    });

    it('los handlers son arrow functions: se pueden pasar sueltos al router', () => {
      const { controller } = armarController();
      const { listar, crear, actualizar, eliminar } = controller;

      // Los handlers se referencian como `router.get('/', listar)`. Al estar
      // definidos como campos de clase, son PROPIEDADES DE LA INSTANCIA (no del
      // prototipo): por eso ya vienen ligados a `this` y funcionan sueltos.
      expect(typeof listar).toBe('function');
      expect(typeof crear).toBe('function');
      expect(typeof actualizar).toBe('function');
      expect(typeof eliminar).toBe('function');
      expect(Object.prototype.hasOwnProperty.call(controller, 'listar')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(controller), 'listar')).toBe(false);
    });

    it('un handler separado de la instancia sigue funcionando (this ligado)', async () => {
      const { controller, servicio } = armarController();
      const { listar } = controller;
      const res = resFalso();

      await listar(reqFalso({ queryValidado: { page: 1, limit: 20 } }), res);

      expect(res.statusCode).toBe(200);
      expect(servicio.listar).toHaveBeenCalledTimes(1);
    });
  });
});