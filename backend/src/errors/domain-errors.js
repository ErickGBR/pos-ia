'use strict';

/**
 * ERRORES DE DOMINIO — backend/src/errors/domain-errors.js
 *
 * Jerarquia de errores con los tres tipos que define el contrato de casos de
 * uso (UC-1/UC-2, docs/ARQUITECTURA.md §4) y que `middlewares/errorHandler.js`
 * traduce a codigos HTTP:
 *
 *   DomainError (base, NO se mapea: 500)
 *   ├── NotFoundError        -> 404
 *   ├── ValidationError      -> 400
 *   ├── ConflictError        -> 409
 *   └── PayloadTooLargeError -> 413 (`err.status` explicito, ver la clase)
 *
 * Cada error de dominio lleva un `code` estable (contrato para el cliente) y un
 * mensaje en espanol legible. `errorHandler` NO importa `services/` (R3), asi
 * que esta pieza vive en su propia carpeta: es la unica que pueden compartir
 * `services/` y `middlewares/` sin que uno dependa del otro.
 *
 * PROHIBIDO importar Express, el ORM o cualquier modelo desde aqui.
 */

/** Error base del dominio. Sin mapeo HTTP: si llega al handler es un 500. */
class DomainError extends Error {
  /**
   * @param {string} message mensaje legible para el usuario final
   * @param {string} code codigo estable de dominio (contrato con el cliente)
   * @param {Object} [detalles] info extra opcional (campos Offsetidos, etc.)
   */
  constructor(message, code, detalles) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.detalles = detalles;
    this.isDomainError = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** El recurso solicitado no existe. -> 404 */
class NotFoundError extends DomainError {
  /**
   * @param {string} recurso nombre del recurso, p.ej. 'Producto'
   * @param {number|string} [id] identificador consultado, si aplica
   */
  constructor(recurso, id) {
    const sufijo = id === undefined || id === null ? '' : ` con id ${id}`;
    super(`${recurso} no encontrado${sufijo}.`, 'NOT_FOUND', { recurso, id });
    this.recurso = recurso;
    this.id = id;
  }
}

/** Los datos de entrada violan una regla de negocio. -> 400 */
class ValidationError extends DomainError {
  /**
   * @param {string} message mensaje legible para el usuario final
   * @param {Object} [detalles] mapa campo -> motivo, p.ej. { precio: 'debe ser > 0' }
   */
  constructor(message, detalles) {
    super(message, 'VALIDATION_ERROR', detalles);
  }
}

/** La operacion choca con el estado actual del recurso. -> 409 */
class ConflictError extends DomainError {
  /**
   * @param {string} message mensaje legible para el usuario final
   * @param {Object} [detalles] contexto del conflicto, p.ej. { campo: 'codigo_barras' }
   */
  constructor(message, detalles) {
    super(message, 'CONFLICT', detalles);
  }
}

/**
 * El cuerpo de la peticion es correcto en su FORMA pero excede un tope de
 * recurso del servidor. -> 413
 *
 * Se separa de `ValidationError` a proposito. Un 400 dice "la peticion esta
 * mal formada": el cliente tendria que corregir los datos para poder reenviarla.
 * Un 413 dice "la peticion esta bien, pero es demasiado grande para
 * que la procese": el cliente corrige DIVIDIENDOLA, no editando un campo. Es el
 * status que la peticion merece cuando el problema es el TAMANO del payload.
 *
 * Solo existe para el limite de items del carrito (hallazgo M-01). Lleva su
 * `status` explicito porque `errorHandler.statusDe` respeta `err.status` antes
 * del mapeo por constructor: asi el 413 no se convierte en un 400 generico.
 */
class PayloadTooLargeError extends DomainError {
  /**
   * @param {string} message mensaje legible para el usuario final
   * @param {Object} [detalles] datos que explican el limite (recibido, maximo)
   */
  constructor(message, detalles) {
    super(message, 'PAYLOAD_TOO_LARGE', detalles);
    this.status = 413;
  }
}

module.exports = {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PayloadTooLargeError,
};
