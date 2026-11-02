import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const V10 = [...readFileSync('src/viz/catalogV10.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])

test.describe('mobile: v1.0', () => {
  test('every v1.0 lab fits a phone without sideways page scrolling and shows a chart', async ({ page }) => {
    test.setTimeout(500000)
    expect(V10.length).toBe(20)
    for (const id of V10) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('lab'), id).toHaveAttribute('data-viz', id, { timeout: 15000 })
      const chart = page.locator('[data-testid=chart-svg], [data-testid=lab] canvas').first()
      await expect(chart, id).toBeVisible({ timeout: 15000 })
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      expect(sw, id).toBeLessThanOrEqual(iw + 1)
      const box = (await chart.boundingBox())!
      expect(box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
      expect(box.height, id).toBeGreaterThan(100)
    }
  })

  test('touch: tapping a SpaceTree node opens its children; both orientations keep the chart on screen', async ({ page }) => {
    await page.goto('./#/viz/spacetree')
    await expect(page.getByTestId('st-node').first()).toBeVisible({ timeout: 15000 })
    const before = await page.getByTestId('st-node').count()
    const b = (await page.getByTestId('st-node').nth(1).boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    await expect.poll(async () => page.getByTestId('st-node').count()).toBeGreaterThan(before)
    for (const size of [{ width: 915, height: 412 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(size)
      for (const id of ['bagplot', 'decision-curve', 'contour-boxplot', 'diverging-stacked-bar']) {
        await page.goto(`./#/viz/${id}`)
        const chart = page.locator('[data-testid=chart-svg], [data-testid=lab] canvas').first()
        await expect(chart, `${id} ${size.width}`).toBeVisible({ timeout: 15000 })
        const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        expect(sw, `${id} ${size.width}`).toBeLessThanOrEqual(iw + 1)
      }
    }
  })

  test('the home animation runs 90 charts and the catalog lists 340 entries', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 90')
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(340)
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw + 1)
  })
})
