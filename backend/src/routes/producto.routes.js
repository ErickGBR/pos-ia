'use strict';

/**
 * ROUTER DE PRODUCTOS — backend/src/routes/producto.routes.js
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
  esquemaCrearProducto,
  esquemaActualizarProducto,
  esquemaListarProductos,
} = require('../middlewares/validate');

/**
 * @param {Object} productoController controller ya instanciado
 * @returns {import('express').Router}
 */
function crearProductoRouter(productoController) {
  const router = express.Router();

  // UC-1: listado y busqueda.
  router.get(
    '/productos',
    validarQuery(esquemaListarProductos),
    asyncHandler(productoController.listar),
  );

  // UC-2: alta.
  router.post(
    '/productos',
    validarBody(esquemaCrearProducto),
    asyncHandler(productoController.crear),
  );

  // UC-2: edicion de nombre/precio. El id se valida como forma.
  router.put(
    '/productos/:id',
    validarId,
    validarBody(esquemaActualizarProducto),
    asyncHandler(productoController.actualizar),
  );

  // UC-2: baja fisica condicionada.
  router.delete(
    '/productos/:id',
    validarId,
    asyncHandler(productoController.eliminar),
  );

  return router;
}

module.exports = crearProductoRouter;
