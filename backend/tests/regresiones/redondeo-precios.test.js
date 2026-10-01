'use strict';

/**
 * GUARD DE REGRESION — redondeo de precios EXACTO a dos decimales
 * backend/tests/regresiones/redondeo-precios.test.js
 *
 * QUE CUBRE ESTA SUITE
 * --------------------
 * Fija, con evidencia ejecutable, la politica de dinero del POS:
 *
 *   EXACTAMENTE 2 decimales, half-up comercial, sobre CENTAVOS ENTEROS.
 *   `precioUnitario: 1.005` -> se congela como 1.01 (no 1.00).
 *
 * Tres niveles:
 *   1. `redondearADosDecimales` (el helper puro, `src/services/dinero.js`).
 *   2. `VentaService._validarPrecioUnitario` (el precio que viaja al SP y se
 *      congela en `venta_detalle.precio_unitario`).
 *   3. `ProductoService._validarPrecio` (el precio del catalogo).
 *
 * EL BUG QUE ESTA SUITE PROTEGE CONTRA REGRESION
 * ----------------------------------------------
 * Antes existia este idiom "redondear a 2 decimales":
 *
 *     return Math.round(precio * 100) / 100;
 *
 * Es CORRECTO en teoria y ROTO en practica: `1.005` no es representable en
 * IEEE-754. El literal vale en realidad 1.00499999999999989..., al multiplicar
 * por 100 el resultado es 100.49999999999999 (verificado abajo con
 * `toPrecision(20)`), `Math.round` lo baja a 100, y el precio quedaba en 1.00
 * cuando comercialmente corresponde 1.01. En un POS eso es PERDER UN CENTAVO
 * por linea en cada precio con medio centavo, con direccion variable (1.005
 * restaba centavo, 2.675 lo sumaba): ni siquiera era una politica consistente.
 *
 * El arreglo trabaja sobre ENTEROS de centavos a partir de la representacion
 * decimal corta del numero (`String(1.005) === '1.005'`), nunca sobre el
 * flotante directo. Ver `src/services/dinero.js`.
 *
 * POLITICA PARA PRECIOS CON MAS DE 2 DECIMALES: SE REDONDEAN (half-up).
 * -------------------------------------------------------------------------
 * No se rechazan. El contrato de la API, el frontend y el SP DECIMAL(10,2)
 * ya estan construidos sobre "esta capa normaliza a 2 decimales"; rechazar
 * cambiaria el contrato publico y romperia flujos que hoy pasan (promociones,
 * precios calculados). Queda documentado en `src/services/dinero.js` y fijado
 * en los tests "politica" de abajo.
 */

const VentaService = require('../../src/services/venta.service');
const ProductoService = require('../../src/services/producto.service');
const { VentaNormalStrategy } = require('../../src/services/venta-strategies');
const { redondearADosDecimales } = require('../../src/services/dinero');
const { CONFIG_DE_PRUEBA, crearVentaReadRepo, crearVentaWriteRepo, crearProductoReadRepo, crearProductoWriteRepo, ventaPersistida } = require('../helpers/fakes');

const STRATEGIES = { normal: new VentaNormalStrategy() };

/**
 * Ejecuta una venta de 1 linea y devuelve el precio que llego al SP.
 * Sincronico respecto al assert: el service es async, asi que el helper
 * devuelve una promesa del precio persistido.
 *
 * Estructura de `mock.calls`: [[ [linea1, linea2, ...] ]]
 *   mock.calls[0]        -> argumentos de la llamada
 *   argumentos[0]        -> el arreglo de lineas que recibio el repositorio
 *   argumentos[0][0]     -> la primera linea
 *
 * @param {number} precioUnitario precio pedido por el cliente
 * @param {number} cantidad
 * @returns {Promise<number>} precio que el service paso al SP
 */
async function precioQueLlegaAlSP(precioUnitario, cantidad = 1) {
  const write = crearVentaWriteRepo({ registrarConSP: jest.fn(async () => ({ id: 1 })) });
  const read = crearVentaReadRepo({ obtenerPorId: jest.fn(async () => ventaPersistida()) });
  const service = new VentaService(read, write, STRATEGIES, CONFIG_DE_PRUEBA);

  await service.registrar([{ productoId: 1, cantidad, precioUnitario }]);

  const [argumentos] = write.registrarConSP.mock.calls;
  const [lineas] = argumentos;
  return lineas[0].precio_unitario;
}

