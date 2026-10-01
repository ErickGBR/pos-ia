/**
 * Diálogo crear/editar producto.
 *
 * Aclaración de arquitectura: NO existe src/components/ProductoForm.vue ni
 * NuevoProductoDialog.vue. El formulario de alta/edición es el <v-dialog> que
 * vive dentro de ProductoLista.vue, así que esta suite monta ese componente y
 * ejercita el diálogo (referencias internas: $refs.formulario, dialogoFormulario).
 *
 * Cubre: validación antes de enviar, rechazo de precio no numérico, payload con
 * la forma que espera la API y el error 409 de código de barras duplicado.
 */
import { productosApi } from '../../src/api';
import ProductoLista from '../../src/components/ProductoLista.vue';
import { montar, actualizar, botonPorTexto } from '../helpers/montar';

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

/** Listado siempre OK: esta suite mide el diálogo, no la carga de la tabla. */
function mockListado() {
  productosApi.listar.mockResolvedValue({ data: PRODUCTOS, meta: { total: PRODUCTOS.length } });
}

/**
 * Campos del diálogo crear/editar, en el orden del template:
 * nombre → código de barras → precio.
 */
function camposFormulario(wrapper) {
  const campos = wrapper.findAll('.v-dialog input');
  return { nombre: campos.at(0), codigo: campos.at(1), precio: campos.at(2) };
}

/** Abre el diálogo de alta y completa el formulario con datos válidos. */
async function abrirYCompletarAlta(wrapper, datos = {}) {
  const { nombre = 'Café molido', codigo = '7501234567890', precio = '12.5' } = datos;

  await botonPorTexto(wrapper, 'Nuevo producto').trigger('click');
  await actualizar(wrapper);

  const campos = camposFormulario(wrapper);
  await campos.nombre.setValue(nombre);
  await campos.codigo.setValue(codigo);
  await campos.precio.setValue(precio);
  await actualizar(wrapper);
}

describe('ProductoForm · validación previa al envío', () => {
  it('valida nombre, precio y código de barras ANTES de enviar', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await botonPorTexto(wrapper, 'Nuevo producto').trigger('click');
    await actualizar(wrapper);
    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.crear).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Este campo es obligatorio.'); // nombre y código
    expect(wrapper.text()).toContain('Ingresá un precio.');
    // El diálogo queda abierto para que el usuario complete los campos.
    expect(wrapper.vm.dialogoFormulario).toBe(true);
  });

  it('no envía si el precio no es numérico (el campo es type=number: "abc" no llega al modelo)', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await abrirYCompletarAlta(wrapper, { precio: 'abc' });

    // El navegador descarta el texto no numérico del input type=number,
    // así que el modelo queda vacío y la regla responde con "obligatorio".
    expect(camposFormulario(wrapper).precio.element.value).toBe('');
    expect(wrapper.vm.form.precio).toBe('');

    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.crear).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ingresá un precio.');
    expect(wrapper.vm.dialogoFormulario).toBe(true);
  });

  it('la regla de precio rechaza cualquier valor no numérico que llegue al modelo', async () => {
    mockListado();
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await botonPorTexto(wrapper, 'Nuevo producto').trigger('click');
    await actualizar(wrapper);

    // Segunda barrera: el type=number cuida el DOM, esta regla cuida el modelo
    // (por si el valor llega por otra vía que no sea el teclado).
    await camposFormulario(wrapper).nombre.setValue('Café molido');
    await camposFormulario(wrapper).codigo.setValue('7501234567890');
    wrapper.vm.form.precio = 'abc';
    await actualizar(wrapper);

    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.crear).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ingresá un precio numérico.');
    expect(wrapper.vm.dialogoFormulario).toBe(true);
  });
});

describe('ProductoForm · payload', () => {
  it('manda el payload con la forma que espera la API (y el nombre recortado)', async () => {
    mockListado();
    productosApi.crear.mockResolvedValue({ id: 99 });
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await abrirYCompletarAlta(wrapper, { nombre: '  Café molido  ', precio: '12.5' });
    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.crear).toHaveBeenCalledTimes(1);
    expect(productosApi.crear).toHaveBeenCalledWith({
      nombre: 'Café molido',
      precio: 12.5,
      codigo_barras: '7501234567890',
    });
    expect(productosApi.actualizar).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Producto creado correctamente.');
    expect(wrapper.vm.dialogoFormulario).toBe(false);
  });

  it('muestra el mensaje del servidor cuando el código de barras está duplicado (409)', async () => {
    mockListado();
    productosApi.crear.mockRejectedValue(
      Object.assign(new Error('conflicto'), {
        status: 409,
        mensajeServidor: 'El código de barras 7501234567890 ya está registrado.',
      })
    );
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await abrirYCompletarAlta(wrapper);
    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.crear).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('El código de barras 7501234567890 ya está registrado.');
    expect(wrapper.text()).not.toContain('No se pudo crear el producto.');
    // El diálogo queda abierto para que el usuario corrija el dato.
    expect(wrapper.vm.dialogoFormulario).toBe(true);
    expect(camposFormulario(wrapper).nombre.element.value).toBe('Café molido');
  });

  it('el payload de edición lleva solo nombre y precio (el código de barras no viaja)', async () => {
    mockListado();
    productosApi.actualizar.mockResolvedValue({ id: 1 });
    const wrapper = montar(ProductoLista);
    await actualizar(wrapper);

    await wrapper.find('[aria-label="Editar Pan integral"]').trigger('click');
    await actualizar(wrapper);
    expect(wrapper.text()).toContain('Editar producto');

    await camposFormulario(wrapper).nombre.setValue('Pan integral 500 g');
    await botonPorTexto(wrapper, 'Guardar').trigger('click');
    await actualizar(wrapper);

    expect(productosApi.actualizar).toHaveBeenCalledTimes(1);
    expect(productosApi.actualizar).toHaveBeenCalledWith(1, {
      nombre: 'Pan integral 500 g',
      precio: 2.75,
    });
    expect(productosApi.actualizar.mock.calls[0][1]).not.toHaveProperty('codigo_barras');
    expect(productosApi.crear).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Producto actualizado correctamente.');
  });
});
