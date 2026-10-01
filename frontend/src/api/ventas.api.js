/**
 * API de ventas — STUB FUNCIONAL (la implementación completa la hace otra agente).
 *
 * Ya está cableada contra la capa http/ y respeta los contratos de §4 del blueprint,
 * para que los componentes de ventas solo tengan que consumirla:
 *   POST /api/ventas            body { items: [{ productoId, cantidad, precioUnitario }] } -> 201
 *   GET  /api/ventas?page=&limit= -> { data: [{ id, total, createdAt, items }], meta }
 *   GET  /api/ventas/:id          -> venta con detalle
 *
 * El total SIEMPRE lo calcula el SP (sp_registrar_venta): el frontend solo envía
 * líneas con precio_unitario editable y muestra el total como preview.
 */

import http from './http';

/**
 * Registra una venta (write path exclusivo del SP en el backend).
 * @param {Array<{productoId:number|string, cantidad:number, precioUnitario:number}>} items
 * @returns {Promise<{id:number, total:number, createdAt:string, items:Array}>}
 */
export function registrar(items) {
  return http.post('/ventas', { items }).then((respuesta) => respuesta.data);
}

/**
 * Historial paginado de ventas (más recientes primero).
 * @param {Object} [filtros]
 * @param {number} [filtros.page=1]
 * @param {number} [filtros.limit=20]
 * @returns {Promise<{data:Array, meta:{total:number,page:number,limit:number}>}>}
 */
export function listar({ page = 1, limit = 20 } = {}) {
  return http.get('/ventas', { params: { page, limit } }).then((respuesta) => respuesta.data);
}

/**
 * Venta puntual con sus líneas (para ticket / detalle).
 * @param {number|string} id
 * @returns {Promise<Object>}
 */
export function obtenerPorId(id) {
  return http.get(`/ventas/${id}`).then((respuesta) => respuesta.data);
}

export default { registrar, listar, obtenerPorId };
