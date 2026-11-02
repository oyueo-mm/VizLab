import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/VizLab/',
  plugins: [react(), tailwindcss()],
  // d3 + React + 20 chart modules; KaTeX is split into the lazily loaded details chunk.
  // React is split into its own chunk: it changes rarely, so a returning visitor keeps it cached across deployments of the app code.
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'react-vendor', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ }] } } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
