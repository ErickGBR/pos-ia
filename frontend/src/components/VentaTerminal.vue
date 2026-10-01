<template>
  <section aria-labelledby="titulo-terminal">
    <!-- ── Cabecera ─────────────────────────────────────────────── -->
    <header class="d-flex flex-wrap align-center mb-4">
      <div class="mr-auto">
        <h2 id="titulo-terminal" class="text-h5 font-weight-bold">Punto de venta</h2>
        <p class="text-body-2 grey--text text--darken-1 mb-0">
          Buscá productos, ajustá precio y cantidad línea por línea y registrá la venta.
        </p>
      </div>
      <v-chip v-if="carrito.length" small outlined color="primary" class="mt-2 mt-sm-0">
        <v-icon left small>mdi-cart</v-icon>
        {{ carrito.length }} {{ carrito.length === 1 ? 'línea' : 'líneas' }}
      </v-chip>
    </header>

    <!-- ── Buscador de productos ────────────────────────────────── -->
    <v-text-field
      v-model="busqueda"
      label="Buscar producto para agregar al carrito"
      placeholder="Nombre o código de barras"
      prepend-inner-icon="mdi-magnify"
      outlined
      dense
      clearable
      hide-details="auto"
      autocomplete="off"
      :disabled="enviando"
      aria-label="Buscar producto para agregar al carrito"
      @input="programarBusqueda"
    />

    <!-- ── Resultados de la búsqueda ────────────────────────────── -->
    <v-card
      v-if="hayBusqueda"
      outlined
      class="mt-3"
      :aria-busy="cargandoProductos ? 'true' : 'false'"
    >
      <v-list v-if="resultados.length" two-line class="py-0">
        <template v-for="(producto, indice) in resultados">
          <v-list-item :key="producto.id" :disabled="enviando">
            <v-list-item-content>
              <v-list-item-title class="font-weight-medium">
                {{ producto.nombre }}
              </v-list-item-title>
              <v-list-item-subtitle>
                Código {{ producto.codigo_barras || '—' }} ·
                precio de referencia {{ formatearPrecio(producto.precio) }}
              </v-list-item-subtitle>
            </v-list-item-content>

            <v-list-item-action>
              <v-btn
                small
                depressed
                color="primary"
                :aria-label="`Agregar ${producto.nombre} al carrito`"
                @click="agregarAlCarrito(producto)"
              >
                <v-icon left small>mdi-plus</v-icon>
                Agregar
              </v-btn>
            </v-list-item-action>
          </v-list-item>
          <v-divider v-if="indice < resultados.length - 1" :key="`div-${producto.id}`" />
        </template>
      </v-list>

      <div v-else-if="cargandoProductos" class="pa-6 text-center" role="status">
        <v-progress-circular indeterminate color="primary" width="3"></v-progress-circular>
        <p class="mb-0 mt-3 grey--text text--darken-1">Buscando productos…</p>
      </div>

      <div v-else class="pa-6 text-center">
        <p class="mb-1 font-weight-medium">Ningún producto coincide con «{{ termino }}».</p>
        <p class="text-caption grey--text text--darken-1 mb-0">
          Probá con otro término o con el código de barras completo.
        </p>
      </div>
    </v-card>

    <v-alert v-if="errorBusqueda" type="error" text dense class="mt-3 mb-0" role="alert">
      {{ errorBusqueda }}
      <v-btn small text color="error" class="ml-2" @click="buscarProductos">Reintentar</v-btn>
    </v-alert>

    <p v-if="!hayBusqueda && !errorBusqueda" class="text-caption grey--text text--darken-1 mt-2 mb-0">
      Escribí un nombre o un código de barras para agregar líneas al carrito.
    </p>

    <!-- ── Carrito ──────────────────────────────────────────────── -->
    <v-card outlined class="mt-4" aria-label="Carrito de la venta en curso">
      <v-card-title class="text-subtitle-1 font-weight-bold pb-2">
        <v-icon left small color="primary">mdi-cart-outline</v-icon>
        Carrito
        <v-spacer></v-spacer>
        <span class="text-caption grey--text text--darken-1 font-weight-normal">
          Precio y cantidad se editan en cada línea
        </span>
      </v-card-title>

      <!-- Encabezado de columnas (solo pantallas medianas en adelante) -->
      <div
        v-if="carrito.length"
        class="d-none d-md-flex cabecera-columnas px-4 pb-1 text-caption grey--text text--darken-1"
        aria-hidden="true"
      >
        <span class="col-producto">Producto</span>
        <span class="col-precio">Precio unitario — editable</span>
        <span class="col-cantidad">Cantidad</span>
        <span class="col-subtotal">Subtotal (preview)</span>
        <span class="col-acciones"></span>
      </div>
      <v-divider v-if="carrito.length"></v-divider>

      <!-- Carrito vacío -->
      <div v-if="!carrito.length" class="pa-8 text-center">
        <v-icon size="48" color="grey lighten-1">mdi-cart-off</v-icon>
        <p class="mb-1 mt-3 font-weight-medium">El carrito está vacío.</p>
        <p class="text-caption grey--text text--darken-1 mb-0">
          Agregá productos desde el buscador de arriba para preparar la venta.
        </p>
      </div>

      <!-- Líneas del carrito -->
      <template v-else>
        <div
          v-for="linea in carrito"
          :key="linea.productoId"
          class="linea-carrito"
          :aria-label="`Línea del carrito: ${linea.nombre}`"
        >
          <div class="col-producto">
            <div class="font-weight-medium">{{ linea.nombre }}</div>
            <div class="text-caption grey--text text--darken-1">
              Código {{ linea.codigoBarras || '—' }}
            </div>
          </div>

          <!-- Precio editable: es un requisito de la venta, por eso va con
               etiqueta explícita, icono de edición y ayuda visible. -->
          <div class="col-precio">
            <v-text-field
              v-model="linea.precioUnitario"
              :rules="reglas.precio"
              label="Precio unitario"
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0"
              prefix="$"
              prepend-inner-icon="mdi-pencil-outline"
              outlined
              dense
              hide-details="auto"
              persistent-hint
              hint="Editable · se congela en la venta"
              :disabled="enviando"
              :aria-label="`Precio unitario editable de ${linea.nombre}`"
            ></v-text-field>
          </div>

          <div class="col-cantidad">
            <v-text-field
              v-model="linea.cantidad"
              :rules="reglas.cantidad"
              label="Cantidad"
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              outlined
              dense
              hide-details="auto"
              persistent-hint
              hint="Mínimo 1"
              :disabled="enviando"
              :aria-label="`Cantidad de ${linea.nombre}`"
            ></v-text-field>
          </div>

          <div class="col-subtotal">
            <div class="text-caption grey--text text--darken-1">Subtotal (preview)</div>
            <div class="font-weight-bold">{{ formatearPrecio(subtotalDe(linea)) }}</div>
          </div>

          <div class="col-acciones">
            <v-tooltip bottom>
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  icon
                  small
                  color="error"
                  v-bind="attrs"
                  v-on="on"
                  :disabled="enviando"
                  :aria-label="`Quitar ${linea.nombre} del carrito`"
                  @click="quitarLinea(linea)"
                >
                  <v-icon small>mdi-delete-outline</v-icon>
                </v-btn>
              </template>
              <span>Quitar del carrito</span>
            </v-tooltip>
          </div>
        </div>
      </template>
    </v-card>

    <!-- ── Total (preview) + registro ───────────────────────────── -->
    <v-card outlined class="mt-4">
      <v-card-text class="pa-4">
        <v-alert v-if="errorVenta" type="error" text dense class="mb-3" role="alert">
          {{ errorVenta }}
        </v-alert>

        <v-alert v-if="ultimaVenta" type="success" text dense class="mb-3" role="status">
          <strong>Venta #{{ ultimaVenta.id }} registrada.</strong>
          Total confirmado por el servidor:
          <strong>{{ formatearPrecio(ultimaVenta.total) }}</strong>
          <span class="text-caption d-block grey--text text--darken-1">
            {{ formatearFecha(ultimaVenta.createdAt) }} · el carrito quedó listo para la siguiente venta.
          </span>
        </v-alert>

        <div class="d-flex flex-wrap align-center">
          <div class="mr-auto">
            <div class="text-caption grey--text text--darken-1">
              Total — previsualización calculada en el cliente
            </div>
            <div class="text-h5 font-weight-bold" data-testid="total-preview">
              {{ formatearPrecio(totalPreview) }}
            </div>
          </div>

          <v-btn
            color="primary"
            depressed
            large
            class="mt-3 mt-sm-0"
            :loading="enviando"
            :disabled="!puedeRegistrar"
            data-testid="registrar-venta"
            @click="registrarVenta"
          >
            <v-icon left>mdi-cash-check</v-icon>
            Registrar venta
          </v-btn>
        </div>

        <p v-if="!carrito.length" class="text-caption grey--text text--darken-1 mt-2 mb-0">
          Agregá al menos un producto para habilitar el registro de la venta.
        </p>
        <p
          v-else-if="!lineasValidas"
          class="text-caption error--text mt-2 mb-0"
          role="alert"
        >
          Revisá las líneas marcadas: la cantidad debe ser un entero mayor a 0 y el precio
          no puede ser negativo.
        </p>

        <v-alert type="info" text dense class="mt-3 mb-0" icon="mdi-information-outline">
          <strong>Previsualización.</strong> El total definitivo lo calcula y confirma el
          servidor al registrar la venta: puede diferir de esta suma y el valor autoritativo
          es el que devuelve el backend.
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script>
/**
 * VentaTerminal — punto de venta: buscador + carrito con precio editable por línea.
 *
 * Arquitectura por capas (docs/ARQUITECTURA.md §3):
 *  - NO importa el cliente HTTP ni conoce rutas: todo pasa por la capa de acceso.
 *  - NO contiene lógica de negocio: el único cálculo que hace es la PREVISUAL del
 *    total (suma de cantidad × precio de cada línea). El total autoritativo lo
 *    calcula el Stored Procedure del backend y es lo que se muestra al confirmar.
 *  - Estado 100 % local (decisión D5: sin store global).
 *
 * Errores que sabe interpretar: 400 (carrito/cantidad/precio inválidos),
 * 404 (producto inexistente) y 409 (conflicto del Stored Procedure, se muestra
 * tal como lo devuelve el servidor).
 */

