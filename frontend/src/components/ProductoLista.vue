<template>
  <section aria-labelledby="titulo-productos">
    <!-- ── Cabecera ─────────────────────────────────────────────── -->
    <header class="d-flex flex-wrap align-center mb-4">
      <div class="mr-auto">
        <h2 id="titulo-productos" class="text-h5 font-weight-bold">Productos</h2>
        <p class="text-body-2 grey--text text--darken-1 mb-0">
          Buscá, creá, editá o eliminá los productos del catálogo.
        </p>
      </div>
      <v-btn color="primary" depressed class="mt-2 mt-sm-0" @click="abrirCrear">
        <v-icon left>mdi-plus</v-icon>
        Nuevo producto
      </v-btn>
    </header>

    <!-- ── Búsqueda por nombre o código de barras ───────────────── -->
    <v-text-field
      v-model="busqueda"
      label="Buscar productos"
      placeholder="Nombre o código de barras"
      prepend-inner-icon="mdi-magnify"
      outlined
      dense
      clearable
      hide-details="auto"
      aria-label="Buscar productos por nombre o código de barras"
      @input="programarBusqueda"
    />

    <!-- ── Error de carga del listado ───────────────────────────── -->
    <v-alert v-if="errorLista" type="error" text class="mt-4 mb-0" role="alert">
      {{ errorLista }}
      <v-btn small text color="error" class="ml-2" @click="cargar">Reintentar</v-btn>
    </v-alert>

    <!-- ── Tabla (se oculta si falló la carga: la alerta de arriba es la voz única) ── -->
    <v-card v-if="!errorLista" outlined class="mt-4" :aria-busy="cargando ? 'true' : 'false'">
      <v-data-table
        :headers="columnas"
        :items="productos"
        :items-per-page="porPagina"
        :page="pagina"
        :server-items-length="total"
        :loading="cargando"
        :hide-default-footer="true"
        item-key="id"
        loading-text="Cargando productos…"
        no-data-text="Sin productos para mostrar"
        aria-label="Listado de productos"
      >
        <template v-slot:item.precio="{ item }">
          <div class="text-right font-weight-medium">{{ formatearPrecio(item.precio) }}</div>
        </template>

        <template v-slot:item.acciones="{ item }">
          <div class="d-flex justify-end">
            <v-tooltip bottom>
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  icon
                  small
                  color="primary"
                  v-bind="attrs"
                  v-on="on"
                  :aria-label="`Editar ${item.nombre}`"
                  @click="abrirEditar(item)"
                >
                  <v-icon small>mdi-pencil</v-icon>
                </v-btn>
              </template>
              <span>Editar producto</span>
            </v-tooltip>

            <v-tooltip bottom>
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  icon
                  small
                  color="error"
                  v-bind="attrs"
                  v-on="on"
                  :aria-label="`Eliminar ${item.nombre}`"
                  @click="abrirEliminar(item)"
                >
                  <v-icon small>mdi-delete-outline</v-icon>
                </v-btn>
              </template>
              <span>Eliminar producto</span>
            </v-tooltip>
          </div>
        </template>

        <!-- Estados vacíos -->
        <template v-slot:no-data>
          <div class="pa-8 text-center">
            <template v-if="cargando">
              <v-progress-circular indeterminate color="primary" width="3"></v-progress-circular>
              <p class="mb-0 mt-4 grey--text text--darken-1">Cargando productos…</p>
            </template>

            <template v-else-if="errorLista">
              <v-icon large color="error">mdi-alert-circle-outline</v-icon>
              <p class="mb-0 mt-3 font-weight-medium">No se pudo cargar el listado.</p>
            </template>

            <template v-else-if="hayBusqueda">
              <v-icon large color="grey">mdi-magnify-remove-outline</v-icon>
              <p class="mb-1 mt-3 font-weight-medium">
                Ningún producto coincide con «{{ termino }}».
              </p>
              <p class="text-caption grey--text text--darken-1 mb-4">
                Probá con otro término o con el código de barras completo.
              </p>
              <v-btn small text color="primary" @click="limpiarBusqueda">
                Limpiar búsqueda
              </v-btn>
            </template>

            <template v-else>
              <v-icon large color="grey">mdi-package-variant</v-icon>
              <p class="mb-1 mt-3 font-weight-medium">Aún no hay productos cargados.</p>
              <p class="text-caption grey--text text--darken-1 mb-4">
                Creá el primero para empezar a operar en el POS.
              </p>
              <v-btn small depressed color="primary" @click="abrirCrear">
                <v-icon left small>mdi-plus</v-icon>
                Crear producto
              </v-btn>
            </template>
          </div>
        </template>
      </v-data-table>

      <!-- ── Paginación (siempre del lado del servidor) ───────────── -->
      <v-divider v-if="mostrarPaginacion"></v-divider>
      <div v-if="mostrarPaginacion" class="d-flex flex-wrap align-center pa-3 pa-sm-4">
        <span class="text-caption grey--text text--darken-1 mr-auto" role="status">
          Mostrando {{ rango }}
        </span>

        <v-select
          :value="porPagina"
          :items="porPaginaOpciones"
          item-text="texto"
          item-value="valor"
          label="Por página"
          outlined
          dense
          hide-details
          style="max-width: 175px; min-width: 150px"
          aria-label="Productos por página"
          @change="cambiarPorPagina"
        ></v-select>

        <v-pagination
          :value="pagina"
          :length="paginas"
          :total-visible="7"
          :disabled="cargando"
          color="primary"
          class="ml-2"
          aria-label="Paginación de productos"
          @input="irAPagina"
        ></v-pagination>
      </div>
    </v-card>

    <!-- ── Diálogo crear / editar ───────────────────────────────── -->
    <v-dialog v-model="dialogoFormulario" max-width="520" :persistent="guardando" scrollable>
      <v-card>
        <v-card-title class="text-h6 font-weight-bold">
          {{ modo === 'crear' ? 'Nuevo producto' : 'Editar producto' }}
        </v-card-title>

        <v-card-text class="pt-4">
          <v-form ref="formulario" :disabled="guardando" @submit.prevent="guardar">
            <v-text-field
              v-model="form.nombre"
              :rules="[reglas.requerido]"
              label="Nombre"
              placeholder="Ej. Café molido 250 g"
              outlined
              dense
              autocomplete="off"
            ></v-text-field>

            <v-text-field
              v-model="form.codigo_barras"
              :rules="modo === 'crear' ? [reglas.requerido] : []"
              :readonly="modo === 'editar'"
              label="Código de barras"
              placeholder="Ej. 7501234567890"
              outlined
              dense
              autocomplete="off"
              :persistent-hint="modo === 'editar'"
              :hint="modo === 'editar' ? 'El código de barras no se modifica.' : ''"
            ></v-text-field>

            <v-text-field
              v-model="form.precio"
              :rules="[reglas.precio]"
              label="Precio"
              type="number"
              step="0.01"
              min="0"
              outlined
              dense
              suffix="USD"
              hint="Formato con dos decimales, ej. 12.50"
              persistent-hint
            ></v-text-field>
          </v-form>

          <v-alert
            v-if="errorFormulario"
            type="error"
            text
            dense
            class="mt-3 mb-0"
            role="alert"
          >
            {{ errorFormulario }}
          </v-alert>
        </v-card-text>

        <v-card-actions class="px-4 pb-4">
          <v-spacer></v-spacer>
          <v-btn text :disabled="guardando" @click="cerrarFormulario">Cancelar</v-btn>
          <v-btn
            color="primary"
            depressed
            :loading="guardando"
            :disabled="guardando"
            @click="guardar"
          >
            Guardar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── Diálogo eliminar ─────────────────────────────────────── -->
    <v-dialog v-model="dialogoEliminar" max-width="460" :persistent="guardando">
      <v-card>
        <v-card-title class="text-h6 font-weight-bold">Eliminar producto</v-card-title>
        <v-card-text>
          <p class="mb-2">
            Vas a eliminar
            <strong>{{ productoAEliminar ? productoAEliminar.nombre : '' }}</strong>
            ({{ productoAEliminar ? formatearPrecio(productoAEliminar.precio) : '' }}).
          </p>
          <p class="text-body-2 grey--text text--darken-1 mb-0">
            Esta acción no se puede deshacer.
          </p>

          <v-alert
            v-if="errorEliminar"
            type="error"
            text
            dense
            class="mt-4 mb-0"
            role="alert"
          >
            {{ errorEliminar }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-spacer></v-spacer>
          <v-btn text :disabled="guardando" @click="dialogoEliminar = false">Cancelar</v-btn>
          <v-btn
            color="error"
            depressed
            :loading="guardando"
            :disabled="guardando"
            @click="confirmarEliminar"
          >
            Eliminar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── Notificaciones ───────────────────────────────────────── -->
    <v-snackbar
      v-model="snackbar.visible"
      :color="snackbar.color"
      :timeout="3500"
      bottom
      role="status"
      aria-live="polite"
    >
      {{ snackbar.texto }}
      <template v-slot:action="{ attrs }">
        <v-btn text small v-bind="attrs" @click="snackbar.visible = false">Cerrar</v-btn>
      </template>
    </v-snackbar>
  </section>
</template>

<script>
/**
 * ProductoLista — CRUD de productos (listar, buscar, paginar, crear, editar, eliminar).
 *
 * Arquitectura por capas (docs/ARQUITECTURA.md §3):
 *  - Este componente NO importa el cliente HTTP directamente ni conoce URLs:
 *    consume la capa de acceso (productos.api.js).
 *  - NO contiene lógica de negocio: solo estado local de UI + llamadas a esa capa.
 *  - Modelo completo: { id, nombre, precio, codigo_barras } (no existe stock/categoría/activo).
 */

import { productosApi, mensajeDeError } from '../api';

const formateador = new Intl.NumberFormat('es-SV', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default {
  name: 'ProductoLista',

  data: () => ({
    // Listado (estado local, paginado por el servidor)
    productos: [],
    total: 0,
    pagina: 1,
    porPagina: 20,
    porPaginaOpciones: [
      { valor: 10, texto: '10 por página' },
      { valor: 20, texto: '20 por página' },
      { valor: 50, texto: '50 por página' },
    ],
    cargando: false,
    errorLista: null,

    // Búsqueda (con debounce)
    busqueda: '',
    termino: '',
    temporizadorBusqueda: null,

    // Diálogo crear / editar
    dialogoFormulario: false,
    modo: 'crear',
    guardando: false,
    errorFormulario: null,
    form: { id: null, nombre: '', codigo_barras: '', precio: '' },

    // Diálogo eliminar
    dialogoEliminar: false,
    productoAEliminar: null,
    errorEliminar: null,

    // Notificación
    snackbar: { visible: false, texto: '', color: 'success' },

    columnas: [
      { text: 'ID', value: 'id', width: '80px', sortable: false },
      { text: 'Nombre', value: 'nombre', sortable: false },
      { text: 'Código de barras', value: 'codigo_barras', sortable: false },
      { text: 'Precio', value: 'precio', align: 'end', width: '140px', sortable: false },
      { text: 'Acciones', value: 'acciones', align: 'end', width: '110px', sortable: false },
    ],

    reglas: {
      requerido: (valor) => !!(valor && String(valor).trim()) || 'Este campo es obligatorio.',
      // Solo validación de FORMULARIO (requerido / tipo): la regla de negocio
      // (precio mayor a 0) vive en el backend y no se replica acá. Si el servidor
      // la rechaza, el error se muestra tal como llega.
      precio: (valor) => {
        if (valor === null || valor === undefined || String(valor).trim() === '') {
          return 'Ingresá un precio.';
        }
        return Number.isFinite(Number(valor)) || 'Ingresá un precio numérico.';
      },
    },
  }),

  computed: {
    paginas() {
      return Math.max(1, Math.ceil(this.total / this.porPagina));
    },
    rango() {
      if (!this.total) return '0 productos';
      const desde = (this.pagina - 1) * this.porPagina + 1;
      const hasta = Math.min(this.total, this.pagina * this.porPagina);
      return `${desde}–${hasta} de ${this.total} productos`;
    },
    hayBusqueda() {
      return this.termino.length > 0;
    },
    mostrarPaginacion() {
      return !this.errorLista && this.total > 0;
    },
  },

  created() {
    this.cargar();
  },

  beforeDestroy() {
    clearTimeout(this.temporizadorBusqueda);
  },

  methods: {
    /* ── Capa api/ ─────────────────────────────────────────────── */

    async cargar() {
      this.cargando = true;
      this.errorLista = null;
      try {
        const respuesta = await productosApi.listar({
          q: this.termino,
          page: this.pagina,
          limit: this.porPagina,
        });
        this.productos = Array.isArray(respuesta.data) ? respuesta.data : [];
        this.total = Number(respuesta.meta && respuesta.meta.total) || 0;
      } catch (error) {
        this.productos = [];
        this.total = 0;
        this.errorLista = mensajeDeError(error, 'No se pudieron cargar los productos.');
      } finally {
        this.cargando = false;
      }
    },

    /* ── Búsqueda (un único camino: input → debounce → buscarAhora) ─ */

    programarBusqueda() {
      clearTimeout(this.temporizadorBusqueda);
      this.temporizadorBusqueda = setTimeout(() => this.buscarAhora(), 350);
    },

    /**
     * Único punto de entrada de la búsqueda. Cancela el debounce pendiente y
     * recarga SOLO cuando el término o la página realmente cambiaron: así el
     * click en "limpiar" y el disparo diferido del debounce no generan dos
     * cargas para la misma búsqueda (bug de fase 1).
     */
    buscarAhora() {
      clearTimeout(this.temporizadorBusqueda);
      const termino = (this.busqueda || '').trim();
      const sinCambio = termino === this.termino && this.pagina === 1;
      this.termino = termino;
      if (sinCambio) return;
      this.pagina = 1;
      this.cargar();
    },

    limpiarBusqueda() {
      this.busqueda = '';
      this.buscarAhora();
    },

    /* ── Paginación ────────────────────────────────────────────── */

    irAPagina(pagina) {
      if (this.cargando || pagina === this.pagina) return;
      this.pagina = pagina;
      this.cargar();
    },

    cambiarPorPagina(valor) {
      this.porPagina = Number(valor);
      this.pagina = 1;
      this.cargar();
    },

    /* ── Crear / editar ────────────────────────────────────────── */

    abrirCrear() {
      this.modo = 'crear';
      this.form = { id: null, nombre: '', codigo_barras: '', precio: '' };
      this.errorFormulario = null;
      this.dialogoFormulario = true;
      this.$nextTick(() => {
        if (this.$refs.formulario) this.$refs.formulario.resetValidation();
      });
    },

    abrirEditar(item) {
      this.modo = 'editar';
      this.form = {
        id: item.id,
        nombre: item.nombre,
        codigo_barras: item.codigo_barras,
        precio: Number(item.precio).toFixed(2),
      };
      this.errorFormulario = null;
      this.dialogoFormulario = true;
      this.$nextTick(() => {
        if (this.$refs.formulario) this.$refs.formulario.resetValidation();
      });
    },

    cerrarFormulario() {
      if (this.guardando) return;
      this.dialogoFormulario = false;
      this.errorFormulario = null;
    },

    async guardar() {
      if (this.guardando) return;
      if (!this.$refs.formulario.validate()) return;

      this.guardando = true;
      this.errorFormulario = null;
      const nombre = this.form.nombre.trim();
      const precio = Number(this.form.precio);

      try {
        if (this.modo === 'crear') {
          await productosApi.crear({
            nombre,
            precio,
            codigo_barras: this.form.codigo_barras.trim(),
          });
          this.notificar('Producto creado correctamente.', 'success');
        } else {
          // El código de barras es identidad estable: jamás viaja en la edición.
          await productosApi.actualizar(this.form.id, { nombre, precio });
          this.notificar('Producto actualizado correctamente.', 'success');
        }
        this.dialogoFormulario = false;
        await this.cargar();
      } catch (error) {
        const porDefecto =
          this.modo === 'crear'
            ? 'No se pudo crear el producto. Revisá los datos e intentá de nuevo.'
            : 'No se pudo actualizar el producto. Revisá los datos e intentá de nuevo.';
        this.errorFormulario = mensajeDeError(error, porDefecto);
      } finally {
        this.guardando = false;
      }
    },

    /* ── Eliminar ──────────────────────────────────────────────── */

    abrirEliminar(item) {
      this.productoAEliminar = item;
      this.errorEliminar = null;
      this.dialogoEliminar = true;
    },

    async confirmarEliminar() {
      if (this.guardando || !this.productoAEliminar) return;

      this.guardando = true;
      this.errorEliminar = null;
      const nombre = this.productoAEliminar.nombre;

      try {
        await productosApi.eliminar(this.productoAEliminar.id);
        this.dialogoEliminar = false;
        this.productoAEliminar = null;
        this.notificar(`Producto «${nombre}» eliminado.`, 'success');

        // Si se eliminó el único ítem de la última página, volvemos una atrás.
        if (this.productos.length === 1 && this.pagina > 1) this.pagina -= 1;

        await this.cargar();
      } catch (error) {
        const porDefecto =
          error && error.status === 409
            ? `No se puede eliminar «${nombre}»: el producto tiene ventas registradas.`
            : 'No se pudo eliminar el producto.';
        this.errorEliminar = mensajeDeError(error, porDefecto);
      } finally {
        this.guardando = false;
      }
    },

    /* ── UI ────────────────────────────────────────────────────── */

    formatearPrecio(valor) {
      const numero = Number(valor);
      if (!Number.isFinite(numero)) return '—';
      return formateador.format(numero);
    },

    notificar(texto, color = 'success') {
      this.snackbar = { visible: true, texto, color };
    },
  },
};
</script>
