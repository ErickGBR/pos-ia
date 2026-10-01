/**
 * VentaLista — historial de ventas y ticket de detalle.
 *
 * Énfasis en la corrección del bug del ticket: el nombre del producto debe
 * mostrarse SIEMPRE (nunca "Producto <id>"), con fallback legible cuando el
 * backend devuelve `nombre` null/vacío, y con los importes/fecha tal como los
 * devuelve el servidor (nada recalculado en el cliente).
 */
import { ventasApi } from '../../src/api';
import VentaLista from '../../src/components/VentaLista.vue';
import { montar, actualizar, botonPorTexto } from '../helpers/montar';

jest.mock('../../src/api', () => {
  const { mensajeDeError } = jest.requireActual('../../src/api/http');
  return {
    ventasApi: { listar: jest.fn(), obtenerPorId: jest.fn() },
    productosApi: { listar: jest.fn() },
    mensajeDeError,
  };
});

const FORMATEADOR_FECHA = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Venta de referencia: 2 líneas, total del servidor distinto a la suma de las líneas. */
function ventaDelServidor() {
  return {
    id: 7,
    total: 99.99,
    createdAt: '2026-03-10T12:00:00.000Z',
    items: [
      {
        producto_id: 41,
        nombre: 'Café molido 250 g',
        cantidad: 1,
        precio_unitario: 12.5,
        subtotal: 12.5,
      },
    ],
  };
}

/** Monta VentaLista con el listado resuelto y abre el ticket de la venta 7. */
async function montarYAbrirTicket(detalle) {
  ventasApi.listar.mockResolvedValue({ data: [ventaDelServidor()], meta: { total: 1 } });
  ventasApi.obtenerPorId.mockResolvedValue(detalle);

  const wrapper = montar(VentaLista);
  await actualizar(wrapper);

  const boton = wrapper.find('[aria-label="Ver detalle de la venta 7"]');
  expect(boton.exists()).toBe(true);
  await boton.trigger('click');
  await actualizar(wrapper);
  expect(wrapper.find('[data-testid="detalle-total"]').exists()).toBe(true);
  return wrapper;
}

describe('VentaLista · ticket de detalle', () => {
  it('muestra el NOMBRE del producto y nunca "Producto <id>"', async () => {
    const wrapper = await montarYAbrirTicket(ventaDelServidor());
    const ticket = wrapper.text();

    expect(ticket).toContain('Café molido 250 g');
    // Regresión del bug: ni el formato viejo ("Producto 41") ni el fallback con id.
    expect(ticket).not.toContain('Producto 41');
    expect(ticket).not.toContain('Producto #41');
    expect(ventasApi.obtenerPorId).toHaveBeenCalledWith(7);
  });

  it('si el nombre viene null, cae a un texto legible sin "undefined" ni "NaN"', async () => {
    const detalle = ventaDelServidor();
    detalle.items = [{ ...detalle.items[0], nombre: null }];

    const wrapper = await montarYAbrirTicket(detalle);
    const ticket = wrapper.text();

    expect(ticket).toContain('Producto #41');
    expect(ticket).not.toContain('undefined');
    expect(ticket).not.toContain('NaN');
  });

  it('si el nombre viene vacío o solo espacios, también cae al texto legible', async () => {
    const detalle = ventaDelServidor();
    detalle.items = [
      { ...detalle.items[0], producto_id: 42, nombre: '   ' },
      { ...detalle.items[0], producto_id: 43, nombre: undefined },
    ];

    const wrapper = await montarYAbrirTicket(detalle);
    const ticket = wrapper.text();

    expect(ticket).toContain('Producto #42');
    expect(ticket).toContain('Producto #43');
    expect(ticket).not.toContain('undefined');
    expect(ticket).not.toContain('NaN');
  });

  it('si la línea no trae ni nombre ni id, muestra un texto fijo legible', async () => {
    const detalle = ventaDelServidor();
    detalle.items = [{ cantidad: 1, precio_unitario: 5, subtotal: 5 }];

    const wrapper = await montarYAbrirTicket(detalle);

    expect(wrapper.text()).toContain('Producto sin nombre');
    expect(wrapper.text()).not.toContain('undefined');
  });

  it('muestra el total que devuelve el servidor, no uno recalculado en el cliente', async () => {
    // Las líneas suman $12.50 pero el servidor dice $99.99 (SP autoritativo, D3/R8).
    const wrapper = await montarYAbrirTicket(ventaDelServidor());

    expect(wrapper.find('[data-testid="detalle-total"]').text()).toBe('$99.99');
    expect(wrapper.text()).toContain('calculado por el servidor');
  });

  it('muestra la fecha del servidor con su formato', async () => {
    const wrapper = await montarYAbrirTicket(ventaDelServidor());

    const esperada = FORMATEADOR_FECHA.format(new Date('2026-03-10T12:00:00.000Z'));
    expect(wrapper.text()).toContain(esperada);
  });

  it('muestra los importes de cada línea tal como los devuelve el servidor', async () => {
    const detalle = ventaDelServidor();
    detalle.items = [
      {
        producto_id: 9,
        nombre: 'Agua mineral 600 ml',
        cantidad: 2,
        precio_unitario: '33.33',
        subtotal: '66.66',
      },
    ];

    const wrapper = await montarYAbrirTicket(detalle);
    const ticket = wrapper.text();

    expect(ticket).toContain('Agua mineral 600 ml');
    expect(ticket).toContain('$33.33');
    expect(ticket).toContain('$66.66');
    expect(ticket).not.toContain('NaN');
  });
});

describe('VentaLista · listado', () => {
  it('pide la página al servidor y muestra el total que reporta el backend', async () => {
    ventasApi.listar.mockResolvedValue({
      data: [ventaDelServidor()],
      meta: { total: 57 },
    });

    const wrapper = montar(VentaLista);
    await actualizar(wrapper);

    expect(ventasApi.listar).toHaveBeenCalledTimes(1);
    expect(ventasApi.listar).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(wrapper.text()).toContain('Mostrando 1–10 de 57 ventas');
    expect(wrapper.findComponent({ name: 'VDataTable' }).props('serverItemsLength')).toBe(57);
  });

  it('vuelve a pedir el historial cuando App avisa que hay una venta nueva', async () => {
    ventasApi.listar.mockResolvedValue({ data: [], meta: { total: 0 } });

    const wrapper = montar(VentaLista);
    await actualizar(wrapper);
    expect(ventasApi.listar).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ revision: 1 });
    await actualizar(wrapper);

    expect(ventasApi.listar).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Todavía no hay ventas registradas.');
  });

  it('muestra el error del servidor si el historial no se puede cargar', async () => {
    ventasApi.listar.mockRejectedValue(
      Object.assign(new Error('boom'), {
        status: 500,
        mensajeServidor: 'Error interno del POS',
      })
    );

    const wrapper = montar(VentaLista);
    await actualizar(wrapper);

    expect(wrapper.text()).toContain('Error interno del POS');
    expect(botonPorTexto(wrapper, 'Reintentar').exists()).toBe(true);
  });
});
