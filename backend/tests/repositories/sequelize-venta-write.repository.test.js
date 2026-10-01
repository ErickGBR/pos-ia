'use strict';

/**
 * SUITE — SequelizeVentaWriteRepository (el unico write path de ventas)
 * backend/tests/repositories/sequelize-venta-write.repository.test.js
 *
 * Este repositorio es la IMPLEMENTACION de D2: la venta se escribe UNICAMENTE
 * llamando al stored procedure. La suite verifica el CONTRATO MECANICO de esa
 * llamada con una instancia de Sequelize FALSA (`tests/helpers/fakes.js`), sin
 * MySQL y sin Docker. Lo que se comprueba aca es exactamente lo que un MySQL
 * real no dejaria verificar sin montar la base:
 *
 *   1. el ORDEN de las tres consultas (`SET` -> `CALL` -> `SELECT`),
 *   2. que las tres usan la MISMA conexion del pool (`@pos_venta_id` es variable
 *      de SESION: con otra conexion volveria NULL y el id seria NaN),
 *   3. que la conexion se devuelve al pool SIEMPRE, incluso al fallar,
 *   4. que el carrito viaja como `replacements` y no concatenado en la sentencia,
 *   5. como se traducen los rechazos del SP y del motor a `SpError`, y que un
 *      fallo de infraestructura NO se disfraza de rechazo de negocio.
 *
 * Lo que NO se verifica aca (y por que): que el SP exista, que calcule bien el
 * total o que la transaccion sea atomica. Eso es territorio de la base y se
 * comprueba en la prueba de integracion manual, no con un doble en memoria.
 */

const SequelizeVentaWriteRepository = require('../../src/repositories/sequelize-venta-write.repository');
const VentaWriteRepository = require('../../src/interfaces/venta-write.repository');
const { SpError, ERNO_FUERA_DE_RANGO } = require('../../src/errors/sp-error');
const { crearSequelizeFalsa } = require('../helpers/fakes');

const { VARIABLE_SESION } = SequelizeVentaWriteRepository;

/** Dos lineas de carrito validas, ya en el contrato del SP. */
const LINEAS = [
  { producto_id: 1, cantidad: 2, precio_unitario: 100 },
  { producto_id: 7, cantidad: 1, precio_unitario: 25.5 },
];

/** Error del driver tal como lo entrega sequelize/mysql2 para un SIGNAL 45000. */
function errorDeSignal(sqlMessage) {
  const error = new Error('erro de MySQL');
  error.sqlState = '45000';
  error.errno = 1644;
  error.code = 1644;
  error.sqlMessage = sqlMessage;
  error.sql = 'CALL sp_registrar_venta(...)';
  return error;
}

/** Error del driver por un valor que no entra en la columna destino. */
function errorDeRango(sqlMessage, errno) {
  const error = new Error('error de MySQL');
  error.errno = errno;
  error.code = 'ER_WARN_DATA_OUT_OF_RANGE';
  error.sqlMessage = sqlMessage;
  return error;
}

