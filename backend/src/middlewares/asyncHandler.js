'use strict';

/**
 * ASYNC HANDLER — backend/src/middlewares/asyncHandler.js
 *
 * Express 4 no captura los rechazos de promesa de un handler `async`: si el
 * controller devuelve una promesa que falla, la excepcion se pierde y la
 * peticion queda colgada. Este wrapper envuelve el handler y reenvia cualquier
 * error al siguiente middleware (`errorHandler`), que es quien sabe mapear
 * errores de dominio a codigos HTTP.
 *
 * No contiene logica de negocio: solo control de flujo de errores.
 */

/**
 * @param {Function} handlerFn handler `async` (controller)
 * @returns {Function} middleware de Express con la misma firma
 */
function asyncHandler(handlerFn) {
  return function envolver(req, res, next) {
    Promise.resolve(handlerFn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
