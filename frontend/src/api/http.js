/**
 * CAPA DE ACCESO HTTP — el ÚNICO archivo del frontend que instancia axios.
 *
 * Reglas (docs/ARQUITECTURA.md §3 y R6):
 *  - Los componentes NUNCA importan axios ni hardcodean URLs: consumen src/api/*.
 *  - Esta capa solo mapea request/response; no contiene reglas de negocio.
 */

import axios from 'axios';

/** Base URL de la API. Configurable vía VUE_APP_API_BASE_URL (.env). */
export const BASE_URL = process.env.VUE_APP_API_BASE_URL || 'http://localhost:3000/api';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

/** Extrae el mensaje de error que haya devuelto el backend (shape defensivo). */
function mensajeDelServidor(data) {
  if (!data) return null;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (data.error && typeof data.error.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim();
  }
  if (typeof data.mensaje === 'string' && data.mensaje.trim()) return data.mensaje.trim();
  return null;
}

/**
 * Normaliza cualquier rechazo de axios a un Error con forma estable:
 *   - error.status: código HTTP (0 = sin respuesta / error de red)
 *   - error.mensajeServidor: mensaje devuelto por el backend (o null)
 *   - error.message: mensaje ya apto para mostrar al usuario
 */
function normalizarError(error) {
  if (error && error.response) {
    const { status, data } = error.response;
    const servidor = mensajeDelServidor(data);
    const err = new Error(servidor || `El servidor respondió con error ${status}.`);
    err.status = status;
    err.mensajeServidor = servidor;
    err.datos = data;
    return err;
  }

  if (error && error.request) {
    const err = new Error('No se pudo conectar con el servidor. Verificá que el backend esté corriendo.');
    err.status = 0;
    err.mensajeServidor = null;
    return err;
  }

  const err = new Error((error && error.message) || 'Ocurrió un error inesperado.');
  err.status = 0;
  err.mensajeServidor = null;
  return err;
}

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizarError(error))
);

/**
 * Traduce un error normalizado a texto amigable para la UI.
 * @param {Error} error error rechazado por cualquier método de src/api/*
 * @param {string} mensajePorDefecto fallback en español cuando el backend no mandó mensaje
 * @returns {string}
 */
export function mensajeDeError(error, mensajePorDefecto = 'Ocurrió un error inesperado.') {
  if (!error) return mensajePorDefecto;
  if (error.mensajeServidor) return error.mensajeServidor;
  if (error.status === 0 && error.message) return error.message; // error de red, ya redactado
  return mensajePorDefecto;
}

export default http;
