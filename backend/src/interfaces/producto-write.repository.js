'use strict';

/**
 * CONTRATO DE ESCRITURA DE PRODUCTOS — backend/src/interfaces/producto-write.repository.js
 *
 * Contrato de escritura de `productos`. Complementa al
 * `ProductoReadRepository` (segregacion de interfaces, ISP).
 *
 * Sobre la baja fisica condicionada (D4): este contrato expone un metodo de
 * ESCRITURA (`eliminar`) y la consulta de integridad referencial
 * (`tieneVentasAsociadas`) que la habilita. La DECISION de borrar o rechazar
 * con 409 no vive aqui: la toma el `ProductoService`, que es quien conoce la
 * regla de negocio. Este contrato solo responde preguntas de datos.
 *
 * Sobre identidad estable: `actualizar` acepta nombre y precio. El
 * `codigo_barras` NUNCA se actualiza (D4 / R5) y por eso ni siquiera se
 * expone en la firma.
 *
 * PROHIBIDO: imports de Express, del ORM, de modelos o de `config/`.
 */

class ProductoWriteRepository {
  /**
   * Inserta un producto nuevo. `codigo_barras` es obligatorio y unico.
   * La unicidad la garantiza el indice UNIQUE de la base; si la base la
   * rechaza, la implementacion debe traduzcirlo a `ConflictError`.
   * @param {{nombre: string, precio: number, codigo_barras: string}} datos
   * @returns {Promise<import('./producto-read.repository').Producto>} producto creado
   */
  // eslint-disable-next-line no-unused-vars
  async crear(datos) {
    throw new Error('No implementado: corresponde al repositorio de escritura.');
  }

  /**
   * Actualiza SOLO `nombre` y `precio` de un producto existente.
   * No toca `codigo_barras` (identidad estable).
   * @param {number} id
   * @param {{nombre?: string, precio?: number}} cambios
   * @returns {Promise<import('./producto-read.repository').Producto|null>} producto
   *   actualizado, o null si el id no existe
   */
  // eslint-disable-next-line no-unused-vars
  async actualizar(id, cambios) {
    throw new Error('No implementado: corresponde al repositorio de escritura.');
  }

  /**
   * Verificacion de integridad referencial previa a la baja fisica (D4).
   * Responde: "este producto aparece en alguna venta?" NO decide ni borra.
   *
   * FAIL-CLOSED obligatorio: si la verificacion NO puede realizarse (tabla
   * `venta_detalle` inexistente, indice/SP ausente, falta de permisos, caida de
   * la base), la implementacion DEBE lanzar y propagar el error. NUNCA debe
   * responder `0` ni degradar el conteo: un `0` devuelto por un fallo significaria
   * "no tiene historial" y habilitaria un borrado a ciego, prohibido por D4.
   * Ante la duda, no se borra.
   * @param {number} id
   * @returns {Promise<number>} cantidad de ventas asociadas (0 = sin historial)
   * @throws {Error} si la verificacion no pudo ejecutarse (fail-closed)
   */
  // eslint-disable-next-line no-unused-vars
  async contarVentasAsociadas(id) {
    throw new Error('No implementado: corresponde al repositorio de escritura.');
  }

  /**
   * Baja fisica. La REGLA (solo si no tiene ventas, si tiene -> 409) la aplica el
   * `ProductoService` antes de llamar a este metodo. Este metodo no re-verifica
   * y no ejecuta un borrado a ciegas por decision propia.
   * @param {number} id
   * @returns {Promise<number>} filas afectadas (0 = no habia nada que borrar)
   */
  // eslint-disable-next-line no-unused-vars
  async eliminar(id) {
    throw new Error('No implementado: corresponde al repositorio de escritura.');
  }
}

module.exports = ProductoWriteRepository;
