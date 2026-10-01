'use strict';

/**
 * ESTRATEGIAS DE MOVIMIENTO DE VENTA — backend/src/services/venta-strategies.js
 *
 * Patron Strategy (OCP, Regla de Oro 13). Cada TIPO de movimiento de venta es una
 * clase que sabe como convertir el carrito del cliente en las lineas que espera el
 * stored procedure.
 *
 * La garantia que se busca es concreta y comprobable con un grep: agregar un tipo
 * nuevo (p.ej. una devolucion, o una venta con descuento global) es AGREGAR UNA
 * CLASE AQUI y registrarla en `container.js`, con CERO cambios en
 * `venta.service.js`. Ese service no tiene ni un `if` por tipo.
 *
 * Lo que NO va en la estrategia: las validaciones de negocio comunes
 * (`cantidad > 0`, `precioUnitario >= 0`, `productoId` valido). Esas las hace
 * `VentaService` antes de delegar, para que todos los tipos compartan exactamente
 * las mismas reglas y anadir un tipo no pueda abrirle una puerta trasera.
 *
 * PROHIBIDO en este archivo: importar el ORM, importar modelos, importar Express,
 * o recibir `req`/`res` (R1).
 */

/**
 * Contrato base de toda estrategia de movimiento.
 * Existe para que un test fake (LSP) pueda implementar el mismo metodo y ser
 * intercambiable con las reales sin que el service lo note.
 */
class VentaStrategyBase {
  /**
   * Nombre del tipo de movimiento, tal como lo acepta la API.
   * @returns {string}
   */
  get tipo() {
    return 'base';
  }

  /**
   * Convierte el carrito validado en las lineas del contrato del SP.
   * @param {Array<{productoId: number, cantidad: number, precioUnitario: number}>} carrito
   * @returns {Array<{producto_id: number, cantidad: number, precio_unitario: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  construirLineas(carrito) {
    throw new Error('No implementado: estrategia de movimiento incompleta.');
  }
}

/**
 * Movimiento NORMAL: la venta de siempre. Traduce el contrato camelCase de la API
 * al contrato snake_case del SP, sin alterar ningun valor.
 *
 * El precio que se pasa es el que envio el cliente (D3: precio editable y
 * congelado). El precio vigente del producto es solo el valor sugerido que el
 * frontend precarga y esta estrategia NUNCA lo consulta ni lo re-deriva.
 */
class VentaNormalStrategy extends VentaStrategyBase {
  /**
   * @inheritdoc
   * @returns {string} `'normal'`
   */
  get tipo() {
    return 'normal';
  }

  /**
   * @inheritdoc
   */
  construirLineas(carrito) {
    return carrito.map((item) => ({
      producto_id: item.productoId,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
    }));
  }
}

module.exports = {
  VentaStrategyBase,
  VentaNormalStrategy,
};
