/**
 * ProductoLista — listado: búsqueda con debounce, paginación del servidor y
 * manejo del error de carga.
 *
 * Nota: el formulario crear/editar NO es un archivo ProductoForm.vue (no
 * existe en src/components): es el diálogo incluido en este mismo componente,
 * y sus pruebas viven en tests/unit/ProductoForm.spec.js.
 */
import { productosApi } from '../../src/api';
import ProductoLista from '../../src/components/ProductoLista.vue';
import { montar, actualizar, esperar, botonPorTexto } from '../helpers/montar';

jest.mock('../../src/api', () => {
  const { mensajeDeError } = jest.requireActual('../../src/api/http');
  return {
    ventasApi: { listar: jest.fn(), obtenerPorId: jest.fn(), registrar: jest.fn() },
    productosApi: { listar: jest.fn(), crear: jest.fn(), actualizar: jest.fn(), eliminar: jest.fn() },
    mensajeDeError,
  };
});

const PRODUCTOS = [
  { id: 1, nombre: 'Pan integral', precio: 2.75, codigo_barras: '7501111111111' },
  { id: 2, nombre: 'Café molido 250 g', precio: 4.99, codigo_barras: '7502222222222' },
];

const CAMPO_BUSQUEDA = 'input[aria-label="Buscar productos por nombre o código de barras"]';

/** Listado realista: q vacío devuelve el catálogo, q con texto no encuentra nada. */
function mockListado() {
  productosApi.listar.mockImplementation(({ q } = {}) =>
    Promise.resolve({
      data: q ? [] : PRODUCTOS,
      meta: { total: q ? 0 : PRODUCTOS.length },
    })
  );
}

describe('ProductoLista · búsqueda', () => {
  it('al escribir en el buscador se dispara UNA sola petición', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);
    expect(productosApi.listar).toHaveBeenCalledTimes(1); // carga inicial del listado
    productosApi.listar.mockClear();

    await wrapper.find(CAMPO_BUSQUEDA).setValue('cafe');
    await esperar(450); // debounce de 350 ms
    await actualizar(wrapper);

    expect(productosApi.listar).toHaveBeenCalledTimes(1);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: 'cafe', page: 1, limit: 20 });
  });

  it('al limpiar la búsqueda se dispara UNA sola petición', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);
    productosApi.listar.mockClear(); // medimos solo las peticiones de la búsqueda

    await wrapper.find(CAMPO_BUSQUEDA).setValue('xyz');
    await esperar(450); // debounce de 350 ms
    await actualizar(wrapper);
    expect(productosApi.listar).toHaveBeenCalledTimes(1); // la de la búsqueda
    productosApi.listar.mockClear();

    await botonPorTexto(wrapper, 'Limpiar búsqueda').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.listar).toHaveBeenCalledTimes(1);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: '', page: 1, limit: 20 });
    expect(wrapper.find(CAMPO_BUSQUEDA).element.value).toBe('');

    // El debounce pendiente (si lo hubiera) no debe soltar una segunda carga.
    await esperar(450);
    await actualizar(wrapper);
    expect(productosApi.listar).toHaveBeenCalledTimes(1);
  });

  it('escribe de más rápido de lo que responde el servidor y no dispara doble fetch', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);
    productosApi.listar.mockClear();

    const campo = wrapper.find(CAMPO_BUSQUEDA);
    await campo.setValue('c');
    await campo.setValue('ca');
    await campo.setValue('cafe');
    await esperar(450);
    await actualizar(wrapper);

    expect(productosApi.listar).toHaveBeenCalledTimes(1);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: 'cafe', page: 1, limit: 20 });
  });

  it('limpiar con el icono X también recarga una sola vez con q vacío', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await wrapper.find(CAMPO_BUSQUEDA).setValue('xyz');
    await esperar(450);
    await actualizar(wrapper);
    productosApi.listar.mockClear();

    const iconoLimpiar = wrapper.find('.v-input__icon--clear button');
    expect(iconoLimpiar.exists()).toBe(true);
    await iconoLimpiar.trigger('click');
    await actualizar(wrapper);
    await esperar(450); // el clearable emite input y el debounce dispara la recarga
    await actualizar(wrapper);

    expect(productosApi.listar).toHaveBeenCalledTimes(1);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: '', page: 1, limit: 20 });
    expect(wrapper.vm.termino).toBe('');
  });
});

describe('ProductoLista · paginación del servidor', () => {
  it('usa server-items-length y el rango que manda el backend', async () => {
    productosApi.listar.mockResolvedValue({ data: PRODUCTOS, meta: { total: 57 } });

    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    expect(wrapper.findComponent({ name: 'VDataTable' }).props('serverItemsLength')).toBe(57);
    expect(wrapper.text()).toContain('Mostrando 1–20 de 57 productos');
    // 57 ítems / 20 por página = 3 páginas, decididas por el servidor.
    expect(wrapper.findComponent({ name: 'VPagination' }).props('length')).toBe(3);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: '', page: 1, limit: 20 });
  });

  it('al cambiar de página vuelve a pedir esa página al servidor', async () => {
    productosApi.listar.mockResolvedValue({ data: PRODUCTOS, meta: { total: 57 } });

    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);
    productosApi.listar.mockClear();

    await wrapper.findComponent({ name: 'VPagination' }).vm.$emit('input', 3);
    await actualizar(wrapper);

    expect(productosApi.listar).toHaveBeenCalledTimes(1);
    expect(productosApi.listar).toHaveBeenCalledWith({ q: '', page: 3, limit: 20 });
  });
});
