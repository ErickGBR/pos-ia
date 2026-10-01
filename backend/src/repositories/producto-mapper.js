'use strict';

/**
 * MAPEADOR DE PRODUCTO — backend/src/repositories/producto-mapper.js
 *
 * Proyeccion de una fila de `productos` a un objeto plano de la API.
 * Vive en `repositories/` porque MySQL devuelve DECIMAL como texto y ese detalle
 * es del borde de datos: si el mapper viviera mas arriba, cada capa tendria que
 * acordarse de convertir el precio a number.
 *
 * Sin logica de negocio: solo normaliza tipos. Sin imports.
 */

/**
 * @param {Object|null} fila modelo o fila cruda
 * @returns {Object|null} producto plano, o null si la fila no existe
 */
function productoAPlano(fila) {
  if (!fila) return null;
  const datos = typeof fila.toJSON === 'function' ? fila.toJSON() : fila;
  return {
    id: datos.id,
    nombre: datos.nombre,
    precio: Number(datos.precio),
    codigo_barras: datos.codigo_barras,
    createdAt: datos.createdAt,
    updatedAt: datos.updatedAt,
  };
}

module.exports = { productoAPlano };