import { productosApi, ventasApi, mensajeDeError } from '../api';

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

/** Duración del debounce del buscador de productos (ms). */
const DEBOUNCE_BUSQUEDA = 300;

/** Cantidad de resultados que trae cada búsqueda. */
const LIMITE_RESULTADOS = 10;

export default {
  name: 'VentaTerminal',

  data: () => ({
    // Buscador
    busqueda: '',
    termino: '',
    resultados: [],
    cargandoProductos: false,
    errorBusqueda: null,
    temporizadorBusqueda: null,

    // Carrito: cada línea guarda el precio tal como se edita en la UI
    carrito: [],

    // Registro de la venta
    enviando: false,
    errorVenta: null,
    ultimaVenta: null,

    reglas: {
      // Validación de formulario (requerido / tipo). La regla de negocio vive en
      // el backend: acá solo guiamos al usuario antes de enviar.
      precio: [
        (valor) =>
          (valor !== null && valor !== undefined && String(valor).trim() !== '') ||
          'Ingresá el precio.',
        (valor) =>
          (Number.isFinite(Number(valor)) && Number(valor) >= 0) ||
          'Usá un precio igual o mayor a 0.',
      ],
      cantidad: [
        (valor) =>
          (valor !== null && valor !== undefined && String(valor).trim() !== '') ||
          'Ingresá la cantidad.',
        (valor) =>
          (Number.isInteger(Number(valor)) && Number(valor) > 0) ||
          'Debe ser un entero mayor a 0.',
      ],
    },
  }),

  computed: {
    hayBusqueda() {
      return this.termino.length > 0;
    },

    /** Ninguna línea con precio o cantidad inválidos. */
    lineasValidas() {
      return this.carrito.every(
        (linea) =>
          Number.isInteger(Number(linea.cantidad)) && Number(linea.cantidad) > 0 &&
          Number.isFinite(Number(linea.precioUnitario)) && Number(linea.precioUnitario) >= 0
      );
    },

    /** Habilita el botón de registro: hay líneas y todas son válidas. */
    puedeRegistrar() {
      return !this.enviando && this.carrito.length > 0 && this.lineasValidas;
    },

    /**
     * PREVISUAL del total (único cálculo permitido en el componente).
     * No es el total de la venta: el autoritativo lo devuelve el servidor.
     */
    totalPreview() {
      return this.carrito.reduce((suma, linea) => {
        const cantidad = Number(linea.cantidad);
        const precio = Number(linea.precioUnitario);
        if (!Number.isFinite(cantidad) || !Number.isFinite(precio)) return suma;
        return suma + cantidad * precio;
      }, 0);
    },
  },

  beforeDestroy() {
    clearTimeout(this.temporizadorBusqueda);
  },

  methods: {
    /* ── Buscador de productos ─────────────────────────────────── */

    programarBusqueda() {
      clearTimeout(this.temporizadorBusqueda);
      this.temporizadorBusqueda = setTimeout(() => this.buscarProductos(), DEBOUNCE_BUSQUEDA);
    },

    async buscarProductos() {
      clearTimeout(this.temporizadorBusqueda);
      const termino = (this.busqueda || '').trim();
      this.termino = termino;
      this.errorBusqueda = null;
      this.resultados = [];
      if (!termino) {
        this.cargandoProductos = false;
        return;
      }

      this.cargandoProductos = true;
      try {
        const respuesta = await productosApi.listar({
          q: termino,
          page: 1,
          limit: LIMITE_RESULTADOS,
        });
        // Descarta respuestas de búsquedas que el usuario ya superó.
        if (this.termino !== termino) return;
        this.resultados = Array.isArray(respuesta.data) ? respuesta.data : [];
      } catch (error) {
        if (this.termino !== termino) return;
        this.errorBusqueda = mensajeDeError(error, 'No se pudieron buscar productos.');
      } finally {
        if (this.termino === termino) this.cargandoProductos = false;
      }
    },

    /* ── Carrito ───────────────────────────────────────────────── */

    agregarAlCarrito(producto) {
      const existente = this.carrito.find((linea) => linea.productoId === producto.id);
      if (existente) {
        existente.cantidad = String(Number(existente.cantidad) + 1);
        return;
      }
      const precio = Number(producto.precio);
      this.carrito.push({
        productoId: producto.id,
        nombre: producto.nombre,
        codigoBarras: producto.codigo_barras || '',
        // Por defecto, el precio vigente del producto (D3): es solo un sugerido,
        // la línea se puede editar antes de confirmar la venta.
        precioUnitario: Number.isFinite(precio) ? precio.toFixed(2) : '0.00',
        cantidad: '1',
      });
      this.ultimaVenta = null;
      this.errorVenta = null;
    },

    quitarLinea(linea) {
      const indice = this.carrito.indexOf(linea);
      if (indice > -1) this.carrito.splice(indice, 1);
    },

    /* ── Registro de la venta ──────────────────────────────────── */

    async registrarVenta() {
      if (!this.puedeRegistrar) return;

      this.enviando = true;
      this.errorVenta = null;
      this.ultimaVenta = null;

      const items = this.carrito.map((linea) => ({
        productoId: linea.productoId,
        cantidad: Number(linea.cantidad),
        precioUnitario: Number(linea.precioUnitario),
      }));

      try {
        // El backend responde 201 con la venta ya calculada por el SP.
        const venta = await ventasApi.registrar(items);
        this.ultimaVenta = venta;
        this.carrito = [];
        this.busqueda = '';
        this.termino = '';
        this.resultados = [];
        // Avisa al layout para que el historial se refresque (solo señal).
        this.$emit('venta-registrada', venta);
      } catch (error) {
        const porDefecto =
          error && error.status === 409
            ? 'El servidor rechazó la venta por un conflicto; no se registró ningún cambio.'
            : 'No se pudo registrar la venta. Verificá los datos e intentá de nuevo.';
        // En 409 mandamos el mensaje tal como lo devolvió el servidor.
        this.errorVenta = mensajeDeError(error, porDefecto);
      } finally {
        this.enviando = false;
      }
    },

    /* ── Presentación ──────────────────────────────────────────── */

    subtotalDe(linea) {
      const cantidad = Number(linea.cantidad);
      const precio = Number(linea.precioUnitario);
      if (!Number.isFinite(cantidad) || !Number.isFinite(precio)) return 0;
      return cantidad * precio;
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

<style scoped>
/* Filas del carrito: en pantallas chicas se apilan, en grandes forman columnas
   para que el precio editable tenga ancho propio y sea fácil de usar. */
.linea-carrito {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.linea-carrito:last-child {
  border-bottom: 0;
}

.col-producto {
  flex: 1 1 180px;
  min-width: 150px;
  padding-top: 8px;
}

.col-precio {
  flex: 0 1 185px;
  min-width: 160px;
}

.col-cantidad {
  flex: 0 1 135px;
  min-width: 120px;
}

.col-subtotal {
  flex: 0 1 150px;
  min-width: 120px;
  text-align: right;
  padding-top: 8px;
}

.col-acciones {
  flex: 0 0 40px;
  padding-top: 8px;
}

.cabecera-columnas > span {
  box-sizing: border-box;
  padding-right: 12px;
}

.cabecera-columnas .col-producto {
  flex: 1 1 180px;
  min-width: 150px;
  padding-top: 0;
}

.cabecera-columnas .col-precio {
  flex: 0 1 185px;
  min-width: 160px;
}

.cabecera-columnas .col-cantidad {
  flex: 0 1 135px;
  min-width: 120px;
}

.cabecera-columnas .col-subtotal {
  flex: 0 1 150px;
  min-width: 120px;
  padding-top: 0;
}

.cabecera-columnas .col-acciones {
  flex: 0 0 40px;
  padding-top: 0;
}
</style>
