'use strict';

/**
 * SUITE — errors/sp-error (traduccion de la capa de datos)
 * backend/tests/errors/sp-error.test.js
 *
 * Este archivo es el PUENTE entre las dos mitades de la traduccion de errores de
 * ventas, y por eso su comportamiento decide si un rechazo normal del dominio
 * termina pareciendo una caida del servidor:
 *
 *   repositories/  detecta el fallo tecnico  -> SpError  (sin status HTTP)
 *   services/      decide el error de dominio -> 404 / 400 / 409
 *
 * Si `esErrorDelSP` no reconoce un `SIGNAL`, el error sale crudo y el cliente ve
 * un 500 donde deberia ver un 404. Si `esErrorDeRango` confunde un error de
 * infraestructura con un rechazo de negocio, un corte de conexion se responde como
 * 409 y el mostrador cree que el cliente mando mal el carrito.
 *
 * Las pruebas usan errores con la forma REAL que entrega mysql2/sequelize,
 * incluyendo el envoltorio en `parent`.
 */

const {
  SpError,
  esErrorDelSP,
  comoErrorDelSP,
  esErrorDeRango,
  comoErrorDeRango,
  SQLSTATE_SP,
  ERNO_SP,
  ERNO_FUERA_DE_RANGO,
} = require('../../src/errors/sp-error');

/** Error de MySQL con el `parent` que deja sequelize al reemitir el original. */
function errorDeDriver({ sqlState, errno, code, sqlMessage, sql }) {
  const error = new Error('error de MySQL');
  error.sqlState = sqlState;
  error.errno = errno;
  error.code = code;
  error.sqlMessage = sqlMessage;
  error.sql = sql;
  return error;
}

