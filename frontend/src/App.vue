<template>
  <v-app>
    <v-app-bar color="primary" dark elevation="2" app>
      <v-icon left class="mr-2">mdi-storefront</v-icon>
      <v-toolbar-title class="font-weight-bold">POS Básico</v-toolbar-title>
      <v-spacer></v-spacer>
      <span class="text-caption d-none d-sm-flex">Productos y ventas</span>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <!-- Layout único: dos tabs (decisión D5 — sin vue-router) -->
        <v-tabs v-model="tabActivo" grow centered color="primary" height="52">
          <v-tab>
            <v-icon left>mdi-package-variant-closed</v-icon>
            Productos
          </v-tab>
          <v-tab>
            <v-icon left>mdi-cash-register</v-icon>
            Ventas
          </v-tab>
        </v-tabs>

        <v-tabs-items v-model="tabActivo" class="transparent">
          <v-tab-item eager>
            <div class="pa-4 pa-md-6">
              <producto-lista />
            </div>
          </v-tab-item>

          <v-tab-item>
            <div class="pa-4 pa-md-6">
              <v-row>
                <v-col cols="12" lg="7">
                  <venta-terminal @venta-registrada="revisionVentas += 1" />
                </v-col>
                <v-col cols="12" lg="5">
                  <venta-lista :revision="revisionVentas" />
                </v-col>
              </v-row>
            </div>
          </v-tab-item>
        </v-tabs-items>
      </v-container>
    </v-main>

    <v-footer app padless color="surface" class="text-caption grey--text text--darken-1">
      <v-container fluid class="d-flex align-center py-2">
        <span>POS Básico — Vue 2 · Vuetify 2 · Axios</span>
        <v-spacer></v-spacer>
        <span class="d-none d-sm-inline">API: {{ baseApi }}</span>
      </v-container>
    </v-footer>
  </v-app>
</template>

<script>
import ProductoLista from './components/ProductoLista.vue';
import VentaTerminal from './components/VentaTerminal.vue';
import VentaLista from './components/VentaLista.vue';
import { BASE_URL } from './api';

/**
 * Layout único de la vista POS: header + tabs [Productos | Ventas].
 * Solo orquesta presentación; toda llamada HTTP vive en la capa de acceso.
 * `revisionVentas` es un simple contador de novedades (no estado de negocio):
 * al registrar una venta se lo incrementa para que el historial se refresque.
 */
export default {
  name: 'App',
  components: { ProductoLista, VentaTerminal, VentaLista },
  data: () => ({
    tabActivo: 0,
    baseApi: BASE_URL,
    revisionVentas: 0,
  }),
};
</script>
