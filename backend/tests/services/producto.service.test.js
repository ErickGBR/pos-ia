'use strict';

/**
 * SUITE — ProductoService (casos de uso de productos)
 * backend/tests/services/producto.service.test.js
 *
 * Cubre el service REAL con repos FALSOS: sin MySQL, sin Docker, sin puerto.
 * Verifica las reglas de negocio de UC-1 (listar/buscar) y UC-2 (crear,
 * actualizar, eliminar), con foco en tres cosas que son las que un POS no puede
 * romper:
 *
 *   1. `codigo_barras` es identidad estable: obligatorio al crear, UNICO, y
 *      NUNCA actualizable aunque el cliente lo mande en el PUT (D4).
 *   2. La baja fisica esta CONDICIONADA: con historial de ventas se corta con
 *      409 y no se borra nada (D4 / R5).
 *   3. `precio > 0` y el id tiene que ser un entero positivo.
 */

const ProductoService = require('../../src/services/producto.service');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../../src/errors/domain-errors');
const {
  CONFIG_DE_PRUEBA,
  crearProductoReadRepo,
  crearProductoWriteRepo,
} = require('../helpers/fakes');

/** Producto que el write repo devuelve cuando el create/update tienen exito. */
const PRODUCTO_CREADO = {
  id: 1,
  nombre: 'Cafe',
  precio: 2.5,
  codigo_barras: '7501234567890',
};

/**
 * @param {Object} [opciones]
 * @param {Object} [opciones.read]
 * @param {Object} [opciones.write]
 * @param {Object} [opciones.config]
 */
function armarService(opciones = {}) {
  const read = opciones.read || crearProductoReadRepo();
  const write = opciones.write || crearProductoWriteRepo();

  const service = new ProductoService(read, write, opciones.config || CONFIG_DE_PRUEBA);

  return { service, read, write };
}

/** DTO de alta valido, para romper un solo campo por vez. */
function dtoValido(campos = {}) {
  return { nombre: 'Cafe', precio: 2.5, codigo_barras: '7501234567890', ...campos };
}

