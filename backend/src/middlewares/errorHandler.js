'use strict';

/**
 * MANEJO DE ERRORES — backend/src/middlewares/errorHandler.js
 *
 * UNICO lugar del backend que decide que respuesta HTTP sale a la calle. Mapea
 * los errores de dominio del service a su codigo:
 *
 *   NotFoundError   -> 404
 *   ValidationError -> 400
 *   ConflictError   -> 409
 *   DomainError     -> 500 (no deberia escaparse nunca)
 *   error de DB     -> 409 si es violacion de unicidad, 500 si es otro
 *   cualquier otro  -> 500
 *
 * Un controller NUNCA escribe `res.status(500)` ni decide codigos a mano (R11):
 * tira el error y lo traduce esta capa.
 *
 * No importa `services/` ni `repositories/` (R3): comparte con ellos solo los
 * errores de dominio de `errors/domain-errors.js`.
 */

const { DomainError, NotFoundError, ValidationError, ConflictError } = require('../errors/domain-errors');

/** Codigo HTTP por tipo de error de dominio (contrato de UC-1/UC-2, §4). */
const CODIGOS_POR_ERROR = new Map([
  [NotFoundError, 404],
  [ValidationError, 400],
  [ConflictError, 409],
  [DomainError, 500],
]);

/**
 * Determina el status HTTP de un error.
 * @param {Error} error
 * @returns {number}
 */
function statusDe(error) {
  const porTipo = CODIGOS_POR_ERROR.get(error.constructor);
  if (porTipo) return porTipo;
  if (error instanceof DomainError) return 500;

  // Red de seguridad para errores del driver que no llegaron a traducirse en
  // la capa de datos (p.ej. una violacion de unicidad en otra columna):
  // 409 y no un 500 crudo, porque el cliente si puede corregirlo.
  if (error && error.name === 'SequelizeUniqueConstraintError') return 409;

  return 500;
}

/**
 * Construye el cuerpo de la respuesta de error.
 * @param {Error} error
 * @param {number} status
 * @returns {{error: Object}}
 */
function cuerpoDe(error, status) {
  const esDominio = error instanceof DomainError;
  return {
    error: {
      code: esDominio ? error.code : (status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR'),
      message: esDominio
        ? error.message
        : 'Ocurrio un error inesperado al procesar la peticion.',
      detalles: esDominio ? error.detalles || undefined : undefined,
    },
  };
}

/**
 * Middleware final de Express: 4 argumentos (obligatorio para que Express lo
 * reconozca como handler de errores).
 * @param {Error} err
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = statusDe(err);
  const cuerpo = cuerpoDe(err, status);

  // 5xx es un fallo nuestro: se loguea completo. 4xx es culpa del cliente:
  // se loguea en una sola linea, sin ruido.
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error] no controlado:', err && err.stack ? err.stack : err);
  } else {
    // eslint-disable-next-line no-console
    console.warn('[rechazo]', req.method, req.originalUrl, '->', status, cuerpo.error.message);
  }

  return res.status(status).json(cuerpo);
}

module.exports = errorHandler;
module.exports.statusDe = statusDe;
