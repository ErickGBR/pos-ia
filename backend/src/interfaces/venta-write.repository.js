'use strict';

/**
 * CONTRATO DE ESCRITURA DE VENTAS — backend/src/interfaces/venta-write.repository.js
 *
 * Contrato de UC-3 (registrar venta). Implementado en
 * `repositories/sequelize-venta-write.repository.js`.
 *
 * D2 (CRITICO, no negociable): la venta NUNCA se escribe por ORM. La UNICA
 * operacion de escritura de ventas es `registrarConSP`, que internamente ejecuta
 * `CALL sp_registrar_venta(:detalle_json)`: el stored procedure valida los
 * productos, calcula subtotales y total, inserta `ventas` + `venta_detalle` en
 * UNA transaccion y devuelve el id de la venta.
 *
 * Por eso este contrato tiene UN SOLO metodo y deliberadamente NO expone
 * `crear`, `actualizar` ni `eliminar`: no existe un camino de escritura por
 * modelo que pueda crecer por error ni que diverja de la transaccion del SP.
 *
 * El `throw` del cuerpo base es intencional: si la implementacion real no fuera
 * inyectada por `container.js`, la llamada falla ruidosamente en vez de escribir
 * algo a medias.
 *
 * PROHIBIDO: imports de Express, del ORM, de modelos o de `config/`.
 */

class VentaWriteRepository {
  /**
   * Registra una venta completa delegando TODO el trabajo al stored procedure.
   * @param {Array<{producto_id: number, cantidad: number, precio_unitario: number}>} lineas
   * @returns {Promise<{id: number}>} id de la venta creada
   */
  // eslint-disable-next-line no-unused-vars
  async registrarConSP(lineas) {
    throw new Error('La implementacion real la inyecta container.js (contrato, no logica).');
  }
}

module.exports = VentaWriteRepository;
