const { defineConfig } = require('@vue/cli-service');

// @vue/cli-service 5 (webpack 5): compatible con Node moderno, sin el error
// ERR_OSSL_EVP_UNSUPPORTED de Vue CLI 4. Si algun dia aparece, la mitigacion es
// anteponer NODE_OPTIONS=--openssl-legacy-provider a los scripts de package.json.
const PUERTO = Number(process.env.VUE_APP_DEV_SERVER_PORT) || 8080;

module.exports = defineConfig({
  transpileDependencies: ['vuetify'],
  lintOnSave: false,
  productionSourceMap: false,
  devServer: {
    port: PUERTO,
    // El backend expone /api en otro origen (VUE_APP_API_BASE_URL); no hace falta proxy.
    client: {
      overlay: { warnings: false },
    },
  },
});
