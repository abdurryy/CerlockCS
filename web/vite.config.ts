import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// During development the Go server runs on 7350 and serves the API. Set
// CERLOCK_API to use a server on another address.
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': process.env.CERLOCK_API ?? 'http://127.0.0.1:7350',
    },
  },
  build: {
    // Built into dist/app so dist/.gitkeep survives and go:embed always
    // has a folder to embed, even before the first frontend build.
    outDir: 'dist/app',
    target: 'es2022',
    chunkSizeWarningLimit: 600,
  },
})
