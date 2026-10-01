'use strict';

/**
 * POLITICA DE REDONDEO DE DINERO — backend/src/services/dinero.js
 *
 * Los precios del POS se manejan con EXACTAMENTE dos decimales: DECIMAL(10,2)
 * en la base, ni uno mas ni uno menos. Este modulo es la unica fuente de verdad
 * de "como se pasa un precio a dos decimales".
 *
 * POR QUE NO `Math.round(x * 100) / 100` (el bug que este archivo reemplaza)
 * -----------------------------------------------------------------------
 * El patron clasico esta roto en coma flotante. `1.005` no es representable en
 * IEEE-754: el literal vale en realidad 1.00499999999999989..., y al
 * multiplicar por 100 el resultado es 100.49999999999999 (verificado con
 * `toPrecision(20)`). `Math.round(100.4999...)` es 100, o sea 1.00: el POS
 * perdia UN CENTAVO en cada precio con medio centavo. En un sistema comercial
 * eso es perder dinero en cada redondeo, y con direccion variable (1.005
 * quedaba 1.00 pero 2.675 quedaba 2.68), asi que ni siquiera era una politica
 * consistente.
 *
 * COMO FUNCIONA ESTE REDONDEO (half-up comercial sobre centavos ENTEROS)
 * ---------------------------------------------------------------------
 * 1. Se toma la REPRESENTACION DECIMAL CORTA del numero: `String(1.005)` es
 *    `"1.005"`, no `"1.00499999999999989"`. Ese string es la intencion decimal
 *    que llego del cliente y es la entrada exacta al calculo.
 * 2. Se convierte a CENTAVOS ENTEROS: parte entera * 100 + los dos primeros
 *    decimales. Ahi no hay coma flotante en el camino critico.
 * 3. El TERCER decimal decide el half-up: >= 5 suma un centavo, < 5 no.
 *    `1.005 -> 101 centavos -> 1.01`, que es el criterio comercial estandar.
 *
 * POLITICA PARA PRECIOS CON MAS DE 2 DECIMALES: SE REDONDEAN (half-up).
 * ---------------------------------------------------------------------------
 * No se rechazan. Decision tomada y aca documentada:
 *   - El contrato de la API ya esta construido sobre redondeo: el frontend, el
 *     SP (DECIMAL(10,2)) y las ventas ya registradas asumen que el service
 *     normaliza a dos decimales. Cambiarlo a rechazo romperia flujos reales
 *     (promociones, decimales que llegan de calculos) y la compatibilidad con
 *     lo ya persistido.
 *   - Rechazar seria un cambio de contrato de API, no un fix de bug: una venta
 *     que hoy pasa empezaria a devolver 400.
 *   - Con half-up sobre centavos el resultado es determinista y documentado:
 *     1.0054 -> 1.01, 1.0044 -> 1.00. Nunca hay sorpresa ni error con signo
 *     variable.
 * El precio EXACTO de dos decimales jamas se altera (4.30 sigue 4.30).
 */

/**
 * Redondea un precio a EXACTAMENTE 2 decimales con criterio half-up comercial,
 * trabajando sobre centavos enteros (nunca sobre el flotante directamente).
 *
 * @param {number} valor precio a normalizar (ya validado como numero finito)
 * @returns {number} precio con exactamente 2 decimales (half-up)
 */
function redondearADosDecimales(valor) {
  const texto = decimalCorto(valor);

  const negativo = texto.startsWith('-');
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [parteEntera, decimales = ''] = sinSigno.split('.');

  // Dos primeros decimales, completados con ceros si el numero tiene menos.
  const dosDecimales = decimales.slice(0, 2).padEnd(2, '0');
  // Tercer decimal: el que decide el half-up. charCodeAt fuera de rango es
  // NaN y `NaN >= 5` es false, asi que un numero de 1-2 decimales no suma nada.
  const tercerDecimal = decimales.charCodeAt(2) - 48;

  let centavos = Number(parteEntera) * 100 + Number(dosDecimales);
  if (tercerDecimal >= 5) centavos += 1;

  const redondeado = centavos / 100;
  return negativo && redondeado !== 0 ? -redondeado : redondeado;
}

/**
 * Representacion decimal normalizada (sin notacion exponencial) del numero.
 * `String(1.005)` ya da `"1.005"`; solo los casos exponenciales (muy chicos)
 * necesitan expansion.
 * @param {number} valor
 * @returns {string}
 */
function decimalCorto(valor) {
  const texto = String(valor);
  if (!/e/i.test(texto)) return texto;

  // 1e-7 -> "0.00000010000000000000", y ahi se recortan los ceros de cola.
  return valor
    .toFixed(20)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

module.exports = { redondearADosDecimales };
