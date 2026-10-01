'use strict';

/**
 * SUITE — config/app (configuracion de la aplicacion)
 * backend/tests/config/app.test.js
 *
 * `config/app.js` lee `process.env` UNA vez, al importarse, y tiene un
 * FAIL-CLOSED de CORS en produccion. Ninguna de las dos cosas se puede probar
 * con un `require` normal dentro de una sola suite: la segunda carga devolveria
 * la config cacheada de la primera.
 *
 * Por eso se usa el helper `tests/helpers/entorno.js`, que hace `resetModules()`,
 * setea el entorno y devuelve el modulo recien evaluado. Asi cada rama se
 * verifica de verdad, en el mismo proceso, sin depender del `.env` real.
 *
 * Lo que se fija aca:
 *   - el fail-closed de produccion con CORS abierto (si esto se rompe, la API
 *     queda aceptando peticiones de cualquier origen),
 *   - la lista de CORS siempre como ARRAY cuando hay origenes (para que el
 *     paquete `cors` compare en vez de reflejar un valor fijo),
 *   - los defaults de paginacion y el tope de items del carrito.
 */

const { configCon, errorAlCargarCon } = require('../helpers/entorno');

/** Entorno neutro: sin NODE_ENV, sin CORS, sin puertos, sin topes. */
const ENTORNO_LIMPIO = {
  NODE_ENV: undefined,
  CORS_ORIGIN: undefined,
  PORT: undefined,
  BACKEND_PORT: undefined,
  VENTAS_MAX_ITEMS_CARRIZO: undefined,
};

describe('config/app', () => {
  describe('valores por defecto', () => {
    it('sin entorno configurado: development, puerto 3000 y paginacion 1/20/100', () => {
      const config = configCon(ENTORNO_LIMPIO);

      expect(config.env).toBe('development');
      expect(config.port).toBe(3000);
      expect(config.pagination).toEqual({ defaultPage: 1, defaultLimit: 20, maxLimit: 100 });
    });

    it('el tope de items del carrito es 100 por defecto (M-01)', () => {
      const config = configCon(ENTORNO_LIMPIO);

      expect(config.ventas.maxItemsPorCarrito).toBe(100);
    });
  });

  describe('puerto', () => {
    it('usa BACKEND_PORT (el nombre del blueprint) con PORT como alternativa', () => {
      expect(configCon({ ...ENTORNO_LIMPIO, BACKEND_PORT: '4000' }).port).toBe(4000);
      expect(configCon({ ...ENTORNO_LIMPIO, PORT: '5000' }).port).toBe(5000);
      // Con ambos definidos gana BACKEND_PORT: es el nombre canonico.
      expect(configCon({ ...ENTORNO_LIMPIO, BACKEND_PORT: '4000', PORT: '5000' }).port).toBe(4000);
    });

    it('un puerto no numerico cae al default en vez de romper el arranque', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, PORT: 'no-es-un-puerto' });

      expect(config.port).toBe(3000);
    });
  });

  describe('CORS en desarrollo', () => {
    it('sin origenes configurados devuelve el comodin "*" (necesario para curl/Postman)', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, NODE_ENV: 'development' });

      expect(config.cors.origin).toBe('*');
    });

    it('una lista vacia o solo espacios degrada al comodin, sin cortar el arranque', () => {
      expect(configCon({ ...ENTORNO_LIMPIO, CORS_ORIGIN: '' }).cors.origin).toBe('*');
      expect(configCon({ ...ENTORNO_LIMPIO, CORS_ORIGIN: '  ,  ' }).cors.origin).toBe('*');
    });

    it('un solo origen se entrega como ARRAY de un elemento, no como string', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, CORS_ORIGIN: 'http://localhost:8080' });

      // El paquete `cors` trata un string como origen LITERAL y lo refleja sin
      // comparar. Con array, compara el `Origin` entrante contra la lista.
      expect(config.cors.origin).toEqual(['http://localhost:8080']);
    });

    it('varios origenes separados por coma se parten y recortan', () => {
      const config = configCon({
        ...ENTORNO_LIMPIO,
        CORS_ORIGIN: 'http://localhost:8080, https://pos.example ,http://localhost:5173',
      });

      expect(config.cors.origin).toEqual([
        'http://localhost:8080',
        'https://pos.example',
        'http://localhost:5173',
      ]);
    });

    it('descarta los elementos vacios de la lista', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, CORS_ORIGIN: 'http://a.test,,' });

      expect(config.cors.origin).toEqual(['http://a.test']);
    });
  });

  describe('CORS fail-closed en produccion', () => {
    it('corta el arranque si NO hay origenes configurados', () => {
      const error = errorAlCargarCon({ ...ENTORNO_LIMPIO, NODE_ENV: 'production' });

      expect(error).toBeInstanceOf(Error);
      // El mensaje tiene que decir QUE tocar: un error sin accion es un muro.
      expect(error.message).toMatch(/CORS_ORIGIN/);
    });

    it('corta el arranque si el origen configurado es el comodin', () => {
      const error = errorAlCargarCon({ ...ENTORNO_LIMPIO, NODE_ENV: 'production', CORS_ORIGIN: '*' });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/cualquier origen/i);
    });

    it('corta el arranque si el comodin se esconde dentro de la lista', () => {
      const error = errorAlCargarCon({
        ...ENTORNO_LIMPIO,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://pos.example,*',
      });

      // Un `*` suelto o escondido es el mismo agujero: la lista se revisa entera.
      expect(error).toBeInstanceOf(Error);
    });

    it('corta el arranque si la lista es solo separadores', () => {
      const error = errorAlCargarCon({ ...ENTORNO_LIMPIO, NODE_ENV: 'production', CORS_ORIGIN: ' , , ' });

      expect(error).toBeInstanceOf(Error);
    });

    it('con lista explicita de origenes, produccion arranca y NO corta', () => {
      const config = configCon({
        ...ENTORNO_LIMPIO,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://pos.example,https://admin.pos.example',
      });

      expect(config.env).toBe('production');
      expect(config.cors.origin).toEqual(['https://pos.example', 'https://admin.pos.example']);
    });

    it('un entorno que NO es production tolera el comodin (no se corta el arranque)', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, NODE_ENV: 'test', CORS_ORIGIN: '*' });

      expect(config.cors.origin).toEqual(['*']);
    });
  });

  describe('tope de items del carrito', () => {
    it('se puede subir por entorno sin tocar codigo (pedidos al por mayor)', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, VENTAS_MAX_ITEMS_CARRIZO: '500' });

      expect(config.ventas.maxItemsPorCarrito).toBe(500);
    });

    it('un valor no numerico cae al default 100', () => {
      const config = configCon({ ...ENTORNO_LIMPIO, VENTAS_MAX_ITEMS_CARRIZO: 'muchos' });

      expect(config.ventas.maxItemsPorCarrito).toBe(100);
    });
  });
});