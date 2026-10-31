import { expect, test } from './fixtures'

const STAGES = ['scatter', 'histogram', 'kde', 'ecdf', 'box', 'violin', 'bar', 'grouped', 'stacked', 'stacked100', 'line', 'area', 'stream', 'treemap', 'sunburst', 'sankey']

/** Records the time at which `data-stage` changes, in ms since the first call. */
async function watchStages(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=hero-demo]')!
    const w = window as any
    w.__stages = [[performance.now(), el.getAttribute('data-stage')]]
    new MutationObserver(() => w.__stages.push([performance.now(), el.getAttribute('data-stage')])).observe(el, { attributes: true, attributeFilter: ['data-stage'] })
  })
}
const stages = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__stages as [number, string][])

test.describe('home animation', () => {
  test('advances about every 1.8 seconds and renders real marks for the current chart', async ({ page }) => {
    await page.goto('./')
    await watchStages(page)
    await expect.poll(async () => (await stages(page)).length, { timeout: 12000 }).toBeGreaterThanOrEqual(5)
    const log = await stages(page)
    const gaps = log.slice(1).map((s, i) => s[0] - log[i][0])
    for (const g of gaps) { expect(g).toBeGreaterThan(1500); expect(g).toBeLessThan(2300) }
    expect(log.map((s) => s[1]).slice(0, 5)).toEqual(STAGES.slice(0, 5))
    // the marks drawn are the chart's own geometry
    const marks = page.getByTestId('hero-marks')
    expect(await marks.locator('*').count()).toBeGreaterThan(100)
  })

  test('walks through all 16 charts and wraps around with new data', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const demo = page.getByTestId('hero-demo')
    const marks = page.getByTestId('hero-marks')
    const sig: string[] = []
    for (let i = 0; i < 16; i++) {
      await expect(demo).toHaveAttribute('data-stage', STAGES[i])
      await expect(page.getByTestId('hero-count')).toHaveText(`${i + 1} / 16`)
      expect(await marks.locator('*').count(), STAGES[i]).toBeGreaterThan(8)
      sig.push(await marks.evaluate((g) => g.innerHTML.length.toString()))
      await page.getByTestId('hero-next').click()
    }
    // after the last chart the loop starts again with the first one (and a fresh dataset)
    await expect(demo).toHaveAttribute('data-stage', 'scatter')
    await expect(marks.locator('circle')).toHaveCount(140)
    await page.getByTestId('hero-prev').click()
    await expect(demo).toHaveAttribute('data-stage', 'sankey')
    expect(new Set(sig).size).toBeGreaterThan(8)
  })

  test('each chart links to its own lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const viz = ['scatter', 'histogram', 'kde', 'ecdf', 'box', 'violin', 'bar', 'grouped-bar', 'stacked-bar', 'stacked-bar-100', 'line', 'area', 'streamgraph', 'treemap', 'sunburst', 'sankey']
    await page.goto('./')
    for (let i = 0; i < 16; i++) {
      await expect(page.getByTestId('hero-link')).toHaveAttribute('href', `#/viz/${viz[i]}`)
      await page.getByTestId('hero-next').click()
    }
    await page.getByTestId('hero-prev').click()
    await page.getByTestId('hero-link').click()
    await expect(page).toHaveURL(/#\/viz\/sankey$/)
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'sankey')
  })

  test('pauses while scrolled out of view and resumes when it is visible again', async ({ page }) => {
    await page.goto('./')
    const demo = page.getByTestId('hero-demo')
    await expect(demo).toHaveAttribute('data-running', '1')
    await page.getByTestId('home').evaluate((el) => { (el.closest('main') as HTMLElement).scrollTo({ top: 5000 }) })
    await expect(demo).toHaveAttribute('data-running', '0')
    const frozen = await demo.getAttribute('data-stage')
    await page.waitForTimeout(2600)
    await expect(demo).toHaveAttribute('data-stage', frozen!)
    await page.getByTestId('home').evaluate((el) => { (el.closest('main') as HTMLElement).scrollTo({ top: 0 }) })
    await expect(demo).toHaveAttribute('data-running', '1')
    await expect(demo).not.toHaveAttribute('data-stage', frozen!, { timeout: 4000 })
  })

  test('pauses while the browser tab is hidden', async ({ page }) => {
    await page.goto('./')
    const demo = page.getByTestId('hero-demo')
    const setHidden = (hidden: boolean) => page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
    await setHidden(true)
    await expect(demo).toHaveAttribute('data-running', '0')
    const frozen = await demo.getAttribute('data-stage')
    await page.waitForTimeout(2600)
    await expect(demo).toHaveAttribute('data-stage', frozen!)
    await setHidden(false)
    await expect(demo).toHaveAttribute('data-running', '1')
    await expect(demo).not.toHaveAttribute('data-stage', frozen!, { timeout: 4000 })
  })

  test('leaving and re-entering home does not stack timers or keep drawing', async ({ page }) => {
    await page.goto('./')
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('nav-catalog').click()
      await expect(page.getByTestId('catalog')).toBeVisible()
      await page.getByTestId('nav-home').click()
      await expect(page.getByTestId('hero-demo')).toBeVisible()
    }
    await watchStages(page)
    await expect.poll(async () => (await stages(page)).length, { timeout: 9000 }).toBeGreaterThanOrEqual(4)
    const log = await stages(page)
    const gaps = log.slice(1).map((s, i) => s[0] - log[i][0])
    // a duplicated timer would halve the interval
    for (const g of gaps) expect(g).toBeGreaterThan(1500)
    // after leaving, nothing keeps changing the DOM of the removed demo
    await page.getByTestId('nav-catalog').click()
    await expect(page.getByTestId('hero-demo')).toHaveCount(0)
  })

  test('keeps smooth frame times while morphing', async ({ page }) => {
    await page.goto('./')
    const stats = await page.evaluate(() => new Promise<{ frames: number; p95: number; max: number }>((resolve) => {
      const deltas: number[] = []
      let last = performance.now()
      const t0 = last
      const tick = (now: number) => {
        deltas.push(now - last)
        last = now
        if (now - t0 < 5400) requestAnimationFrame(tick)
        else { deltas.sort((a, b) => a - b); resolve({ frames: deltas.length, p95: deltas[Math.floor(deltas.length * 0.95)], max: deltas[deltas.length - 1] }) }
      }
      requestAnimationFrame(tick)
    }))
    // headless software rendering: still expect ~60 fps worth of frames and no long stalls
    expect(stats.frames).toBeGreaterThan(200)
    expect(stats.p95).toBeLessThan(40)
    expect(stats.max).toBeLessThan(250)
  })

  test('shows the controls without the old tab strip', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-name')).toHaveText('산점도')
    await expect(page.getByTestId('hero-prev')).toBeVisible()
    await expect(page.getByTestId('hero-next')).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })
})
