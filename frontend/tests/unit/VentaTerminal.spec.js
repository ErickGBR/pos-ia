/**
 * VentaTerminal — punto de venta: estado del carrito, edición de precio y
 * cantidad por línea, y registro de la venta.
 *
 * Enfoque: comportamiento observable (disabled, textos, subtotales y la forma
 * del payload). La capa src/api/ siempre está mockeada: cero HTTP real.
 */
import { productosApi, ventasApi } from '../../src/api';
import VentaTerminal from '../../src/components/VentaTerminal.vue';
import { montar, actualizar, esperar } from '../helpers/montar';

jest.mock('../../src/api', () => {
  const { mensajeDeError } = jest.requireActual('../../src/api/http');
  return {
    ventasApi: { listar: jest.fn(), obtenerPorId: jest.fn(), registrar: jest.fn() },
    productosApi: { listar: jest.fn(), crear: jest.fn(), actualizar: jest.fn(), eliminar: jest.fn() },
    mensajeDeError,
  };
});

const CAFE = { id: 2, nombre: 'Café molido 250 g', precio: 4.99, codigo_barras: '7502222222222' };

const CAMPO_BUSQUEDA =
  'input[aria-label="Buscar producto para agregar al carrito"]';

function botonRegistrar(wrapper) {
  return wrapper.find('[data-testid="registrar-venta"]');
}

function totalPreview(wrapper) {
  return wrapper.find('[data-testid="total-preview"]').text();
}

function lineaDelCarrito(wrapper) {
  return wrapper.find(`[aria-label="Línea del carrito: ${CAFE.nombre}"]`);
}

/** Busca "cafe", espera el debounce (300 ms) y agrega el primer resultado. */
async function agregarCafeAlCarrito(wrapper) {
  productosApi.listar.mockResolvedValue({ data: [CAFE], meta: { total: 1 } });

  await wrapper.find(CAMPO_BUSQUEDA).setValue('cafe');
  await esperar(400);
  await actualizar(wrapper);

  await wrapper.find(`[aria-label="Agregar ${CAFE.nombre} al carrito"]`).trigger('click');
  await actualizar(wrapper);
  expect(wrapper.vm.carrito).toHaveLength(1);
}

describe('VentaTerminal · carrito vacío', () => {
  it('el botón de registrar está deshabilitado y explica por qué', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);

    expect(botonRegistrar(wrapper).attributes('disabled')).toBe('disabled');
    expect(wrapper.text()).toContain('El carrito está vacío.');
    expect(wrapper.text()).toContain(
      'Agregá al menos un producto para habilitar el registro de la venta.'
    );

    // Aunque el clic llegue, la guarda del componente no registra nada.
    await botonRegistrar(wrapper).trigger('click');
    await actualizar(wrapper);
    expect(ventasApi.registrar).not.toHaveBeenCalled();
  });
});

describe('VentaTerminal · edición de líneas', () => {
  it('el precio unitario es editable y el total se recalcula', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);
    await agregarCafeAlCarrito(wrapper);

    // Precio por defecto: el del catálogo (sugerido, no gravado).
    expect(totalPreview(wrapper)).toBe('$4.99');
    expect(lineaDelCarrito(wrapper).find('.col-subtotal').text()).toContain('$4.99');

    await wrapper
      .find(`input[aria-label="Precio unitario editable de ${CAFE.nombre}"]`)
      .setValue('7.50');
    await actualizar(wrapper);

    expect(totalPreview(wrapper)).toBe('$7.50');
    expect(lineaDelCarrito(wrapper).find('.col-subtotal').text()).toContain('$7.50');
  });

  it('la cantidad es editable y afecta al subtotal', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);
    await agregarCafeAlCarrito(wrapper);

    expect(lineaDelCarrito(wrapper).find('.col-subtotal').text()).toContain('$4.99');

    await wrapper.find(`input[aria-label="Cantidad de ${CAFE.nombre}"]`).setValue('3');
    await actualizar(wrapper);

    expect(lineaDelCarrito(wrapper).find('.col-subtotal').text()).toContain('$14.97');
    expect(totalPreview(wrapper)).toBe('$14.97');
  });
});

describe('VentaTerminal · registro de la venta', () => {
  it('manda al backend el precio que editó el usuario y no el del catálogo', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);
    await agregarCafeAlCarrito(wrapper);

    await wrapper
      .find(`input[aria-label="Precio unitario editable de ${CAFE.nombre}"]`)
      .setValue('7.50');
    await wrapper.find(`input[aria-label="Cantidad de ${CAFE.nombre}"]`).setValue('2');
    await actualizar(wrapper);

    ventasApi.registrar.mockResolvedValue({
      id: 55,
      total: 15,
      createdAt: '2026-03-10T12:00:00.000Z',
      items: [],
    });

    await botonRegistrar(wrapper).trigger('click');
    await actualizar(wrapper);

    expect(ventasApi.registrar).toHaveBeenCalledTimes(1);
    expect(ventasApi.registrar).toHaveBeenCalledWith([
      { productoId: CAFE.id, cantidad: 2, precioUnitario: 7.5 },
    ]);
    // El precio del catálogo era 4.99: no debe viajar.
    expect(ventasApi.registrar.mock.calls[0][0][0].precioUnitario).not.toBe(CAFE.precio);
  });

  it('tras registrar, el carrito queda vacío y el botón vuelve a quedar deshabilitado', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);
    await agregarCafeAlCarrito(wrapper);

    ventasApi.registrar.mockResolvedValue({
      id: 55,
      total: 15,
      createdAt: '2026-03-10T12:00:00.000Z',
      items: [],
    });

    await botonRegistrar(wrapper).trigger('click');
    await actualizar(wrapper);

    expect(wrapper.vm.carrito).toHaveLength(0);
    expect(wrapper.text()).toContain('El carrito está vacío.');
    expect(wrapper.text()).toContain('Venta #55 registrada.');
    expect(wrapper.text()).toContain(
      'Agregá al menos un producto para habilitar el registro de la venta.'
    );
    expect(botonRegistrar(wrapper).attributes('disabled')).toBe('disabled');

    // Señal hacia el layout (App) para refrescar el historial.
    expect(wrapper.emitted('venta-registrada')).toHaveLength(1);
    expect(wrapper.emitted('venta-registrada')[0][0].id).toBe(55);
  });

  it('si el backend rechaza la venta se muestra su mensaje y el carrito se conserva', async () => {
    const wrapper = montar(VentaTerminal);
    await actualizar(wrapper);
    await agregarCafeAlCarrito(wrapper);

    ventasApi.registrar.mockRejectedValue(
      Object.assign(new Error('conflicto'), {
        status: 409,
        mensajeServidor: 'El servidor rechazó la venta por stock.',
      })
    );

    await botonRegistrar(wrapper).trigger('click');
    await actualizar(wrapper);

    expect(wrapper.text()).toContain('El servidor rechazó la venta por stock.');
    expect(wrapper.vm.carrito).toHaveLength(1); // no se pierde lo que armó el cajero
    expect(wrapper.emitted('venta-registrada')).toBeUndefined(); // no se avisó al layout
    // Terminó el intento fallido: el botón se reactiva para reintentar.
    expect(botonRegistrar(wrapper).attributes('disabled')).toBeUndefined();
  });
});
