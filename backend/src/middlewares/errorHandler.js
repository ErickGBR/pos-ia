'use strict';

/**
 * MANEJO DE ERRORES — backend/src/middlewares/errorHandler.js
 *
 * UNICO lugar del backend que decide que respuesta HTTP sale a la calle. Mapea
 * los errores de dominio del service a su codigo:
 *
 *   `err.status` explicito y valido (400..599) -> ese mismo status (manda primero)
 *   NotFoundError        -> 404
 *   ValidationError      -> 400
 *   ConflictError        -> 409
 *   PayloadTooLargeError -> 413
 *   DomainError          -> 500 (no deberia escaparse nunca)
 *   error de DB     -> 409 si es violacion de unicidad, 500 si es otro
 *   cualquier otro  -> 500
 *
 * Un controller NUNCA escribe `res.status(500)` ni decide codigos a mano (R11):
 * tira el error y lo traduce esta capa.
 *
 * No importa `services/` ni `repositories/` (R3): comparte con ellos solo los
 * errores de dominio de `errors/domain-errors.js`.
 */

const {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PayloadTooLargeError,
} = require('../errors/domain-errors');

/** Codigo HTTP por tipo de error de dominio (contrato de UC-1/UC-2, §4). */
const CODIGOS_POR_ERROR = new Map([
  [NotFoundError, 404],
  [ValidationError, 400],
  [ConflictError, 409],
  // El carrito excede el tope de items: 413, no 400. El status va explicito en
  // la clase, asi que esta entrada del Map es la red de seguridad por
  // constructor: si alguien tira el error sin el `status` puesto, el codigo
  // sigue siendo 413 y no un 500.
  [PayloadTooLargeError, 413],
  [DomainError, 500],
]);

/**
 * Determina el status HTTP de un error.
 *
 * Orden: primero un `err.status` explicito y valido (400..599), despues el
 * mapeo por constructor y por ultimo 500. Sin esa primera regla, un 404 armado
 * a mano (catch-all de rutas inexistente en `app.js`) caia al Map por
 * constructor, no encontraba coincidencia y salia como 500.
 * @param {Error} error
 * @returns {number}
 */
function statusDe(error) {
  // Quien setea `err.status` ya decidio el codigo HTTP (el catch-all de
  // `app.js` con 404, o los errores de parseo de Express con 400/413). Se
  // respeta ese valor mientras sea un status HTTP real; cualquier otra cosa
  // (`status` de texto, 0, 1000...) se ignora y sigue el mapeo normal.
  const statusExplicito = error ? error.status : undefined;
  if (Number.isInteger(statusExplicito) && statusExplicito >= 400 && statusExplicito <= 599) {
    return statusExplicito;
  }

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
