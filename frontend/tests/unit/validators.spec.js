/**
 * Validadores y formateadores del POS.
 *
 * NOTA DE ARQUITECTURA: este frontend NO tiene directorio src/utils/. El árbol
 * real es src/api/, src/components/, App.vue y main.js: las reglas de
 * validación y los formateadores viven DENTRO de cada componente (campo
 * `reglas` en data() y métodos `formatear*`), así que esta suite los prueba
 * donde están, sin montar y sin tocar código de producción.
 *
 * Cobertura pedida: casos válidos e inválidos, límites (precio cero, precio
 * negativo, formato de dos decimales) y los textos que ve el usuario.
 */
import ProductoLista from '../../src/components/ProductoLista.vue';
import VentaTerminal from '../../src/components/VentaTerminal.vue';

/** Reglas del diálogo de alta/edición de producto (ProductoLista.vue). */
const reglasProducto = ProductoLista.data().reglas;

/** Reglas de las líneas del carrito (VentaTerminal.vue). */
const reglasTerminal = VentaTerminal.data().reglas;

/**
 * Evalúa TODAS las reglas de un campo sobre un valor y devuelve el primer
 * resultado que no sea `true` (o `undefined` si todas pasan).
 * @param {Function|Function[]} reglas
 * @param {*} valor
 * @returns {string|undefined}
 */
function primerError(reglas, valor) {
  const lista = Array.isArray(reglas) ? reglas : [reglas];
  const fallas = lista.map((regla) => regla(valor)).filter((r) => r !== true);
  return fallas.length ? fallas[0] : undefined;
}

describe('validators · ProductoLista (alta y edición)', () => {
  describe('campo requerido (nombre y código de barras)', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['null', null],
      ['undefined', undefined],
    ])('rechaza %s', (_caso, valor) => {
      expect(primerError(reglasProducto.requerido, valor)).toBe('Este campo es obligatorio.');
    });

    it('acepta cualquier texto con contenido', () => {
      expect(primerError(reglasProducto.requerido, 'Café molido')).toBeUndefined();
      expect(primerError(reglasProducto.requerido, ' 7501234567890 ')).toBeUndefined();
    });
  });

  describe('campo precio', () => {
    it('rechaza el vacío con su propio mensaje', () => {
      expect(primerError(reglasProducto.precio, '')).toBe('Ingresá un precio.');
      expect(primerError(reglasProducto.precio, '   ')).toBe('Ingresá un precio.');
      expect(primerError(reglasProducto.precio, null)).toBe('Ingresá un precio.');
    });

    it('rechaza los valores no numéricos', () => {
      expect(primerError(reglasProducto.precio, 'abc')).toBe('Ingresá un precio numérico.');
      expect(primerError(reglasProducto.precio, '12abc')).toBe('Ingresá un precio numérico.');
      expect(primerError(reglasProducto.precio, 'Infinity')).toBe('Ingresá un precio numérico.');
    });

    it('acepta el formato de dos decimales que pide el hint', () => {
      expect(primerError(reglasProducto.precio, '12.50')).toBeUndefined();
      expect(primerError(reglasProducto.precio, '12.5')).toBeUndefined();
      expect(primerError(reglasProducto.precio, '0.01')).toBeUndefined();
      expect(primerError(reglasProducto.precio, 4.99)).toBeUndefined();
    });

    it('límite: el precio cero pasa la validación de FORMULARIO', () => {
      expect(primerError(reglasProducto.precio, '0')).toBeUndefined();
      expect(primerError(reglasProducto.precio, '0.00')).toBeUndefined();
    });

    it('límite: el precio negativo pasa el chequeo de FORMA (la regla de negocio vive en el backend)', () => {
      // Decisión documentada en ProductoLista.vue: la UI solo valida
      // requerido/tipo; "precio mayor a 0" lo decide el servidor y su mensaje
      // se muestra tal cual. Ver backend/src/services/producto.service.js
      // (_validarPrecio → "El precio debe ser mayor a 0.").
      expect(primerError(reglasProducto.precio, '-5')).toBeUndefined();
    });
  });
});

