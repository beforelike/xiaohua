import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const webPort = Number(process.env.WEB_PORT ?? 5173)
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': apiTarget,
    },
  },
})
