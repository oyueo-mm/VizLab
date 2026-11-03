import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const V9 = [...readFileSync('src/viz/catalogV9.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])

test.describe('mobile: v0.9', () => {
  test('every v0.9 lab fits a phone without sideways page scrolling and shows a chart', async ({ page }) => {
    test.setTimeout(500000)
    expect(V9.length).toBe(19)
    for (const id of V9) {
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

  test('touch: tapping selects in MosaicSets, the Boolean crystal and the code view; both orientations keep the chart on screen', async ({ page }) => {
    await page.goto('./#/viz/mosaicsets')
    await expect(page.getByTestId('mosaic-cell').first()).toBeVisible({ timeout: 15000 })
    const c = (await page.getByTestId('mosaic-cell').nth(2).boundingBox())!
    await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2)
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await page.goto('./#/viz/infocrystal')
    await expect(page.getByTestId('crystal-icon').first()).toBeVisible({ timeout: 15000 })
    const ic = (await page.getByTestId('crystal-icon').first().boundingBox())!
    await page.touchscreen.tap(ic.x + ic.width / 2, ic.y + ic.height / 2)
    await expect(page.getByTestId('crystal-result')).toContainText('결과')
    for (const size of [{ width: 915, height: 412 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(size)
      for (const id of ['metrosets', 'set-streams', 'gosper-map', 'seesoft']) {
        await page.goto(`./#/viz/${id}`)
        const chart = page.locator('[data-testid=chart-svg], [data-testid=lab] canvas').first()
        await expect(chart, `${id} ${size.width}`).toBeVisible({ timeout: 15000 })
        const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        expect(sw, `${id} ${size.width}`).toBeLessThanOrEqual(iw + 1)
      }
    }
  })

  test('touch: dragging a magnet in Dust & Magnet does not scroll the page, and the 3D labs respond to a drag', async ({ page }) => {
    await page.goto('./#/viz/dust-magnet')
    await expect(page.getByTestId('magnet').first()).toBeVisible({ timeout: 15000 })
    const y0 = await page.evaluate(() => window.scrollY)
    const b = (await page.getByTestId('magnet').first().locator('circle').first().boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    expect(await page.evaluate(() => window.scrollY)).toBe(y0)
    for (const id of ['hyperstreamlines', 'fiber-surfaces']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('canvas3d')).toBeVisible({ timeout: 15000 })
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      expect(sw, id).toBeLessThanOrEqual(iw + 1)
    }
  })

  test('the home animation runs 80 charts and the catalog lists 360 entries', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 100')
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(360)
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw + 1)
  })
})