describe('SequelizeVentaWriteRepository', () => {
  describe('contrato de la interfaz', () => {
    it('implementa el contrato de escritura de ventas', () => {
      const repo = new SequelizeVentaWriteRepository(crearSequelizeFalsa());

      expect(repo).toBeInstanceOf(VentaWriteRepository);
    });

    it('NO expone ningun otro metodo de escritura por modelo (D2)', () => {
      const repo = new SequelizeVentaWriteRepository(crearSequelizeFalsa());

      // Si apareciera `crear`, `update`, `destroy` o `bulkCreate`, existiria un
      // SEGUNDO camino de escritura que puede divergir de la transaccion del SP.
      expect(repo.crear).toBeUndefined();
      expect(repo.actualizar).toBeUndefined();
      expect(repo.destroy).toBeUndefined();
      expect(repo.bulkCreate).toBeUndefined();
      expect(Object.getOwnPropertyNames(Object.getPrototypeOf(repo)))
        .toEqual(expect.arrayContaining(['registrarConSP']));
    });
  });

  describe('registrarConSP — camino feliz', () => {
    it('devuelve el id que el SP deposito en la variable de sesion', async () => {
      const sequelize = crearSequelizeFalsa({ idDevuelto: 137 });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).resolves.toEqual({ id: 137 });
    });

    it('ejecuta las tres consultas en orden: SET, CALL, SELECT', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP(LINEAS);

      const sentencias = sequelize.query.mock.calls.map(([sql]) => sql.trim());

      expect(sentencias).toHaveLength(3);
      expect(sentencias[0]).toBe(`SET ${VARIABLE_SESION} = NULL`);
      expect(sentencias[1]).toMatch(/^CALL sp_registrar_venta\(/);
      expect(sentencias[2]).toBe(`SELECT ${VARIABLE_SESION} AS id`);
    });

    it('las tres consultas usan la MISMA conexion del pool', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP(LINEAS);

      // `@pos_venta_id` es una variable de SESION de MySQL: si el CALL y el SELECT
      // bajaran por conexiones distintas del pool, el SELECT leeria NULL.
      const conexiones = sequelize.query.mock.calls.map(([, opciones]) => opciones.connection);
      expect(conexiones[0]).toBeDefined();
      expect(new Set(conexiones).size).toBe(1);
    });

    it('toma UNA conexion del pool y la devuelve al terminar', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP(LINEAS);

      expect(sequelize.connectionManager.getConnection).toHaveBeenCalledTimes(1);
      expect(sequelize.connectionManager.releaseConnection).toHaveBeenCalledTimes(1);
    });

    it('el carrito viaja como JSON en `replacements`, no concatenado en la sentencia', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP(LINEAS);

      const [sqlDelCall, opciones] = sequelize.query.mock.calls[1];

      // El nombre del parametro aparece literal; el VALOR viaja en `replacements`.
      // Concatenarlo seria una SQL injection con el carrito del cliente.
      expect(sqlDelCall).toContain(':detalle_json');
      expect(sqlDelCall).not.toContain('producto_id');
      expect(opciones.replacements).toEqual({ detalle_json: JSON.stringify(LINEAS) });
    });

    it('la variable de salida se limpia antes del CALL (no hereda un id viejo)', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP(LINEAS);

      // Si el CALL fallara y alguien releyera la variable sin limpiar, obtendria el
      // id de una venta ANTERIOR. Por eso el `SET ... = NULL` va primero.
      expect(sequelize.query.mock.calls[0][0]).toContain('= NULL');
    });

    it('normaliza a numero un id que el driver devuelve como texto', async () => {
      const sequelize = crearSequelizeFalsa({ idDevuelto: '88' });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).resolves.toEqual({ id: 88 });
    });

    it('acepta un carrito vacio sin inventar lineas (el SP decide si es valido)', async () => {
      const sequelize = crearSequelizeFalsa();
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await repo.registrarConSP([]);

      const [, opciones] = sequelize.query.mock.calls[1];
      expect(opciones.replacements.detalle_json).toBe('[]');
    });
  });

  describe('registrarConSP — errores del stored procedure', () => {
    it('un SIGNAL 45000 del SP se lanza como SpError y conserva el mensaje', async () => {
      const mensaje = 'El producto 77 de la linea 1 no existe en el catalogo.';
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          throw errorDeSignal(mensaje);
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toMatchObject({
        name: 'SpError',
        isSpError: true,
        message: mensaje,
        sqlState: '45000',
        errno: 1644,
        origen: 'signal',
      });
    });

    it('reconoce el SIGNAL aunque venga envuelto en `parent` (mysql2/sequelize)', async () => {
      const mensaje = 'El detalle de la venta esta vacio.';
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          const error = new Error('Error: erro en el CALL');
          error.parent = errorDeSignal(mensaje);
          throw error;
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toMatchObject({
        name: 'SpError',
        message: mensaje,
        origen: 'signal',
      });
    });

    it('el rechazo del SP igual libera la conexion del pool', async () => {
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          throw errorDeSignal('El detalle de la venta esta vacio.');
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toBeInstanceOf(SpError);

      // Sin este `finally`, un rechazo del SP quemaria una conexion del pool por
      // cada venta invalida: el pool se agota y la API deja de responder.
      expect(sequelize.connectionManager.releaseConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('registrarConSP — errores del motor por valor fuera de rango', () => {
    it.each(ERNO_FUERA_DE_RANGO.map((errno) => [errno]))(
      'un errno %i del motor se lanza como SpError de origen `rango`',
      async (errno) => {
        const mensaje = "Out of range value for column 'v_subtotal' at row 1";
        const sequelize = crearSequelizeFalsa({
          query: async () => {
            throw errorDeRango(mensaje, errno);
          },
        });
        const repo = new SequelizeVentaWriteRepository(sequelize);

        await expect(repo.registrarConSP(LINEAS)).rejects.toMatchObject({
          name: 'SpError',
          isSpError: true,
          message: mensaje,
          errno,
          origen: 'rango',
        });
      },
    );

    it('el desborde de rango tambien libera la conexion', async () => {
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          throw errorDeRango('Out of range value for column v_subtotal', 1264);
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toBeInstanceOf(SpError);
      expect(sequelize.connectionManager.releaseConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('registrarConSP — fallos que NO son rechazos del SP', () => {
    it('un fallo de conexion se propaga tal cual (no se disfraza de SpError)', async () => {
      const fallo = new Error('connect ECONNREFUSED 127.0.0.1:3307');
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          throw fallo;
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toBe(fallo);
    });

    it('un fallo de sintaxis SQL se propaga tal cual', async () => {
      const fallo = new Error("You have an error in your SQL syntax near 'CALL'");
      const sequelize = crearSequelizeFalsa({
        query: async () => {
          throw fallo;
        },
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toBe(fallo);
    });

    it('si el pool no entrega conexion, el error sale y no hay nada que liberar', async () => {
      const sequelize = crearSequelizeFalsa();
      sequelize.connectionManager.getConnection = jest.fn(async () => {
        throw new Error('pool exhausted');
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toThrow(/pool exhausted/);
      expect(sequelize.connectionManager.releaseConnection).not.toHaveBeenCalled();
      expect(sequelize.query).not.toHaveBeenCalled();
    });
  });

  describe('registrarConSP — id devuelto invalido', () => {
    it.each([
      ['null', [{ id: null }]],
      ['undefined', [{ id: undefined }]],
      ['0', [{ id: 0 }]],
      ['negativo', [{ id: -1 }]],
      ['texto no numerico', [{ id: 'abc' }]],
      ['sin filas', []],
    ])('falla ruidosamente si el SP devuelve %s como id', async (_desc, resultado) => {
      const sequelize = crearSequelizeFalsa({
        query: async (sql) => (String(sql).trim().startsWith('SELECT') ? resultado : undefined),
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      // Nunca una venta sin confirmar, y NUNCA un id de otra venta: si el SP no
      // cumple su contrato, es un 500 explicito.
      await expect(repo.registrarConSP(LINEAS)).rejects.toThrow(/no devolvio un id de venta valido/);
    });

    it('tolera que el driver devuelva una fila suelta en vez de un array', async () => {
      const sequelize = crearSequelizeFalsa({
        query: async (sql) => (String(sql).trim().startsWith('SELECT') ? { id: 5 } : undefined),
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      // Segun el tipo de query, sequelize puede devolver una fila suelta. El repo
      // la envuelve antes de leerla; no es un modo de fallo, es tolerancia al
      // driver. Se fija el comportamiento para que no cambie por accidente.
      await expect(repo.registrarConSP(LINEAS)).resolves.toEqual({ id: 5 });
    });

    it('libera la conexion tambien cuando el id viene invalido', async () => {
      const sequelize = crearSequelizeFalsa({
        query: async (sql) => (String(sql).trim().startsWith('SELECT') ? [{ id: null }] : undefined),
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      await expect(repo.registrarConSP(LINEAS)).rejects.toThrow();
      expect(sequelize.connectionManager.releaseConnection).toHaveBeenCalledTimes(1);
    });

    it('ese fallo NO se envuelve en SpError: no vino del SP', async () => {
      const sequelize = crearSequelizeFalsa({
        query: async (sql) => (String(sql).trim().startsWith('SELECT') ? [{ id: null }] : undefined),
      });
      const repo = new SequelizeVentaWriteRepository(sequelize);

      // Si fuera SpError, el service lo traduciria a 409/400 y el cliente creeria
      // que su carrito fue rechazado. Es un fallo tecnico: 500.
      await expect(repo.registrarConSP(LINEAS)).rejects.not.toBeInstanceOf(SpError);
    });
  });
});