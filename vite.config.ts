import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from "vite-plugin-mkcert"

// https://vite.dev/config/
export default defineConfig({
  plugins: [mkcert(), react()],
  css: {
    modules: {
      localsConvention: "camelCase",
    },
  },
  server: {
    host: "0.0.0.0",
  },
  worker: {
    format: "es",
    rolldownOptions: {
      output: {
        entryFileNames: "worker.js",
      },
    },
  },
})
