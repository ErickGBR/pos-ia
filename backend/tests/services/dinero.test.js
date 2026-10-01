'use strict';

/**
 * TEST UNITARIO DEL HELPER DE DINERO — backend/tests/services/dinero.test.js
 *
 * Fija la politica de redondeo del POS: EXACTAMENTE 2 decimales, half-up
 * comercial, calculado sobre CENTAVOS ENTEROS y nunca sobre el flotante.
 * El caso estrella es `1.005 -> 1.01`: con el patron viejo
 * (`Math.round(x * 100) / 100`) salia 1.00 y el POS perdia un centavo.
 */

const { redondearADosDecimales } = require('../../src/services/dinero');

describe('redondearADosDecimales (half-up comercial sobre centavos enteros)', () => {
  it('1.005 redondea a 1.01 y NO a 1.00 (el caso que destapa el bug)', () => {
    // Con el patron viejo: Math.round(1.005 * 100) / 100 === 1 porque
    // 1.005 * 100 === 100.49999999999999. Con centavos enteros: 101 centavos.
    expect(Math.round(1.005 * 100) / 100).toBe(1); // el bug, documentado
    expect(redondearADosDecimales(1.005)).toBe(1.01);
  });

  it.each([
    // [entrada, esperado] — los casos classicos de coma flotante
    [0.005, 0.01],
    [2.675, 2.68],
    [1.045, 1.05],
    [0.145, 0.15],
    [1.335, 1.34],
    [8.105, 8.11],
    [100.005, 100.01],
    [12.345, 12.35],
  ])('half-up: %p -> %p', (entrada, esperado) => {
    expect(redondearADosDecimales(entrada)).toBe(esperado);
  });

  it('un precio que ya tiene 2 decimales exactos NO se altera', () => {
    expect(redondearADosDecimales(4.30)).toBe(4.3);
    expect(redondearADosDecimales(4.30).toFixed(2)).toBe('4.30');
    expect(redondearADosDecimales(4.30)).not.toBe(4.299999999999999);
    expect(redondearADosDecimales(19.90)).toBe(19.9);
    expect(redondearADosDecimales(0.07)).toBe(0.07);
    expect(redondearADosDecimales(1234.56)).toBe(1234.56);
    expect(redondearADosDecimales(99999999.99)).toBe(99999999.99);
  });

  it('0 y los enteros se manejan bien', () => {
    expect(redondearADosDecimales(0)).toBe(0);
    expect(redondearADosDecimales(1)).toBe(1);
    expect(redondearADosDecimales(100)).toBe(100);
    expect(redondearADosDecimales(2.0)).toBe(2);
  });

  it('politica: los precios con MAS de 2 decimales se REDONDEAN (no se rechazan)', () => {
    // Documentado en src/services/dinero.js. 1.0054 -> 1.01 y 1.0044 -> 1.00:
    // el tercer decimal decide, sin sorpresas.
    expect(redondearADosDecimales(1.0054)).toBe(1.01);
    expect(redondearADosDecimales(1.0044)).toBe(1);
    expect(redondearADosDecimales(4.299999999)).toBe(4.3);
    expect(redondearADosDecimales(0.1 + 0.2)).toBe(0.3);
  });

  it('es exacto tambien con valores chicos que caen en notacion exponencial', () => {
    // String(1e-7) === '1e-7': el helper lo expande y lo redondea a 0.00.
    expect(redondearADosDecimales(1e-7)).toBe(0);
  });
});