describe('ProductoService', () => {
  describe('listar (UC-1)', () => {
    it('devuelve data con meta; una lista vacia NO es 404', async () => {
      const { service } = armarService();

      await expect(service.listar()).resolves.toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('pasa el filtro `q` al repo con los espacios recortados', async () => {
      const { service, read } = armarService({
        read: crearProductoReadRepo({ listar: jest.fn(async () => ({ data: [PRODUCTO_CREADO], total: 1 })) }),
      });

      const resultado = await service.listar({ q: '  cafe  ' });

      expect(read.listar).toHaveBeenCalledWith({ q: 'cafe', limit: 20, offset: 0 });
      expect(resultado.data).toEqual([PRODUCTO_CREADO]);
      expect(resultado.meta.total).toBe(1);
    });

    it('sin `q`, busca vacio y lista todo', async () => {
      const { service, read } = armarService();

      await service.listar({});

      expect(read.listar).toHaveBeenCalledWith({ q: '', limit: 20, offset: 0 });
    });

    it('un `q` no textual se trata como vacio, no como error', async () => {
      const { service, read } = armarService();

      await service.listar({ q: 42 });

      expect(read.listar).toHaveBeenCalledWith({ q: '', limit: 20, offset: 0 });
    });

    it('calcula el offset desde la pagina 1-based', async () => {
      const { service, read } = armarService();

      const resultado = await service.listar({ page: 4, limit: 10 });

      expect(read.listar).toHaveBeenCalledWith({ q: '', limit: 10, offset: 30 });
      expect(resultado.meta).toEqual({ total: 0, page: 4, limit: 10 });
    });

    it('acepta page y limit como texto y trata los vacios como ausentes', async () => {
      const { service } = armarService();

      await expect(service.listar({ page: '2', limit: '5' }))
        .resolves.toMatchObject({ meta: { page: 2, limit: 5 } });
      await expect(service.listar({ page: '', limit: '' }))
        .resolves.toMatchObject({ meta: { page: 1, limit: 20 } });
    });

    it.each([
      ['page en cero', { page: 0 }],
      ['page decimal', { page: 0.5 }],
      ['page no numerica', { page: 'x' }],
      ['limit en cero', { limit: 0 }],
      ['limit negativa', { limit: -1 }],
      ['limit no numerico', { limit: 'x' }],
      ['limit sobre el maximo', { limit: 500 }],
    ])('rechaza %s con 400 sin consultar el repo', async (_desc, filtros) => {
      const { service, read } = armarService();

      await expect(service.listar(filtros)).rejects.toBeInstanceOf(ValidationError);
      expect(read.listar).not.toHaveBeenCalled();
    });

    it('el maximo de limit viene de la config inyectada', async () => {
      const { service } = armarService({
        config: { pagination: { defaultPage: 1, defaultLimit: 20, maxLimit: 5 } },
      });

      await expect(service.listar({ limit: 6 })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.listar({ limit: 5 })).resolves.toMatchObject({ meta: { limit: 5 } });
    });
  });

  describe('crear (UC-2)', () => {
    it('crea con nombre y codigo de barras normalizados (trim) y precio numerico', async () => {
      const { service, write } = armarService({
        write: crearProductoWriteRepo({ crear: jest.fn(async () => PRODUCTO_CREADO) }),
      });

      const creado = await service.crear(
        dtoValido({ nombre: '  Cafemolido  ', precio: '3,50', codigo_barras: '  7501234567890  ' }),
      );

      // El codigo de barras se busca ya recortado: buscarlo con espacios daria
      // "libre" un codigo que en la base no existe (doble alta).
      expect(write.crear).toHaveBeenCalledWith({
        nombre: 'Cafemolido',
        precio: 3.5,
        codigo_barras: '7501234567890',
      });
      expect(creado).toBe(PRODUCTO_CREADO);
    });

    it('un codigo de barras ya existente se corta con 409 ANTES de escribir', async () => {
      const { service, write } = armarService({
        read: crearProductoReadRepo({
          buscarPorCodigoBarras: jest.fn(async () => PRODUCTO_CREADO),
        }),
      });

      await expect(service.crear(dtoValido())).rejects.toBeInstanceOf(ConflictError);
      // El 409 de negocio no es "no escribir nunca": es no escribir cuando YA
      // sabemos que va a fallar. El indice UNIQUE sigue siendo la garantia real.
      expect(write.crear).not.toHaveBeenCalled();
    });

    it('el 409 de duplicado trae el detalle del campo para el cliente', async () => {
      const { service } = armarService({
        read: crearProductoReadRepo({
          buscarPorCodigoBarras: jest.fn(async () => PRODUCTO_CREADO),
        }),
      });

      await expect(service.crear(dtoValido())).rejects.toMatchObject({
        code: 'CONFLICT',
        detalles: { campo: 'codigo_barras' },
      });
    });

    it.each([
      ['nombre ausente', { nombre: undefined }],
      ['nombre en null', { nombre: null }],
      ['nombre en blanco', { nombre: '   ' }],
      ['nombre numerico', { nombre: 42 }],
      ['nombre de 256 caracteres', { nombre: 'a'.repeat(256) }],
      ['precio ausente', { precio: undefined }],
      ['precio en cero', { precio: 0 }],
      ['precio negativo', { precio: -1 }],
      ['precio no numerico', { precio: 'barato' }],
      ['precio sobre el DECIMAL(10,2)', { precio: 100000000 }],
      ['codigo de barras ausente', { codigo_barras: undefined }],
      ['codigo de barras en blanco', { codigo_barras: '  ' }],
      ['codigo de barras no textual', { codigo_barras: 7501234567890 }],
    ])('rechaza con 400: %s', async (_desc, campos) => {
      const { service, write } = armarService();

      await expect(service.crear(dtoValido(campos))).rejects.toBeInstanceOf(ValidationError);
      expect(write.crear).not.toHaveBeenCalled();
    });

    it('rechaza un cuerpo que no es un objeto', async () => {
      const { service } = armarService();

      await expect(service.crear('no soy un dto')).rejects.toBeInstanceOf(ValidationError);
      await expect(service.crear(null)).rejects.toBeInstanceOf(ValidationError);
    });

    it('acepta el precio minimo valido (el smallest mayor que 0)', async () => {
      const { service, write } = armarService({
        write: crearProductoWriteRepo({ crear: jest.fn(async () => PRODUCTO_CREADO) }),
      });

      await service.crear(dtoValido({ precio: 0.01 }));

      expect(write.crear).toHaveBeenCalledWith(expect.objectContaining({ precio: 0.01 }));
    });
  });

  describe('actualizar (UC-2)', () => {
    it('actualiza solo los campos enviados', async () => {
      const { service, write } = armarService({
        write: crearProductoWriteRepo({
          actualizar: jest.fn(async (id, patch) => ({ ...PRODUCTO_CREADO, ...patch, id })),
        }),
      });

      await service.actualizar(1, { nombre: '  Te  ' });

      expect(write.actualizar).toHaveBeenCalledWith(1, { nombre: 'Te' });
    });

    it('IGNORA codigo_barras aunque venga en el body (D4: identidad estable)', async () => {
      const { service, write } = armarService();

      await service.actualizar(1, { nombre: 'Te', precio: 5, codigo_barras: '9999999999999' });

      expect(write.actualizar).toHaveBeenCalledWith(1, { nombre: 'Te', precio: 5 });
      // El campo no existe en el patch: no puede llegar a la sentencia SQL ni
      // aunque el cliente lo mande explicitamente.
      expect(write.actualizar.mock.calls[0][1]).not.toHaveProperty('codigo_barras');
    });

    it('cambiar solo codigo_barras NO alcanza: el patch queda vacio y es 400', async () => {
      const { service, write } = armarService();

      await expect(service.actualizar(1, { codigo_barras: '9999999999999' }))
        .rejects.toBeInstanceOf(ValidationError);
      expect(write.actualizar).not.toHaveBeenCalled();
    });

    it('rechaza un body vacio', async () => {
      const { service } = armarService();

      await expect(service.actualizar(1, {})).rejects.toBeInstanceOf(ValidationError);
    });

    it('valida nombre y precio con las mismas reglas del alta', async () => {
      const { service, write } = armarService();

      await expect(service.actualizar(1, { nombre: '  ' })).rejects.toBeInstanceOf(ValidationError);
      await expect(service.actualizar(1, { precio: 0 })).rejects.toBeInstanceOf(ValidationError);
      expect(write.actualizar).not.toHaveBeenCalled();
    });

    it('un id que el write repo no encuentra es NotFoundError (404)', async () => {
      const { service } = armarService({
        write: crearProductoWriteRepo({ actualizar: jest.fn(async () => null) }),
      });

      await expect(service.actualizar(404, { precio: 5 })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('un fallo de base al actualizar NO se disfraza de 404', async () => {
      const fallo = new Error('ETIMEDOUT');
      const { service, write } = armarService({
        write: crearProductoWriteRepo({
          actualizar: jest.fn(async () => {
            throw fallo;
          }),
        }),
      });

      // El 404 se decide SOLO cuando el repo responde `null` (no habia fila). Un
      // error de infraestructura se propaga y termina en 500: mentir con un 404
      // haria creer al cliente que su producto no existe.
      await expect(service.actualizar(9, { precio: 5 })).rejects.toBe(fallo);
      expect(write.actualizar).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['id ausente', undefined],
      ['id en cero', 0],
      ['id negativo', -1],
      ['id decimal', 2.5],
      ['id no numerico', 'abc'],
    ])('rechaza %s con 400 antes de escribir', async (_desc, id) => {
      const { service, write } = armarService();

      await expect(service.actualizar(id, { precio: 5 })).rejects.toBeInstanceOf(ValidationError);
      expect(write.actualizar).not.toHaveBeenCalled();
    });

    it('acepta el id como texto (viene de params)', async () => {
      const { service, write } = armarService({
        write: crearProductoWriteRepo({ actualizar: jest.fn(async (id, patch) => ({ id, ...patch })) }),
      });

      await service.actualizar('3', { precio: 5 });

      expect(write.actualizar).toHaveBeenCalledWith(3, { precio: 5 });
    });
  });

  describe('eliminar (UC-2, baja fisica CONDICIONADA)', () => {
    it('borra cuando el producto existe y no tiene historial de ventas', async () => {
      const { service, write } = armarService({
        read: crearProductoReadRepo({ buscarPorId: jest.fn(async () => PRODUCTO_CREADO) }),
        write: crearProductoWriteRepo({ contarVentasAsociadas: jest.fn(async () => 0) }),
      });

      await expect(service.eliminar(1)).resolves.toEqual({ id: 1, eliminado: true });
      expect(write.eliminar).toHaveBeenCalledWith(1);
    });

    it('CON historial de ventas: 409 y NUNCA se borra (D4 / R5)', async () => {
      const { service, write } = armarService({
        read: crearProductoReadRepo({ buscarPorId: jest.fn(async () => PRODUCTO_CREADO) }),
        write: crearProductoWriteRepo({ contarVentasAsociadas: jest.fn(async () => 3) }),
      });

      await expect(service.eliminar(1)).rejects.toBeInstanceOf(ConflictError);
      expect(write.eliminar).not.toHaveBeenCalled();
    });

    it('el 409 por historial dice cuantas ventas bloquean la baja', async () => {
      const { service } = armarService({
        read: crearProductoReadRepo({ buscarPorId: jest.fn(async () => PRODUCTO_CREADO) }),
        write: crearProductoWriteRepo({ contarVentasAsociadas: jest.fn(async () => 7) }),
      });

      await expect(service.eliminar(1)).rejects.toMatchObject({
        code: 'CONFLICT',
        detalles: { id: 1, ventas: 7 },
      });
    });

    it('un producto inexistente es 404 y ni siquiera se cuenta el historial', async () => {
      const { service, write } = armarService({
        read: crearProductoReadRepo({ buscarPorId: jest.fn(async () => null) }),
      });

      await expect(service.eliminar(404)).rejects.toBeInstanceOf(NotFoundError);
      expect(write.contarVentasAsociadas).not.toHaveBeenCalled();
      expect(write.eliminar).not.toHaveBeenCalled();
    });

    it('si el conteo de historial falla, el error propaga y NO hay borrado a ciegas', async () => {
      const fallo = new Error('no such table: venta_detalle');
      const { service, write } = armarService({
        read: crearProductoReadRepo({ buscarPorId: jest.fn(async () => PRODUCTO_CREADO) }),
        write: crearProductoWriteRepo({
          contarVentasAsociadas: jest.fn(async () => {
            throw fallo;
          }),
        }),
      });

      // FAIL-CLOSED: un conteo que no pudo hacerse NUNCA se degrada a 0, porque
      // "0" significaria "no tiene historial" y abriria la puerta al destroy().
      await expect(service.eliminar(1)).rejects.toBe(fallo);
      expect(write.eliminar).not.toHaveBeenCalled();
    });

    it.each([
      ['id ausente', undefined],
      ['id en cero', 0],
      ['id negativo', -2],
      ['id no numerico', 'abc'],
    ])('rechaza %s con 400 sin consultar nada', async (_desc, id) => {
      const { service, read, write } = armarService();

      await expect(service.eliminar(id)).rejects.toBeInstanceOf(ValidationError);
      expect(read.buscarPorId).not.toHaveBeenCalled();
      expect(write.eliminar).not.toHaveBeenCalled();
    });
  });

  describe('configuracion inyectada', () => {
    it('sin config, el techo de limit es 100', () => {
      const service = new ProductoService(crearProductoReadRepo(), crearProductoWriteRepo());

      expect(service.maxLimit).toBe(100);
    });

    it('una config con maxLimit no numerico cae al fallback, no a 0', () => {
      const service = new ProductoService(crearProductoReadRepo(), crearProductoWriteRepo(), {
        pagination: { maxLimit: 'ilimitado' },
      });

      expect(service.maxLimit).toBe(100);
    });
  });
});