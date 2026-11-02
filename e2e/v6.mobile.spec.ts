import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const V6 = readdirSync('src/viz').filter((f) => /^catalogV6.+\.ts$/.test(f)).flatMap((f) => [...readFileSync(`src/viz/${f}`, 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]))

test.describe('mobile: v0.6', () => {
  test('every v0.6 lab fits a phone without sideways page scrolling and shows a chart', async ({ page }) => {
    test.setTimeout(400000)
    for (const id of V6) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('lab'), id).toHaveAttribute('data-viz', id, { timeout: 15000 })
      const chart = page.locator('[data-testid=chart-svg], [data-testid=lab] canvas').first()
      await expect(chart, id).toBeVisible({ timeout: 15000 })
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      expect(sw, id).toBeLessThanOrEqual(iw + 1)
      const box = (await chart.boundingBox())!
      expect(box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
      expect(box.height, id).toBeGreaterThan(120)
    }
  })

  test('the new categories fit the phone catalog and the comparison presets open', async ({ page }) => {
    await page.goto('./#/catalog/industry')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(5)
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw + 1)
    await page.goto('./#/compare/communities')
    await expect(page.getByTestId('pane-chart-0').locator('svg').first()).toBeVisible({ timeout: 15000 })
  })
})
