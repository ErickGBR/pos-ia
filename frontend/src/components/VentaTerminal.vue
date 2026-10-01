<template>
  <v-card outlined>
    <v-card-title class="text-h6 font-weight-bold pb-2">
      <v-icon left color="primary">mdi-cash-register</v-icon>
      Terminal de ventas
    </v-card-title>

    <v-card-text class="text-center py-8">
      <v-icon size="56" color="grey lighten-1">mdi-cart-outline</v-icon>
      <p class="text-h6 mt-4 mb-1">Próximamente</p>
      <p class="text-body-2 grey--text text--darken-1 mb-0">
        El carrito con precio editable por línea y el cobro se habilitan en la
        siguiente iteración. La venta se registrará contra el procedimiento
        almacenado del backend (el total siempre lo calcula él).
      </p>
    </v-card-text>
  </v-card>
</template>

<script>
/**
 * VentaTerminal — placeholder funcional del punto de venta (carrito + cobro).
 * Implementación completa a cargo de otra agente; por ahora solo renderiza
 * el estado "próximamente" sin romper el build ni ocupar la capa api/.
 */
export default {
  name: 'VentaTerminal',
};
</script>
