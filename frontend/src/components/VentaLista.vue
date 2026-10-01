<template>
  <v-card outlined>
    <v-card-title class="text-h6 font-weight-bold pb-2">
      <v-icon left color="primary">mdi-receipt</v-icon>
      Historial de ventas
    </v-card-title>

    <v-card-text class="text-center py-8">
      <v-icon size="56" color="grey lighten-1">mdi-file-document-outline</v-icon>
      <p class="text-h6 mt-4 mb-1">Próximamente</p>
      <p class="text-body-2 grey--text text--darken-1 mb-0">
        El listado paginado de ventas y el detalle de cada ticket se muestran
        acá cuando se habilite la pestaña de ventas.
      </p>
    </v-card-text>
  </v-card>
</template>

<script>
/**
 * VentaLista — placeholder funcional del historial de ventas.
 * Implementación completa a cargo de otra agenta; por ahora solo renderiza
 * el estado "próximamente" sin romper el build ni ocupar la capa api/.
 */
export default {
  name: 'VentaLista',
};
</script>