describe('errors/sp-error', () => {
  describe('SpError', () => {
    it('es un Error con la marca `isSpError` para reconocerlo sin instanceof', () => {
      const error = new SpError('rechazo del SP');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SpError');
      // La marca existe para que otra capa pueda reconocerlo aunque el modulo se
      // haya cargado dos veces (dos copias del constructor).
      expect(error.isSpError).toBe(true);
    });

    it('guarda sqlState, errno, sql y origen', () => {
      const error = new SpError('rechazo', {
        sqlState: '45000',
        errno: 1644,
        sql: 'CALL sp_registrar_venta(...)',
        origen: 'rango',
      });

      expect(error.sqlState).toBe('45000');
      expect(error.errno).toBe(1644);
      expect(error.sql).toBe('CALL sp_registrar_venta(...)');
      expect(error.origen).toBe('rango');
    });

    it('el origen por defecto es `signal`', () => {
      expect(new SpError('rechazo').origen).toBe('signal');
    });

    it('NO tiene status HTTP: no es un error de dominio', () => {
      // Si tuviera `status`, `errorHandler` lo mapearia. Un SpError sin traducir
      // debe terminar en 500, que es la respuesta honesta para un fallo tecnico.
      expect(new SpError('rechazo').status).toBeUndefined();
    });
  });

  describe('esErrorDelSP', () => {
    it.each([
      ['sqlState 45000', { sqlState: SQLSTATE_SP }],
      ['errno 1644', { errno: ERNO_SP }],
      ['code 1644', { code: ERNO_SP }],
    ])('reconoce un SIGNAL por %s', (_desc, forma) => {
      expect(esErrorDelSP(errorDeDriver(forma))).toBe(true);
    });

    it('reconoce el SIGNAL aunque solo aparezca en `parent`', () => {
      const error = new Error('Error: CALL sp_registrar_venta');
      error.parent = errorDeDriver({ sqlState: SQLSTATE_SP, errno: ERNO_SP });

      expect(esErrorDelSP(error)).toBe(true);
    });

    it('reconoce un SpError que ya fue traducido (no lo reprocesa como SIGNAL ajeno)', () => {
      expect(esErrorDelSP(new SpError('rechazo'))).toBe(true);
    });

    it.each([
      ['conexion rechazada', { errno: 1040, code: 'ER_CON_COUNT_ERROR' }],
      ['tabla inexistente', { errno: 1146, code: 'ER_NO_SUCH_TABLE' }],
      ['timeout', { errno: 2013, code: 'PROTOCOL_CONNECTION_LOST' }],
      ['error generico', {}],
    ])('NO reconoce como del SP un fallo de infraestructura: %s', (_desc, forma) => {
      // Si estos se tomaran por un rechazo del SP, un corte de base se
      // responderia 409/400 en vez de 500.
      expect(esErrorDelSP(errorDeDriver(forma))).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('no explota con %s', (_desc, error) => {
      expect(esErrorDelSP(error)).toBe(false);
    });
  });

  describe('comoErrorDelSP', () => {
    it('envuelve el SIGNAL conservando el mensaje legible del SP', () => {
      const mensaje = 'El producto 77 de la linea 1 no existe en el catalogo.';
      const error = errorDeDriver({ sqlState: SQLSTATE_SP, errno: ERNO_SP, sqlMessage: mensaje });

      const spError = comoErrorDelSP(error);

      expect(spError).toBeInstanceOf(SpError);
      // El mensaje llega INTACTO, en espanol y accionable: es lo que el service
      // usa para elegir 404 y lo que el cliente ve en la respuesta.
      expect(spError.message).toBe(mensaje);
      expect(spError.origen).toBe('signal');
    });

    it('toma el mensaje del `parent` cuando el error envuelto no lo tiene', () => {
      const error = new Error('Error: CALL sp_registrar_venta');
      error.parent = errorDeDriver({ errno: ERNO_SP, sqlMessage: 'detalle de la venta esta vacio' });

      expect(comoErrorDelSP(error).message).toBe('detalle de la venta esta vacio');
    });

    it('devuelve null si el fallo NO vino del SP (el error se propaga tal cual)', () => {
      const fallo = new Error('connect ECONNREFUSED 127.0.0.1:3307');

      // `null` es la senal de "no translates": el repositorio hace
      // `throw comoErrorDelSP(error) || comoErrorDeRango(error) || error`.
      expect(comoErrorDelSP(fallo)).toBeNull();
    });

    it('preserva sqlState, errno y sql para el diagnostico', () => {
      const error = errorDeDriver({
        sqlState: SQLSTATE_SP,
        errno: ERNO_SP,
        sqlMessage: 'rechazo',
        sql: 'CALL sp_registrar_venta(...)',
      });

      const spError = comoErrorDelSP(error);

      expect(spError).toMatchObject({
        sqlState: SQLSTATE_SP,
        errno: ERNO_SP,
        sql: 'CALL sp_registrar_venta(...)',
      });
    });
  });

  describe('esErrorDeRango', () => {
    it.each(ERNO_FUERA_DE_RANGO.map((errno) => [errno]))('reconoce el errno %i del motor', (errno) => {
      expect(esErrorDeRango(errorDeDriver({ errno, code: 'ER_WARN_DATA_OUT_OF_RANGE' }))).toBe(true);
    });

    it('reconoce el desborde aunque solo traiga `code`', () => {
      expect(esErrorDeRango(errorDeDriver({ code: 'ER_WARN_DATA_TRUNCATED' }))).toBe(true);
    });

    it('reconoce el desborde cuando esta en `parent` (SequelizeDatabaseError)', () => {
      // Este es el stack real: sequelize envuelve en `SequelizeDatabaseError` y el
      // detalle real queda adentro.
      const error = new Error('Out of range value for column v_subtotal at row 1');
      error.parent = { errno: 1264, code: 'ER_WARN_DATA_OUT_OF_RANGE' };

      expect(esErrorDeRango(error)).toBe(true);
    });

    it.each([
      ['un SIGNAL del SP', { sqlState: SQLSTATE_SP, errno: ERNO_SP }],
      ['conexion rechazada', { errno: 1040 }],
      ['sin codigo', {}],
    ])('NO confunde %s con un desborde de rango', (_desc, forma) => {
      expect(esErrorDeRango(errorDeDriver(forma))).toBe(false);
    });

    it('no explota con null', () => {
      expect(esErrorDeRango(null)).toBe(false);
    });
  });

  describe('comoErrorDeRango', () => {
    it('envuelve el desborde como SpError de origen `rango`', () => {
      const mensaje = "Out of range value for column 'v_subtotal' at row 1";
      const error = errorDeDriver({ errno: 1264, code: 'ER_WARN_DATA_OUT_OF_RANGE', sqlMessage: mensaje });

      const spError = comoErrorDeRango(error);

      // `origen: 'rango'` es lo que le permite al service elegir ConflictError
      // (409) en vez de tratar el desborde como un rechazo de validacion.
      expect(spError).toMatchObject({ name: 'SpError', message: mensaje, errno: 1264, origen: 'rango' });
    });

    it('toma el mensaje y el sql del error envuelto', () => {
      const error = new Error('envoltorio');
      error.sql = 'CALL sp_registrar_venta(...)';
      error.parent = { errno: 1264, sqlMessage: 'Out of range value for column v_subtotal' };

      const spError = comoErrorDeRango(error);

      expect(spError.message).toBe('Out of range value for column v_subtotal');
      expect(spError.sql).toBe('CALL sp_registrar_venta(...)');
    });

    it('devuelve null si el fallo no es de rango', () => {
      expect(comoErrorDeRango(new Error('ECONNREFUSED'))).toBeNull();
    });

    it('un SpError de rango NO hereda el sqlState del SP (vienen de capas distintas)', () => {
      const spError = comoErrorDeRango(
        errorDeDriver({ errno: 1264, code: 'ER_WARN_DATA_OUT_OF_RANGE', sqlMessage: 'out of range' }),
      );

      // Si se confundieran, el service podria tratar un desborde como un SIGNAL
      // y devolver 400 en vez de 409.
      expect(spError.sqlState).toBeUndefined();
      expect(spError.origen).toBe('rango');
    });
  });

  describe('constantes exportadas', () => {
    it('el SQLSTATE y el ERNO son los que usa MySQL para un SIGNAL de negocio', () => {
      // Medidos en el stack real (sequelize 6.37.8 + mysql2 3.24.5 + MySQL 8.0.46):
      // `SIGNAL SQLSTATE '45000'` llega al cliente como ERROR 1644.
      expect(SQLSTATE_SP).toBe('45000');
      expect(ERNO_SP).toBe(1644);
    });

    it('los errno de rango son los del motor al insertar fuera del DECIMAL', () => {
      expect(ERNO_FUERA_DE_RANGO).toEqual([1264, 1365]);
    });
  });
});