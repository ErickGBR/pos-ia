'use strict';

/**
 * CONTROLLER DE PRODUCTOS — backend/src/controllers/producto.controller.js
 *
 * Unica capa que toca `req`/`res`. Su trabajo se reduce a TRES pasos:
 *   1. extraer datos de la peticion,
 *   2. llamar a UN caso de uso del service,
 *   3. traducir el resultado a `res.status().json()`.
 *
 * PROHIBIDO (R1, R4, R11): importar el driver de base de datos, importar
 * modelos, consultar la base, validar reglas de negocio o elegir codigos de
 * error a mano. Si este archivo necesita saber si un precio es valido, es que
 * la regla esta en el lugar equivocado.
 *
 * El service se inyecta por constructor desde `container.js` (DIP).
 */

class ProductoController {
  /**
   * @param {Object} productoService caso de uso de productos
   */
  constructor(productoService) {
    this.servicio = productoService;
  }

  /**
   * UC-1 — GET /api/productos?q=&page=&limit=
   * El middleware de forma ya dejo `req.queryValidado` con page/limit en number.
   * @param {Object} req
   * @param {Object} res
   * @returns {Promise<Object>} 200 { data, meta }
   */
  listar = async (req, res) => {
    const { q, page, limit } = req.queryValidado;
    const resultado = await this.servicio.listar({ q, page, limit });
    return res.status(200).json(resultado);
  }

  /**
   * UC-2 — POST /api/productos
   * @param {Object} req
   * @param {Object} res
   * @returns {Promise<Object>} 201 producto creado
   */
  crear = async (req, res) => {
    const { nombre, precio, codigo_barras } = req.bodyValidado;
    const creado = await this.servicio.crear({ nombre, precio, codigo_barras });
    return res.status(201).json(creado);
  }

  /**
   * UC-2 — PUT /api/productos/:id
   * Solo nombre y precio viajan al service: el codigo de barras es identidad
   * estable y no se manda ni se acepta.
   * @param {Object} req
   * @param {Object} res
   * @returns {Promise<Object>} 200 producto actualizado
   */
  actualizar = async (req, res) => {
    const { id } = req.params;
    const { nombre, precio } = req.bodyValidado;
    const actualizado = await this.servicio.actualizar(id, { nombre, precio });
    return res.status(200).json(actualizado);
  }

  /**
   * UC-2 — DELETE /api/productos/:id
   * Baja fisica condicionada: si el producto tiene historial de ventas el
   * service lanza ConflictError y este controller nunca ve un 200.
   * @param {Object} req
   * @param {Object} res
   * @returns {Promise<Object>} 200 { id, eliminado }
   */
  eliminar = async (req, res) => {
    const { id } = req.params;
    const resultado = await this.servicio.eliminar(id);
    return res.status(200).json(resultado);
  }
}

module.exports = ProductoController;
