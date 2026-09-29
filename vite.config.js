import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base relativa: o build funciona em https://<usuario>.github.io/<repositorio>/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [react()],
})
