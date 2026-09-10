import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // PaddleOCR resolves its packaged module worker relative to its own ESM entry.
    exclude: ['@paddleocr/paddleocr-js'],
    include: ['@techstark/opencv-js', 'clipper-lib', 'js-yaml'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.ts', 'benchmark/**/*.spec.ts'],
  },
})