describe('GUARD DE REGRESION — redondeo de precios exacto a 2 decimales (half-up)', () => {
  describe('el mecanismo IEEE-754 (por que no se puede usar el flotante directo)', () => {
    it('1.005 no es representable en IEEE-754: su valor real es menor', () => {
      // La causa raiz del bug. El literal `1.005` vale en realidad
      // 1.00499999999999989..., y al multiplicarlo por 100 queda en
      // 100.49999999999999 y NO en 100.5.
      expect((1.005).toPrecision(20)).toBe('1.0049999999999998934');
      expect((1.005 * 100).toPrecision(20)).toBe('100.49999999999998579');
    });

    it('el patron viejo `Math.round(x * 100) / 100` perdia el centavo', () => {
      // Este era el redondeo del service. Con 2 decimales de entrada casi
      // siempre funcionaba (por eso el bug pasaba desapercibido), pero con
      // medio centavo exacto el resultado caia hacia abajo.
      const patronViejo = (x) => Math.round(x * 100) / 100;

      expect(patronViejo(2.5)).toBe(2.5);
      expect(patronViejo(19.9)).toBe(19.9);
      expect(1.005 * 100).toBeLessThan(100.5);
      expect(patronViejo(1.005)).toBe(1); // 1.00 — el bug
    });

    it('el helper corrige exactamente esos casos', () => {
      expect(redondearADosDecimales(1.005)).toBe(1.01);
      expect(redondearADosDecimales(0.005)).toBe(0.01);
      expect(redondearADosDecimales(2.675)).toBe(2.68);
    });
  });

  describe('redondearADosDecimales (el helper, centavos enteros)', () => {
    it('1.005 -> 1.01: el caso que destapa el bug', () => {
      expect(redondearADosDecimales(1.005)).toBe(1.01);
      expect(redondearADosDecimales(1.005)).not.toBe(1);
    });

    it.each([
      // [entrada, esperado] — casos classicos de coma flotante, half-up comercial
      [0.005, 0.01],
      [2.675, 2.68],
      [0.145, 0.15],
      [0.015, 0.02],
      [1.045, 1.05],
      [1.335, 1.34],
      [2.685, 2.69],
      [8.105, 8.11],
      [100.005, 100.01],
    ])('%p -> %p', (entrada, esperado) => {
      expect(redondearADosDecimales(entrada)).toBe(esperado);
    });

    it('un precio con 2 decimales exactos NO se altera (4.30 sigue 4.30)', () => {
      expect(redondearADosDecimales(4.30)).toBe(4.3);
      expect(redondearADosDecimales(4.30).toFixed(2)).toBe('4.30');
      expect(redondearADosDecimales(4.30)).not.toBe(4.299999999999999);
      expect(redondearADosDecimales(19.90)).toBe(19.9);
      expect(redondearADosDecimales(1234.56)).toBe(1234.56);
      expect(redondearADosDecimales(99999999.99)).toBe(99999999.99);
    });

    it('0 y un entero se manejan bien', () => {
      expect(redondearADosDecimales(0)).toBe(0);
      expect(redondearADosDecimales(1)).toBe(1);
      expect(redondearADosDecimales(100)).toBe(100);
      expect(redondearADosDecimales(2.0)).toBe(2);
    });

    it('politica: mas de 2 decimales se REDONDEA, no se rechaza', () => {
      // Decision documentada en src/services/dinero.js.
      expect(redondearADosDecimales(1.0054)).toBe(1.01);
      expect(redondearADosDecimales(1.0044)).toBe(1);
      expect(redondearADosDecimales(4.299999999)).toBe(4.3);
      expect(redondearADosDecimales(0.1 + 0.2)).toBe(0.3);
    });
  });

  describe('VentaService._validarPrecioUnitario (precio congelado en venta_detalle)', () => {
    it('1.005 se congela como 1.01: el centavo ya no se pierde', async () => {
      // ESTE ES EL CASO QUE DESTAPA EL BUG. Antes resolvia 1, ahora 1.01.
      await expect(precioQueLlegaAlSP(1.005)).resolves.toBe(1.01);
    });

    it.each([
      // [precio pedido, precio que queda persistido]
      [1.005, 1.01],
      [0.005, 0.01],
      [2.675, 2.68],
      [0.145, 0.15],
      [0.015, 0.02],
      [1.045, 1.05],
      [1.335, 1.34],
      [8.105, 8.11],
      [100.005, 100.01],
    ])('precio %p termina persistido como %p', async (pedido, esperado) => {
      await expect(precioQueLlegaAlSP(pedido)).resolves.toBe(esperado);
    });

    it('el redondeo es SIEMPRE half-up coherente: nada resta centavos', async () => {
      // Consistencia: todo medio centavo exacto sube, y un precio bajo el
      // umbral se queda. Nunca hay error con signo variable.
      await expect(precioQueLlegaAlSP(1.005)).resolves.toBe(1.01);
      await expect(precioQueLlegaAlSP(2.675)).resolves.toBe(2.68);
      await expect(precioQueLlegaAlSP(1.004)).resolves.toBe(1);
    });

    it('con cantidad alta, el centavo correcto se aplica a toda la linea', async () => {
      // 100 unidades a 1.005:
      //   pedido:      100 * 1.005 = 100.50
      //   persistido:  100 * 1.01  = 101.00  (antes: 100 * 1.00 = 100.00)
      const unidad = await precioQueLlegaAlSP(1.005, 1);

      expect(unidad).toBe(1.01);
      expect(100 * unidad).toBe(101);
      expect(100 * unidad).toBeGreaterThan(100 * 1.004);
    });

    it('el subtotal que calcula el SP parte del precio YA redondeado a 2 decimales', async () => {
      const write = crearVentaWriteRepo({ registrarConSP: jest.fn(async () => ({ id: 1 })) });
      const read = crearVentaReadRepo({ obtenerPorId: jest.fn(async () => ventaPersistida()) });
      const service = new VentaService(read, write, STRATEGIES, CONFIG_DE_PRUEBA);

      await service.registrar([{ productoId: 1, cantidad: 100, precioUnitario: 1.005 }]);

      const [argumentos] = write.registrarConSP.mock.calls;
      const [lineas] = argumentos;
      const linea = lineas[0];
      expect(linea.precio_unitario).toBe(1.01);
      expect(linea.precio_unitario.toFixed(2)).toBe('1.01');
      expect(100 * linea.precio_unitario).toBe(101);
    });

    it('politica: un precio con mas de 2 decimales se redondea (no se rechaza)', async () => {
      await expect(precioQueLlegaAlSP(1.0054)).resolves.toBe(1.01);
      await expect(precioQueLlegaAlSP(1.0044)).resolves.toBe(1);
    });

    it('los precios de 2 decimales exactos llegan intactos al SP', async () => {
      await expect(precioQueLlegaAlSP(4.30)).resolves.toBe(4.3);
      await expect(precioQueLlegaAlSP(2.5)).resolves.toBe(2.5);
      await expect(precioQueLlegaAlSP(19.9)).resolves.toBe(19.9);
      await expect(precioQueLlegaAlSP(0.07)).resolves.toBe(0.07);
      await expect(precioQueLlegaAlSP(1234.56)).resolves.toBe(1234.56);
    });

    it('0 y un entero llegan bien al SP', async () => {
      // 0 es valido en ventas (cortesia / promocion / donation).
      await expect(precioQueLlegaAlSP(0)).resolves.toBe(0);
      await expect(precioQueLlegaAlSP(100)).resolves.toBe(100);
    });

    it('el limite de rango y las reglas de negocio siguen valiendo igual', async () => {
      // El redondeo NO cambia los limites: 99999999.995 se rechaza por rango, no
      // por redondeo, y un precio negativo se rechaza antes de cualquier calculo.
      const write = crearVentaWriteRepo();
      const read = crearVentaReadRepo({ obtenerPorId: jest.fn(async () => ventaPersistida()) });
      const service = new VentaService(read, write, STRATEGIES, CONFIG_DE_PRUEBA);

      await expect(service.registrar([{ productoId: 1, cantidad: 1, precioUnitario: -1.005 }])).rejects.toThrow();
      await expect(service.registrar([{ productoId: 1, cantidad: 1, precioUnitario: 100000000 }])).rejects.toThrow();
      expect(write.registrarConSP).not.toHaveBeenCalled();
    });
  });

  describe('ProductoService._validarPrecio (mismo criterio que el ticket)', () => {
    it('1.005 se guarda como 1.01 en productos.precio', async () => {
      const write = crearProductoWriteRepo();
      const service = new ProductoService(crearProductoReadRepo(), write, CONFIG_DE_PRUEBA);

      await service.crear({ nombre: 'Producto', precio: 1.005, codigo_barras: '7501234567890' });

      expect(write.crear).toHaveBeenCalledWith(
        expect.objectContaining({ precio: 1.01 }),
      );
    });

    it('2.675 tambien sube el centavo en el catalogo', async () => {
      const write = crearProductoWriteRepo();
      const service = new ProductoService(crearProductoReadRepo(), write, CONFIG_DE_PRUEBA);

      await service.crear({ nombre: 'Producto', precio: 2.675, codigo_barras: '7501234567890' });

      expect(write.crear).toHaveBeenCalledWith(expect.objectContaining({ precio: 2.68 }));
    });

    it('el precio del catalogo y el del ticket COINCIDEN tras editar', async () => {
      // Antes divergian: el catalogo guardaba 1.00 y la venta congelaba otro valor
      // segun el patron. Con el helper compartido, ambos pasan por la MISMA
      // politica de 2 decimales half-up.
      const write = crearProductoWriteRepo();
      const productoService = new ProductoService(crearProductoReadRepo(), write, CONFIG_DE_PRUEBA);

      await productoService.crear({ nombre: 'Producto', precio: 1.005, codigo_barras: '7501234567890' });
      await productoService.actualizar(1, { precio: 1.005 });

      expect(write.crear.mock.calls[0][0].precio).toBe(1.01);
      expect(write.actualizar.mock.calls[0][1].precio).toBe(1.01);
      await expect(precioQueLlegaAlSP(1.005)).resolves.toBe(1.01);
    });

    it('politica: mas de 2 decimales se redondea en el catalogo tambien', async () => {
      const write = crearProductoWriteRepo();
      const service = new ProductoService(crearProductoReadRepo(), write, CONFIG_DE_PRUEBA);

      await service.crear({ nombre: 'Producto', precio: 1.0054, codigo_barras: '7501234567890' });
      expect(write.crear.mock.calls[0][0].precio).toBe(1.01);

      await service.actualizar(1, { precio: 1.0044 });
      expect(write.actualizar.mock.calls[0][1].precio).toBe(1);
    });
  });
});
