import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // GitHub Pages: https://nikoshdgidhub.github.io/Rocket_Game/
  // → base = '/Rocket_Game/'
  // Если когда-нибудь переедешь на username.github.io (root) — поставь '/'
  base: '/Rocket_Game/',

  resolve: {
    // three@0.150+ поддерживает `three/addons/` только через importmap.
    // Vite должен резолвить это из node_modules — делаем алиас.
    alias: {
      'three/addons/': 'three/examples/jsm/',
    },
  },

  build: {
    rollupOptions: {
      // Две страницы: игра + калькулятор
      input: {
        main: resolve(__dirname, 'index.html'),
        calculator: resolve(__dirname, 'calculator.html'),
      },
    },
  },
})
