<template>
  <section aria-labelledby="titulo-ventas">
    <!-- ── Cabecera ─────────────────────────────────────────────── -->
    <header class="mb-4">
      <h2 id="titulo-ventas" class="text-h5 font-weight-bold">Historial de ventas</h2>
      <p class="text-body-2 grey--text text--darken-1 mb-0">
        Ventas registradas, de más reciente a más antigua. Clic en una fila para ver el ticket.
      </p>
    </header>

    <!-- ── Error de carga del listado ───────────────────────────── -->
    <v-alert v-if="errorLista" type="error" text class="mb-0" role="alert">
      {{ errorLista }}
      <v-btn small text color="error" class="ml-2" @click="cargar">Reintentar</v-btn>
    </v-alert>

    <!-- ── Tabla ────────────────────────────────────────────────── -->
    <v-card v-if="!errorLista" outlined :aria-busy="cargando ? 'true' : 'false'">
      <v-data-table
        :headers="columnas"
        :items="ventas"
        :items-per-page="porPagina"
        :page="pagina"
        :server-items-length="total"
        :loading="cargando"
        :hide-default-footer="true"
        item-key="id"
        loading-text="Cargando ventas…"
        no-data-text="Todavía no hay ventas registradas"
        aria-label="Listado de ventas"
        @click:row="abrirDetalle"
      >
        <template v-slot:item.createdAt="{ item }">
          <span class="text-no-wrap">{{ formatearFecha(item.createdAt) }}</span>
        </template>

        <template v-slot:item.total="{ item }">
          <div class="text-right font-weight-bold text-no-wrap">
            {{ formatearPrecio(item.total) }}
          </div>
        </template>

        <template v-slot:item.lineas="{ item }">
          <div class="text-right text-no-wrap">
            {{ cantidadLineas(item) }}
          </div>
        </template>

        <template v-slot:item.acciones="{ item }">
          <div class="d-flex justify-end">
            <v-btn
              small
              text
              color="primary"
              :aria-label="`Ver detalle de la venta ${item.id}`"
              @click.stop="abrirDetalle(item)"
            >
              <v-icon left small>mdi-receipt</v-icon>
              Ver detalle
            </v-btn>
          </div>
        </template>

        <template v-slot:no-data>
          <div class="pa-8 text-center">
            <template v-if="cargando">
              <v-progress-circular indeterminate color="primary" width="3"></v-progress-circular>
              <p class="mb-0 mt-4 grey--text text--darken-1">Cargando ventas…</p>
            </template>

            <template v-else>
              <v-icon large color="grey">mdi-receipt</v-icon>
              <p class="mb-1 mt-3 font-weight-medium">Todavía no hay ventas registradas.</p>
              <p class="text-caption grey--text text--darken-1 mb-0">
                Registrá la primera desde la pestaña del punto de venta.
              </p>
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
          aria-label="Ventas por página"
          @change="cambiarPorPagina"
        ></v-select>

        <v-pagination
          :value="pagina"
          :length="paginas"
          :total-visible="7"
          :disabled="cargando"
          color="primary"
          class="ml-2"
          aria-label="Paginación de ventas"
          @input="irAPagina"
        ></v-pagination>
      </div>
    </v-card>

    <!-- ── Diálogo de detalle (ticket) ──────────────────────────── -->
    <v-dialog v-model="dialogoDetalle" max-width="680" scrollable :persistent="cargandoDetalle">
      <v-card>
        <v-card-title class="text-h6 font-weight-bold">
          <v-icon left color="primary">mdi-receipt</v-icon>
          {{ tituloDetalle }}
        </v-card-title>

        <v-divider></v-divider>

        <v-card-text class="pt-4">
          <!-- Cargando -->
          <div v-if="cargandoDetalle" class="pa-8 text-center" role="status">
            <v-progress-circular indeterminate color="primary" width="3"></v-progress-circular>
            <p class="mb-0 mt-4 grey--text text--darken-1">Cargando el detalle de la venta…</p>
          </div>

          <!-- Error -->
          <v-alert v-else-if="errorDetalle" type="error" text class="mb-0" role="alert">
            {{ errorDetalle }}
            <v-btn small text color="error" class="ml-2" @click="cargarDetalle">
              Reintentar
            </v-btn>
          </v-alert>

          <!-- Contenido -->
          <template v-else-if="detalle">
            <div class="d-flex flex-wrap align-start mb-4">
              <div class="mr-auto mb-2">
                <div class="text-caption grey--text text--darken-1">Fecha</div>
                <div class="font-weight-medium">{{ formatearFecha(detalle.createdAt) }}</div>
              </div>
              <div class="text-right">
                <div class="text-caption grey--text text--darken-1">
                  Total — calculado por el servidor
                </div>
                <div class="text-h5 font-weight-bold" data-testid="detalle-total">
                  {{ formatearPrecio(detalle.total) }}
                </div>
              </div>
            </div>

            <v-simple-table dense>
              <template v-slot:default>
                <thead>
                  <tr>
                    <th class="text-left">Producto</th>
                    <th class="text-right">Cantidad</th>
                    <th class="text-right">Precio unitario</th>
                    <th class="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(linea, indice) in detalleLineas" :key="indice">
                    <td class="text-left">
                      <span class="font-weight-medium">Producto {{ linea.producto_id }}</span>
                    </td>
                    <td class="text-right">{{ linea.cantidad }}</td>
                    <td class="text-right">{{ formatearPrecio(linea.precio_unitario) }}</td>
                    <td class="text-right font-weight-medium">
                      {{ formatearPrecio(linea.subtotal) }}
                    </td>
                  </tr>
                </tbody>
              </template>
            </v-simple-table>

            <p v-if="!detalleLineas.length" class="text-body-2 grey--text text--darken-1 mt-4 mb-0">
              Esta venta no tiene líneas asociadas.
            </p>

            <v-alert type="info" text dense class="mt-4 mb-0" icon="mdi-information-outline">
              Los importes de este ticket son los que calculó y persistió el servidor:
              no se rederivan desde el catálogo de productos.
            </v-alert>
          </template>
        </v-card-text>

        <v-card-actions class="px-4 pb-4">
          <v-spacer></v-spacer>
          <v-btn text :disabled="cargandoDetalle" @click="cerrarDetalle">Cerrar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script>
