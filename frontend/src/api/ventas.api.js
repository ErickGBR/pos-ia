/**
 * API de ventas — única puerta del frontend hacia las rutas de ventas.
 *
 * Contratos (docs/ARQUITECTURA.md §4, UC-3 y UC-4):
 *   POST /api/ventas             body { items: [{ productoId, cantidad, precioUnitario }] } -> 201
 *                                -> { id, total, createdAt, items: [{ producto_id, cantidad, precio_unitario, subtotal }] }
 *   GET  /api/ventas?page=&limit= -> 200 { data: [{ id, total, createdAt, items }], meta: { total, page, limit } }
 *   GET  /api/ventas/:id          -> 200 venta completa con sus líneas
 *
 * Errores que el backend puede devolver y que la UI debe saber interpretar:
 *   400 carrito vacío / cantidad <= 0 / precio negativo · 404 producto inexistente ·
 *   409 conflicto reportado por el Stored Procedure (el mensaje viaja en el cuerpo).
 *
 * REGLA DE ORO 8 / D3: el total autoritativo lo calcula el SP (sp_registrar_venta).
 * Esta capa SOLO transporta request/response: no calcula ni transforma totales.
 * El frontend envía precioUnitario por línea (precio editable, se congela en la venta)
 * y muestra el total como previsualización hasta que el servidor responde.
 */

import http from './http';

/**
 * Registra una venta. Es el único write path del módulo de ventas:
 * el backend delega en el Stored Procedure, que valida, calcula el total
 * y persiste cabecera + detalle en una sola transacción.
 *
 * @param {Array<{productoId: number|string, cantidad: number, precioUnitario: number}>} items
 *   líneas del carrito; cantidad > 0 y precioUnitario >= 0 (0 = cortesía, nunca negativo)
 * @returns {Promise<{id: number, total: number, createdAt: string,
 *   items: Array<{producto_id: number, cantidad: number, precio_unitario: number, subtotal: number}>}>}
 *   la venta tal como la confirmó el servidor (201)
 */
export function registrar(items) {
  return http.post('/ventas', { items }).then((respuesta) => respuesta.data);
}

/**
 * Historial paginado, más reciente primero (ORDER BY createdAt DESC).
 *
 * @param {Object} [filtros]
 * @param {number} [filtros.page=1]
 * @param {number} [filtros.limit=20]
 * @returns {Promise<{data: Array<{id: number, total: number, createdAt: string, items: Array}>,
 *   meta: {total: number, page: number, limit: number}>}>}
 */
export function listar({ page = 1, limit = 20 } = {}) {
  return http.get('/ventas', { params: { page, limit } }).then((respuesta) => respuesta.data);
}

/**
 * Venta puntual con sus líneas, para el detalle/ticket.
 * Si el id no existe el backend responde 404.
 *
 * @param {number|string} id
 * @returns {Promise<{id: number, total: number, createdAt: string, items: Array}>}
 */
export function obtenerPorId(id) {
  return http.get(`/ventas/${id}`).then((respuesta) => respuesta.data);
}

export default { registrar, listar, obtenerPorId };
