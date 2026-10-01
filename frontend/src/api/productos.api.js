/**
 * API de productos — única puerta del frontend hacia GET/POST/PUT/DELETE /api/productos.
 *
 * Modelo de producto (esto es TODO lo que existe):
 *   { id, nombre, precio, codigo_barras }
 * No hay stock, categoría, precio_compra ni `activo`: no se piden ni se muestran.
 *
 * Contratos (docs/ARQUITECTURA.md):
 *   GET    /api/productos?q=&page=&limit= -> { data: [...], meta: { total, page, limit } }
 *   POST   /api/productos                 body { nombre, precio, codigo_barras } -> 201
 *   PUT    /api/productos/:id             body { nombre, precio } -> 200 (el codigo_barras NO se actualiza)
 *   DELETE /api/productos/:id             -> 200 (puede devolver 409 si el producto tiene ventas)
 */

import http from './http';

/**
 * Listado paginado con búsqueda opcional (nombre LIKE / codigo_barras exacto).
 * @param {Object} [filtros]
 * @param {string} [filtros.q] texto de búsqueda (vacío = listado completo)
 * @param {number} [filtros.page=1]
 * @param {number} [filtros.limit=20]
 * @returns {Promise<{data: Array<{id:number, nombre:string, precio:number, codigo_barras:string}>, meta:{total:number,page:number,limit:number}>}>}
 */
export function listar({ q = '', page = 1, limit = 20 } = {}) {
  return http
    .get('/productos', { params: { q: q || undefined, page, limit } })
    .then((respuesta) => respuesta.data);
}

/**
 * @param {{nombre: string, precio: number, codigo_barras: string}} datos
 * @returns {Promise<Object>} producto creado
 */
export function crear(datos) {
  return http.post('/productos', datos).then((respuesta) => respuesta.data);
}

/**
 * Actualización parcial de identidad comercial: SOLO nombre y precio.
 * El codigo_barras es identidad estable y jamás viaja en el PUT.
 * @param {number|string} id
 * @param {{nombre: string, precio: number}} datos
 * @returns {Promise<Object>} producto actualizado
 */
export function actualizar(id, datos) {
  return http.put(`/productos/${id}`, datos).then((respuesta) => respuesta.data);
}

/**
 * Baja del producto. El backend puede responder 409 si el producto tiene ventas.
 * @param {number|string} id
 * @returns {Promise<Object>}
 */
export function eliminar(id) {
  return http.delete(`/productos/${id}`).then((respuesta) => respuesta.data);
}

export default { listar, crear, actualizar, eliminar };