/**
 * VentaLista — historial paginado de ventas + detalle de cada ticket.
 *
 * Arquitectura por capas (docs/ARQUITECTURA.md §3, UC-4):
 *  - NO importa el cliente HTTP ni conoce rutas: todo pasa por la capa de acceso.
 *  - NO contiene lógica de negocio: solo estado local de UI, llamadas a la capa de
 *    acceso y formato de presentación. Los importes mostrados son los del servidor.
 *  - Paginación siempre del lado del servidor (page / limit).
 */

import { ventasApi, mensajeDeError } from '../api';

const formateadorPrecio = new Intl.NumberFormat('es-SV', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formateadorFecha = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default {
  name: 'VentaLista',

  props: {
    /**
     * Contador que App incrementa cuando el terminal registra una venta.
     * Es solo una señal de "hay novedades": el historial se vuelve a pedir
     * a la capa de acceso. No guarda estado de negocio (decisión D5).
     */
    revision: {
      type: Number,
      default: 0,
    },
  },

  data: () => ({
    // Listado paginado por el servidor
    ventas: [],
    total: 0,
    pagina: 1,
    porPagina: 10,
    porPaginaOpciones: [
      { valor: 10, texto: '10 por página' },
      { valor: 20, texto: '20 por página' },
      { valor: 50, texto: '50 por página' },
    ],
    cargando: false,
    errorLista: null,

    // Detalle de una venta
    dialogoDetalle: false,
    ventaSeleccionada: null,
    detalle: null,
    cargandoDetalle: false,
    errorDetalle: null,

    columnas: [
      { text: 'ID', value: 'id', width: '70px', sortable: false },
      { text: 'Fecha', value: 'createdAt', sortable: false },
      { text: 'Total', value: 'total', align: 'end', width: '130px', sortable: false },
      { text: 'Líneas', value: 'lineas', align: 'end', width: '80px', sortable: false },
      { text: '', value: 'acciones', align: 'end', width: '150px', sortable: false },
    ],
  }),

  watch: {
    /** Nueva venta registrada en el terminal → refrescamos el historial. */
    revision() {
      this.cargar();
    },
  },

  computed: {
    paginas() {
      return Math.max(1, Math.ceil(this.total / this.porPagina));
    },

    rango() {
      if (!this.total) return '0 ventas';
      const desde = (this.pagina - 1) * this.porPagina + 1;
      const hasta = Math.min(this.total, this.pagina * this.porPagina);
      return `${desde}–${hasta} de ${this.total} ventas`;
    },

    mostrarPaginacion() {
      return !this.errorLista && this.total > 0;
    },

    tituloDetalle() {
      if (this.ventaSeleccionada) return `Venta #${this.ventaSeleccionada.id}`;
      return 'Detalle de la venta';
    },

    detalleLineas() {
      if (!this.detalle || !Array.isArray(this.detalle.items)) return [];
      return this.detalle.items;
    },
  },

  created() {
    this.cargar();
  },

  methods: {
    /* ── Capa de acceso ────────────────────────────────────────── */

    async cargar() {
      this.cargando = true;
      this.errorLista = null;
      try {
        const respuesta = await ventasApi.listar({
          page: this.pagina,
          limit: this.porPagina,
        });
        this.ventas = Array.isArray(respuesta.data) ? respuesta.data : [];
        this.total = Number(respuesta.meta && respuesta.meta.total) || 0;
      } catch (error) {
        this.ventas = [];
        this.total = 0;
        this.errorLista = mensajeDeError(error, 'No se pudieron cargar las ventas.');
      } finally {
        this.cargando = false;
      }
    },

    async cargarDetalle() {
      if (!this.ventaSeleccionada) return;

      this.cargandoDetalle = true;
      this.errorDetalle = null;
      try {
        this.detalle = await ventasApi.obtenerPorId(this.ventaSeleccionada.id);
      } catch (error) {
        this.detalle = null;
        this.errorDetalle = mensajeDeError(
          error,
          'No se pudo cargar el detalle de la venta.'
        );
      } finally {
        this.cargandoDetalle = false;
      }
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

    /* ── Detalle ───────────────────────────────────────────────── */

    abrirDetalle(venta) {
      this.ventaSeleccionada = venta;
      this.detalle = null;
      this.errorDetalle = null;
      this.dialogoDetalle = true;
      this.cargarDetalle();
    },

    cerrarDetalle() {
      if (this.cargandoDetalle) return;
      this.dialogoDetalle = false;
      this.detalle = null;
      this.errorDetalle = null;
    },

    /* ── Presentación ──────────────────────────────────────────── */

    cantidadLineas(venta) {
      if (Array.isArray(venta.items)) return venta.items.length;
      return '—';
    },

    formatearPrecio(valor) {
      const numero = Number(valor);
      if (!Number.isFinite(numero)) return '—';
      return `$${formateadorPrecio.format(numero)}`;
    },

    formatearFecha(valor) {
      const fecha = new Date(valor);
      if (Number.isNaN(fecha.getTime())) return String(valor || '');
      return formateadorFecha.format(fecha);
    },
  },
};
</script>
