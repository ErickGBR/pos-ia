'use strict';

/**
 * ERROR TECNICO DEL STORED PROCEDURE — backend/src/errors/sp-error.js
 *
 * `sp_registrar_venta` reporta todos sus rechazos de negocio con
 * `SIGNAL SQLSTATE '45000'`, que MySQL expone al cliente como ERROR 1644. Si ese
 * error llegara al `errorHandler` sin traducir, seria un 500 crudo: un rechazo
 * PERFECTAMENTE NORMAL del dominio (producto inexistente, cantidad invalida)
 *terminaria pareciendo una caida del servidor.
 *
 * Este error es el PUENTE entre las dos mitades de la traduccion, y por eso vive
 * en `errors/`, la unica carpeta que pueden compartir `repositories/` y
 * `services/` sin que una dependa de la otra:
 *
 *   repositories/  detecta que el fallo vino del SP  -> lanza `SpError`
 *                  (hecho tecnico: SQLSTATE, errno, mensaje crudo)
 *   services/      decide que error de dominio es  -> NotFound/Validation/Conflict
 *                  (decision de negocio: no vive en la capa de datos)
 *
 * NO es un error de dominio: no tiene status HTTP y `errorHandler` no lo mapea
 * (si se escapara sin traducir, un 500 es la respuesta correcta para un fallo
 * tecnico no clasificado).
 *
 * PROHIBIDO: importar Express, el driver o modelos desde aqui.
 */

/** SQLSTATE que el SP usa en todos sus SIGNAL de negocio. */
const SQLSTATE_SP = '45000';

/** Numero de error con el que MySQL expone un SIGNAL SQLSTATE '45000'. */
const ERNO_SP = 1644;

/**
 * Errores de MySQL por un valor que no entra en la columna destino. NO son
 * `SIGNAL` del SP: los lanza el motor al insertar, y son igualmente corregibles por
 * el cliente (bajar la cantidad o el precio). Sin reconocerlos, un carrito con un
 * total desmedido terminaria en un 500 crudo.
 *   1264 = ER_WARN_DATA_OUT_OF_RANGE (el total desborda DECIMAL(12,2)/(10,2))
 *   1365 = ER_WARN_DATA_TRUNCATED
 */
const ERNO_FUERA_DE_RANGO = [1264, 1365];

/** Codigos de error con los que MySQL nombra los anteriores. */
const CODIGOS_FUERA_DE_RANGO = ['ER_WARN_DATA_OUT_OF_RANGE', 'ER_WARN_DATA_TRUNCATED'];

/**
 * Error tecnico heredado de un `SIGNAL` del stored procedure o de un rechazo del
 * motor durante la misma llamada.
 *
 * @property {boolean} isSpError marca para reconocerlo sin `instanceof` cruzado
 * @property {'signal'|'rango'} origen de donde salio el rechazo
 */
class SpError extends Error {
  /**
   * @param {string} mensaje mensaje original del SP (llega intacto, sin traducir)
   * @param {Object} [detalles]
   * @param {string} [detalles.sqlState] SQLSTATE del motor (`45000`)
   * @param {number} [detalles.errno] codigo numerico del motor (`1644`)
   * @param {string} [detalles.sql] sentencia que produjo el fallo
   * @param {'signal'|'rango'} [detalles.origen] de donde salio el rechazo
   */
  constructor(mensaje, detalles = {}) {
    super(mensaje);
    this.name = 'SpError';
    this.isSpError = true;
    this.sqlState = detalles.sqlState;
    this.errno = detalles.errno;
    this.sql = detalles.sql;
    this.origen = detalles.origen || 'signal';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Detecta si un error del driver viene de un `SIGNAL` del SP.
 *
 * Se mira el error y su `parent` porque mysql2 envuelve algunos fallos y
 * Sequelize puede re-emitir el original: el `sqlState`/`errno` del SP aparece en
 * uno de los dos niveles.
 * @param {Error} error error del driver
 * @returns {boolean}
 */
function esErrorDelSP(error) {
  if (!error) return false;
  if (error.isSpError === true) return true;

  const candidatos = [error, error.parent].filter(Boolean);
  return candidatos.some(
    (e) => e.sqlState === SQLSTATE_SP || e.errno === ERNO_SP || e.code === ERNO_SP,
  );
}

/**
 * Traduce un error del driver al error tecnico de esta capa, conservando el
 * mensaje original del SP (que esta en espanol y es accionable para el usuario).
 * @param {Error} error error del driver
 * @returns {SpError|null} `SpError`, o null si el fallo NO vino del SP
 */
function comoErrorDelSP(error) {
  if (!esErrorDelSP(error)) return null;

  const origen = [error, error.parent].find(
    (e) => e && (e.sqlState === SQLSTATE_SP || e.errno === ERNO_SP || e.code === ERNO_SP),
  ) || error;

  return new SpError(origen.sqlMessage || origen.message, {
    sqlState: origen.sqlState,
    errno: origen.errno,
    sql: origen.sql,
    origen: 'signal',
  });
}

/**
 * Detecta el rechazo del MOTOR por un valor fuera del rango de la columna destino.
 *
 * Vive aparte de `esErrorDelSP` porque estos errores NO son `SIGNAL`: no traen
 * `sqlState 45000` sino `SequelizeDatabaseError` con el detalle en `parent`
 * (`errno 1264 / code ER_WARN_DATA_OUT_OF_RANGE`). Ejemplo real de este stack:
 * con `cantidad: 1000, precioUnitario: 99999999.99` el SP revienta al acumular el
 * subtotal en su variable DECIMAL(12,2) y el error sube como
 * "Out of range value for column 'v_subtotal' at row 1", que es un rechazo de
 * negocio (el cliente puede comprar menos), no una caida del servidor.
 * @param {Error} error error del driver
 * @returns {boolean}
 */
function esErrorDeRango(error) {
  if (!error) return false;

  return [error, error.parent].filter(Boolean).some(
    (e) => ERNO_FUERA_DE_RANGO.includes(e.errno) || CODIGOS_FUERA_DE_RANGO.includes(e.code),
  );
}

/**
 * @param {Error} error error del driver
 * @returns {SpError|null} `SpError` de origen `rango`, o null si no aplica
 */
function comoErrorDeRango(error) {
  if (!esErrorDeRango(error)) return null;

  const origen = [error, error.parent].filter(Boolean).find(
    (e) => ERNO_FUERA_DE_RANGO.includes(e.errno) || CODIGOS_FUERA_DE_RANGO.includes(e.code),
  ) || error;

  return new SpError(origen.sqlMessage || origen.message, {
    errno: origen.errno,
    sql: origen.sql || error.sql,
    origen: 'rango',
  });
}

module.exports = {
  SpError,
  esErrorDelSP,
  comoErrorDelSP,
  esErrorDeRango,
  comoErrorDeRango,
  SQLSTATE_SP,
  ERNO_SP,
  ERNO_FUERA_DE_RANGO,
};
