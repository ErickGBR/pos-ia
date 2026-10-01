'use strict';

/**
 * SUITE — SequelizeVentaReadRepository (mapeo al contrato de UC-4)
 * backend/tests/repositories/sequelize-venta-read.repository.test.js
 *
 * El repositorio de lectura devuelve OBJETOS PLANOS, no instancias del ORM,
 * porque `JSON.stringify` no serializa bien los getters de los modelos y el
 * controller responde con `res.json()`. La funcion `ventaAPlano` es la Frontera
 * de datos del ticket: si proyecta mal, el cliente ve un ticket con el total
 * descuadrado respecto de sus lineas.
 *
 * Se prueban las dos entradas posibles —`listar` (con include) y `obtenerPorId`
 * (con include)— contra modelos FALSOS que devuelven filas con `toJSON()`, que es
 * justo la forma que produce Sequelize. Sin base y sin Docker.
 *
 * Lo que se fija aca (y no en la suite del service) es el detalle de la
 * proyeccion: conversion de DECIMAL a number, orden estable de las lineas y el
 * `LEFT JOIN` que nunca pierde una linea.
 */

const SequelizeVentaReadRepository = require('../../src/repositories/sequelize-venta-read.repository');
const VentaReadRepository = require('../../src/interfaces/venta-read.repository');

const { ventaAPlano } = SequelizeVentaReadRepository;

/** Fila del ORM con `toJSON()`, como las que devuelve Sequelize. */
function filaVenta(datos) {
  return { toJSON: () => datos };
}

/** Fila de `venta_detalle` con `toJSON()`, con el producto ya resuelto. */
function filaDetalle(datos) {
  return { toJSON: () => datos };
}

/** Cabecera con dos lineas, tal como la devuelve el include del repositorio. */
function cabeceraConDosLineas() {
  return filaVenta({
    id: 10,
    total: '225.50',
    createdAt: '2026-10-01 10:00:00',
    items: [
      filaDetalle({
        id: 1,
        producto_id: 1,
        cantidad: '2',
        precio_unitario: '100.00',
        subtotal: '200.00',
        producto: [{ nombre: 'Cafe' }],
      }),
      filaDetalle({
        id: 2,
        producto_id: 7,
        cantidad: '1',
        precio_unitario: '25.50',
        subtotal: '25.50',
        producto: [{ nombre: 'Medialunas' }],
      }),
    ],
  });
}

/** Modelos falsos: solo se usa `findAll`, `count` y `findByPk`. */
function modelosFalsos(cabeceras = [], total = 0) {
  return {
    ventas: {
      findAll: jest.fn(async () => cabeceras),
      count: jest.fn(async () => total),
      findByPk: jest.fn(async () => cabeceras[0] || null),
    },
    ventaDetalles: { name: 'VentaDetalle' },
    productos: { name: 'Producto' },
  };
}

