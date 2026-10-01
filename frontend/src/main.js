/**
 * Bootstrap de la aplicación POS.
 * Sin vue-router ni store global (decisión D5): una sola vista con tabs de Vuetify
 * y estado local por componente.
 */

import Vue from 'vue';
import Vuetify from 'vuetify';
import 'vuetify/dist/vuetify.min.css';

import App from './App.vue';

Vue.use(Vuetify);
Vue.config.productionTip = false;

const vuetify = new Vuetify({
  theme: {
    options: { customProperties: true },
  },
  icons: {
    iconfont: 'mdi', // Material Design Icons
  },
});

new Vue({
  vuetify,
  render: (h) => h(App),
}).$mount('#app');
