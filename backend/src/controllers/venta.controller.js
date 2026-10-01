'use strict';

/**
 * CONTROLLER DE VENTAS — backend/src/controllers/venta.controller.js
 *
 * Unica capa que toca `req`/`res`. Su trabajo se reduce a TRES pasos:
 *   1. extraer datos de la peticion,
 *   2. llamar a UN caso de uso del service,
 *   3. traducir el resultado a `res.status().json()`.
 *
 * PROHIBIDO (R1, R4, R11): importar el driver de base de datos, importar modelos,
 * consultar la base, validar reglas de negocio o elegir codigos de error a mano.
 * Si este archivo necesita saber si una cantidad es valida, es que la regla esta en
 * el lugar equivocado: eso es del `VentaService` (y del SP, que es la autoridad
 * final). El cuerpo del POST ya viene normalizado por `middlewares/validate.js` en
 * `req.bodyValidado` (forma), y el service aplica las reglas de negocio.
 *
 * El service se inyecta por constructor desde `container.js` (DIP).
 */

class VentaController {
  /**
   * @param {Object} ventaService caso de uso de ventas
   */
  constructor(ventaService) {
    this.servicio = ventaService;
  }

  /**
   * UC-3 — POST /api/ventas
   * @param {Object} req `req.bodyValidado = { items: [{productoId, cantidad, precioUnitario}], tipo? }`
   * @param {Object} res
   * @returns {Promise<Object>} 201 venta registrada (cabecera + items persistidos)
   */
  registrar = async (req, res) => {
    const { items, tipo } = req.bodyValidado;
    const venta = await this.servicio.registrar(items, tipo);
    return res.status(201).json(venta);
  }

  /**
   * UC-4 — GET /api/ventas?page=&limit=
   * @param {Object} req `req.queryValidado = { page, limit }` en number
   * @param {Object} res
   * @returns {Promise<Object>} 200 { data, meta }
   */
  listar = async (req, res) => {
    const { page, limit } = req.queryValidado;
    const resultado = await this.servicio.listar({ page, limit });
    return res.status(200).json(resultado);
  }

  /**
   * UC-4 — GET /api/ventas/:id
   * @param {Object} req `req.paramsValidado = { id }` (forma validada como entero)
   * @param {Object} res
   * @returns {Promise<Object>} 200 cabecera con sus items; 404 si no existe
   */
  obtenerPorId = async (req, res) => {
    const { id } = req.paramsValidado;
    const venta = await this.servicio.obtenerPorId(id);
    return res.status(200).json(venta);
  }
}

module.exports = VentaController;
