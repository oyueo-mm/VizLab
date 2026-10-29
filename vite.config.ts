import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/VizLab/',
  plugins: [react(), tailwindcss()],
  // d3 + React + 20 chart modules; KaTeX is split into the lazily loaded details chunk.
  build: { chunkSizeWarningLimit: 600 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
