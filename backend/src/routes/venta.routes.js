'use strict';

/**
 * ROUTER DE VENTAS — backend/src/routes/venta.routes.js
 *
 * Solo mapea verbo + ruta -> middlewares de forma -> controller. Cero logica,
 * cero try/catch de negocio, cero acceso a services o repos (R3).
 *
 * El controller llega ya cableado por `container.js` (se inyecta por parametro):
 * este archivo no instancia nada (R3 / R8).
 */

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const {
  validarBody,
  validarQuery,
  validarId,
  esquemaRegistrarVenta,
  esquemaListarVentas,
} = require('../middlewares/validate');

/**
 * @param {Object} ventaController controller ya instanciado
 * @returns {import('express').Router}
 */
function crearVentaRouter(ventaController) {
  const router = express.Router();

  // UC-3: registrar venta (el service termina en CALL sp_registrar_venta).
  router.post(
    '/ventas',
    validarBody(esquemaRegistrarVenta),
    asyncHandler(ventaController.registrar),
  );

  // UC-4: historial de ventas paginado.
  router.get(
    '/ventas',
    validarQuery(esquemaListarVentas),
    asyncHandler(ventaController.listar),
  );

  // UC-4: ticket de una venta.
  router.get(
    '/ventas/:id',
    validarId,
    asyncHandler(ventaController.obtenerPorId),
  );

  return router;
}

module.exports = crearVentaRouter;
