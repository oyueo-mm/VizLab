import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const V8 = readdirSync('src/viz').filter((f) => /^catalogV8.*\.ts$/.test(f)).flatMap((f) => [...readFileSync(`src/viz/${f}`, 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]))

test.describe('mobile: v0.8', () => {
  test('every v0.8 lab fits a phone without sideways page scrolling and shows a chart', async ({ page }) => {
    test.setTimeout(400000)
    expect(V8.length).toBe(20)
    for (const id of V8) {
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

  test('touch: tapping selects in the cone tree and the point sets; legends stay inside the screen in both orientations', async ({ page }) => {
    await page.goto('./#/viz/cone-tree')
    await expect(page.getByTestId('cone-node').first()).toBeVisible({ timeout: 15000 })
    const n = page.getByTestId('cone-node').nth(3)
    await n.scrollIntoViewIfNeeded()
    const b = (await n.boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    await expect(page.locator('.chart-readout')).not.toContainText('선택없음')
    await page.goto('./#/viz/bubble-sets')
    await expect(page.getByTestId('set-point').first()).toBeVisible({ timeout: 15000 })
    const p = (await page.getByTestId('set-point').first().boundingBox())!
    await page.touchscreen.tap(p.x + p.width / 2, p.y + p.height / 2)
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    for (const size of [{ width: 915, height: 412 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(size)
      for (const id of ['nodetrix', 'power-graph', 'rainbow-boxes', 'parallel-tag-clouds']) {
        await page.goto(`./#/viz/${id}`)
        await expect(page.getByTestId('chart-svg'), id).toBeVisible({ timeout: 15000 })
        const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        expect(sw, `${id} ${size.width}x${size.height}`).toBeLessThanOrEqual(iw + 1)
      }
    }
  })

  test('the new home stages and presets work on a phone', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 80')
    for (const id of ['set-regions', 'network-hybrid', 'flow-3d']) {
      await page.goto(`./#/compare/${id}`)
      await expect(page.getByTestId('pane-chart-0').locator('svg').first()).toBeVisible({ timeout: 15000 })
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      expect(sw, id).toBeLessThanOrEqual(iw + 1)
    }
  })
})
