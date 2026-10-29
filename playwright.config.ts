import { defineConfig, devices } from '@playwright/test'

const base = 'http://127.0.0.1:4173/VizLab/'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: { baseURL: base, screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: base, reuseExistingServer: !process.env.CI },
})
