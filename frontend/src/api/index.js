/**
 * Punto de entrada ÚNICO de la capa de acceso (docs/ARQUITECTURA.md §3 y R6).
 *
 * Los componentes importan desde acá (`from '../api'`): así la única dependencia
 * visible para la UI es la capa de acceso, sin rutas relativas hacia adentro de
 * ella y sin riesgo de que un componente llegue al cliente HTTP por otro camino.
 *
 * Reglas de la capa (§3):
 *  - Solo este directorio instancia el cliente HTTP ni conoce URLs.
 *  - Esta capa solo mapea request/response; nunca aplica reglas de negocio.
 *  - Los componentes NO traen lógica de negocio: el total autoritativo lo calcula
 *    el Stored Procedure del backend, la UI solo previsualiza.
 */

export { BASE_URL, mensajeDeError } from './http';
export { default as productosApi } from './productos.api';
export { default as ventasApi } from './ventas.api';
