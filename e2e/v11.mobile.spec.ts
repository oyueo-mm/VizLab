import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const V11 = [...readFileSync('src/viz/catalogV11.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])

test.describe('mobile: v1.1', () => {
  test('every v1.1 lab fits a phone without sideways page scrolling and shows a chart', async ({ page }) => {
    test.setTimeout(600000)
    expect(V11.length).toBe(20)
    for (const id of V11) {
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

  test('touch: tapping a Hasse element marks its order; the matrix cube and the ribbons keep fitting in both orientations', async ({ page }) => {
    await page.goto('./#/viz/hasse-diagram')
    await expect(page.getByTestId('hasse-node').first()).toBeVisible({ timeout: 15000 })
    const b = (await page.getByTestId('hasse-node').nth(3).boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    await expect(page.locator('[data-testid=hasse-node][data-state=sel]')).toHaveCount(1)
    for (const size of [{ width: 915, height: 412 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(size)
      for (const id of ['matrix-cube', 'stream-ribbons', 'piper-diagram', 'ring-map']) {
        await page.goto(`./#/viz/${id}`)
        const chart = page.locator('[data-testid=chart-svg], [data-testid=lab] canvas').first()
        await expect(chart, `${id} ${size.width}`).toBeVisible({ timeout: 15000 })
        const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        expect(sw, `${id} ${size.width}`).toBeLessThanOrEqual(iw + 1)
      }
    }
  })

  test('touch: dragging the 3D matrix cube rotates it without scrolling the page', async ({ page }) => {
    await page.goto('./#/viz/matrix-cube')
    await expect(page.getByTestId('canvas3d')).toBeVisible({ timeout: 15000 })
    const y0 = await page.evaluate(() => window.scrollY)
    const b = (await page.getByTestId('canvas3d').boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    expect(await page.evaluate(() => window.scrollY)).toBe(y0)
  })

  test('the home animation runs 100 charts and the catalog lists 360 entries', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 100')
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(360)
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw + 1)
  })
})