describe('validators · VentaTerminal (líneas del carrito)', () => {
  describe('precio unitario', () => {
    it('rechaza el vacío', () => {
      expect(primerError(reglasTerminal.precio, '')).toBe('Ingresá el precio.');
    });

    it('rechaza los valores no numéricos', () => {
      expect(primerError(reglasTerminal.precio, 'abc')).toBe('Usá un precio igual o mayor a 0.');
    });

    it('límite: el precio cero es válido (cortesía / promoción)', () => {
      expect(primerError(reglasTerminal.precio, '0')).toBeUndefined();
      expect(primerError(reglasTerminal.precio, '0.00')).toBeUndefined();
    });

    it('límite: el precio negativo es inválido', () => {
      expect(primerError(reglasTerminal.precio, '-0.01')).toBe('Usá un precio igual o mayor a 0.');
      expect(primerError(reglasTerminal.precio, -3)).toBe('Usá un precio igual o mayor a 0.');
    });

    it('acepta precio de dos decimales', () => {
      expect(primerError(reglasTerminal.precio, '7.50')).toBeUndefined();
    });
  });

  describe('cantidad', () => {
    it('acepta enteros mayores a cero, también como texto', () => {
      expect(primerError(reglasTerminal.cantidad, '1')).toBeUndefined();
      expect(primerError(reglasTerminal.cantidad, '12')).toBeUndefined();
      expect(primerError(reglasTerminal.cantidad, 3)).toBeUndefined();
    });

    it('rechaza el vacío', () => {
      expect(primerError(reglasTerminal.cantidad, '')).toBe('Ingresá la cantidad.');
    });

    it('límite: la cantidad cero es inválida', () => {
      expect(primerError(reglasTerminal.cantidad, '0')).toBe('Debe ser un entero mayor a 0.');
      expect(primerError(reglasTerminal.cantidad, 0)).toBe('Debe ser un entero mayor a 0.');
    });

    it('rechaza los decimales', () => {
      expect(primerError(reglasTerminal.cantidad, '2.5')).toBe('Debe ser un entero mayor a 0.');
    });
  });
});

describe('validators · formateadores', () => {
  const formatearPrecioProducto = ProductoLista.methods.formatearPrecio;
  const { formatearPrecio, formatearFecha, subtotalDe } = VentaTerminal.methods;

  describe('precio en el listado de productos', () => {
    it('siempre muestra dos decimales', () => {
      expect(formatearPrecioProducto(2.75)).toBe('2.75');
      expect(formatearPrecioProducto(12)).toBe('12.00');
      expect(formatearPrecioProducto('12.5')).toBe('12.50');
      expect(formatearPrecioProducto(1234.5)).toBe('1,234.50');
    });

    it('cae a un guión legible si el valor no es numérico', () => {
      expect(formatearPrecioProducto('abc')).toBe('—');
      expect(formatearPrecioProducto(undefined)).toBe('—');
      // Ojo con null: Number(null) === 0, así que imprime "0.00" y no "—".
      // Solo es cosmético: el backend nunca devuelve precio null (NOT NULL en D3).
      expect(formatearPrecioProducto(null)).toBe('0.00');
    });
  });

  describe('precio en la terminal', () => {
    it('prefija el signo de dólar con dos decimales', () => {
      expect(formatearPrecio(4.99)).toBe('$4.99');
      expect(formatearPrecio(0)).toBe('$0.00');
      expect(formatearPrecio(14.969999999999999)).toBe('$14.97');
    });

    it('cae a un guión legible si el valor no es numérico', () => {
      expect(formatearPrecio('abc')).toBe('—');
    });
  });

  describe('fecha', () => {
    it('usa el formato local del servidor', () => {
      const esperada = new Intl.DateTimeFormat('es-SV', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date('2026-03-10T12:00:00.000Z'));

      expect(formatearFecha('2026-03-10T12:00:00.000Z')).toBe(esperada);
    });

    it('no rompe con una fecha inválida: devuelve el valor tal cual', () => {
      expect(formatearFecha('no-es-fecha')).toBe('no-es-fecha');
      expect(formatearFecha('')).toBe('');
      expect(formatearFecha(undefined)).toBe('');
    });
  });

  describe('subtotal de una línea', () => {
    it('multiplica cantidad por precio', () => {
      expect(subtotalDe({ cantidad: '3', precioUnitario: '4.99' })).toBeCloseTo(14.97, 10);
    });

    it('devuelve 0 si la línea tiene basura (nada de NaN en pantalla)', () => {
      expect(subtotalDe({ cantidad: 'x', precioUnitario: '4.99' })).toBe(0);
      expect(subtotalDe({ cantidad: '2', precioUnitario: 'abc' })).toBe(0);
    });
  });
});