describe('SequelizeVentaReadRepository', () => {
  describe('contrato de la interfaz', () => {
    it('implementa el contrato de lectura de ventas', () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos();

      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      expect(repo).toBeInstanceOf(VentaReadRepository);
    });

    it('NO expone ningun metodo de escritura (las ventas son de solo lectura)', () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos();
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      expect(repo.crear).toBeUndefined();
      expect(repo.actualizar).toBeUndefined();
      expect(repo.eliminar).toBeUndefined();
    });
  });

  describe('ventaAPlano — proyeccion al contrato', () => {
    it('proyecta cabecera y lineas al objeto plano del contrato', () => {
      const venta = ventaAPlano(cabeceraConDosLineas());

      expect(Object.keys(venta).sort()).toEqual(['createdAt', 'id', 'items', 'total']);
      expect(venta.id).toBe(10);
      expect(venta.items).toHaveLength(2);
      expect(venta.items[0]).toEqual({
        producto_id: 1,
        nombre: 'Cafe',
        cantidad: 2,
        precio_unitario: 100,
        subtotal: 200,
      });
    });

    it('convierte los DECIMAL del driver a number (el JSON no lleva "8.10")', () => {
      const venta = ventaAPlano(cabeceraConDosLineas());

      expect(venta.total).toBe(225.5);
      expect(typeof venta.total).toBe('number');
      expect(venta.items[1].precio_unitario).toBe(25.5);
      expect(venta.items[1].subtotal).toBe(25.5);
      // Un total en texto llegaria al cliente como string y romperia el calculo
      // del frontend al sumar lineas.
      expect(venta.items.every((item) => typeof item.subtotal === 'number')).toBe(true);
    });

    it('ordena las lineas por su id de detalle (lectura estable entre llamadas)', () => {
      // El include no garantiza orden. Dos lecturas de la misma venta deben salir
      // en el mismo orden, o el ticket "cambia" entre recargas sin que cambie nada.
      const desordenada = filaVenta({
        id: 10,
        total: '225.50',
        createdAt: '2026-10-01 10:00:00',
        items: [
          filaDetalle({ id: 3, producto_id: 3, cantidad: '1', precio_unitario: '1.00', subtotal: '1.00', producto: [{ nombre: 'C' }] }),
          filaDetalle({ id: 1, producto_id: 1, cantidad: '1', precio_unitario: '1.00', subtotal: '1.00', producto: [{ nombre: 'A' }] }),
          filaDetalle({ id: 2, producto_id: 2, cantidad: '1', precio_unitario: '1.00', subtotal: '1.00', producto: [{ nombre: 'B' }] }),
        ],
      });

      const venta = ventaAPlano(desordenada);

      expect(venta.items.map((item) => item.producto_id)).toEqual([1, 2, 3]);
    });

    it('si el nombre del producto no se resuelve, sale null y NO se pierde la linea', () => {
      // Con INNER JOIN esta linea desapareceria del ticket en silencio y el total
      // dejaria de cuadrar. Con LEFT JOIN sale con `nombre: null` y el frontend
      // decide que mostrar.
      const venta = ventaAPlano(filaVenta({
        id: 11,
        total: '100.00',
        createdAt: '2026-10-01 10:00:00',
        items: [
          filaDetalle({ id: 1, producto_id: 1, cantidad: '1', precio_unitario: '100.00', subtotal: '100.00', producto: null }),
        ],
      }));

      expect(venta.items).toHaveLength(1);
      expect(venta.items[0].nombre).toBeNull();
      expect(venta.items[0].subtotal).toBe(100);
    });

    it('acepta el producto como fila suelta o como arreglo del include', () => {
      const comoArreglo = ventaAPlano(filaVenta({
        id: 1, total: '1.00', createdAt: 'x',
        items: [filaDetalle({ id: 1, producto_id: 1, cantidad: '1', precio_unitario: '1.00', subtotal: '1.00', producto: [{ nombre: 'A' }] })],
      }));
      const comoFila = ventaAPlano(filaVenta({
        id: 1, total: '1.00', createdAt: 'x',
        items: [filaDetalle({ id: 1, producto_id: 1, cantidad: '1', precio_unitario: '1.00', subtotal: '1.00', producto: { nombre: 'A' } })],
      }));

      expect(comoArreglo.items[0].nombre).toBe('A');
      expect(comoFila.items[0].nombre).toBe('A');
    });

    it('una cabecera sin items devuelve items vacios, no un error', () => {
      const venta = ventaAPlano(filaVenta({ id: 12, total: '0.00', createdAt: 'x' }));

      expect(venta.items).toEqual([]);
    });

    it('sin cabecera devuelve null (y el service lo traduce a 404)', () => {
      expect(ventaAPlano(null)).toBeNull();
      expect(ventaAPlano(undefined)).toBeNull();
    });

    it('acepta objetos planos sin toJSON (mismo resultado)', () => {
      const venta = ventaAPlano({
        id: 13,
        total: '30.00',
        createdAt: 'x',
        items: [{ id: 1, producto_id: 5, cantidad: '3', precio_unitario: '10.00', subtotal: '30.00', producto: { nombre: 'Tostado' } }],
      });

      expect(venta.total).toBe(30);
      expect(venta.items[0]).toEqual({
        producto_id: 5,
        nombre: 'Tostado',
        cantidad: 3,
        precio_unitario: 10,
        subtotal: 30,
      });
    });

    it('no expone el id de la linea ni el de la venta dentro de items (contrato estable)', () => {
      // El contrato de UC-4 no expone ids de linea: si empiezan a aparecer, el
      // frontend empieza a depender de ellos y el contrato cambia sin aviso.
      const venta = ventaAPlano(cabeceraConDosLineas());

      expect(Object.keys(venta.items[0]).sort()).toEqual([
        'cantidad',
        'nombre',
        'precio_unitario',
        'producto_id',
        'subtotal',
      ]);
    });
  });

  describe('listar', () => {
    it('proyecta todas las cabeceras y el total, con orden descendente y paginado', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([cabeceraConDosLineas()], 1);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      const resultado = await repo.listar({ limit: 20, offset: 0 });

      expect(resultado.total).toBe(1);
      expect(resultado.data).toHaveLength(1);
      expect(resultado.data[0].id).toBe(10);

      const [opciones] = ventas.findAll.mock.calls[0];
      expect(opciones.order).toEqual([['createdAt', 'DESC'], ['id', 'DESC']]);
      expect(opciones.limit).toBe(20);
      expect(opciones.offset).toBe(0);
    });

    it('pasa el offset calculado para la pagina pedida', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([], 0);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      await repo.listar({ limit: 10, offset: 30 });

      const [opciones] = ventas.findAll.mock.calls[0];
      expect(opciones).toMatchObject({ limit: 10, offset: 30 });
    });

    it('trae el detalle de las lineas con el nombre del producto (LEFT JOIN)', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([], 0);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      await repo.listar({ limit: 20, offset: 0 });

      const [opciones] = ventas.findAll.mock.calls[0];
      const [includeItems] = opciones.include;
      const [includeProducto] = includeItems.include;

      expect(includeItems.model).toBe(ventaDetalles);
      expect(includeProducto.model).toBe(productos);
      // `required: false` es lo que convierte el JOIN en LEFT. Sin esto, una linea
      // sin producto desapareceria del ticket.
      expect(includeProducto.required).toBe(false);
      expect(includeProducto.attributes).toEqual(['nombre']);
    });

    it('sin ventas devuelve lista vacia con total 0 (no es un error)', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([], 0);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      await expect(repo.listar({ limit: 20, offset: 0 })).resolves.toEqual({ data: [], total: 0 });
    });
  });

  describe('obtenerPorId (ticket)', () => {
    it('devuelve la cabecera proyectada con sus lineas', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([cabeceraConDosLineas()]);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      const venta = await repo.obtenerPorId(10);

      expect(ventas.findByPk).toHaveBeenCalledWith(10, expect.any(Object));
      expect(venta.id).toBe(10);
      expect(venta.items.map((item) => item.nombre)).toEqual(['Cafe', 'Medialunas']);
    });

    it('una venta inexistente devuelve null, y el service lo traduce a 404', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([]);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      await expect(repo.obtenerPorId(999)).resolves.toBeNull();
    });

    it('busca por clave primaria con el detalle incluido, sin paginar', async () => {
      const { ventas, ventaDetalles, productos } = modelosFalsos([cabeceraConDosLineas()]);
      const repo = new SequelizeVentaReadRepository(ventas, ventaDetalles, productos);

      await repo.obtenerPorId(10);

      const [, opciones] = ventas.findByPk.mock.calls[0];
      // Un ticket es de una sola venta: un `limit`/`offset` aqui romperian el
      // historial que el mostrador necesita ver completo.
      expect(opciones.limit).toBeUndefined();
      expect(opciones.offset).toBeUndefined();
      expect(opciones.include).toHaveLength(1);
    });
  });
});