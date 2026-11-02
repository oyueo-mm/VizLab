import { expect, test } from './fixtures'

const STAGES = ['scatter', 'histogram', 'kde', 'ecdf', 'box', 'violin', 'connected', 'bar', 'grouped', 'stacked', 'stacked100', 'pyramid', 'line', 'area', 'stream', 'horizon', 'treemap', 'sunburst', 'flame', 'sankey', 'network', 'bundle', 'choropleth', 'forest', 'isoline', 'streamline', 'voronoi', 'km', 'renko', 'manhattan', 'phase', 'upset', 'rose', 'venn', 'bifurcation', 'spiral', 'mandelbrot', 'spectral', 'dag', 'flow', 'weibull', 'gsea', 'zipf', 'blockmodel', 'frontier', 'smile', 'acf', 'tolerance', 'queue', 'rama', 'radviz', 'chernoff', 'star', 'tour', 'stacking', 'psets', 'vtreemap', 'qdot', 'hops', 'tcurve', 'lic', 'fdeb', 'story', 'lens', 'bubble', 'nodetrix', 'cone', 'ssurface', 'radial', 'confluent', 'tarcs', 'lflow']

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

  test('walks through all 72 charts and wraps around with new data', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const demo = page.getByTestId('hero-demo')
    const marks = page.getByTestId('hero-marks')
    const sig: string[] = []
    for (let i = 0; i < STAGES.length; i++) {
      await expect(demo).toHaveAttribute('data-stage', STAGES[i])
      await expect(page.getByTestId('hero-count')).toHaveText(`${i + 1} / ${STAGES.length}`)
      await expect.poll(async () => marks.locator('*').count(), { message: STAGES[i], timeout: 8000 }).toBeGreaterThan(8)
      sig.push(await marks.evaluate((g) => g.innerHTML.length.toString()))
      await page.getByTestId('hero-next').click()
    }
    // after the last chart the loop starts again with the first one (and a fresh dataset)
    await expect(demo).toHaveAttribute('data-stage', 'scatter')
    await expect(marks.locator('circle')).toHaveCount(140)
    await page.getByTestId('hero-prev').click()
    await expect(demo).toHaveAttribute('data-stage', 'lflow')
    expect(new Set(sig).size).toBeGreaterThan(10)
  })

  test('each chart links to its own lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const viz = ['scatter', 'histogram', 'kde', 'ecdf', 'box', 'violin', 'connected-scatter', 'bar', 'grouped-bar', 'stacked-bar', 'stacked-bar-100', 'pyramid', 'line', 'area', 'streamgraph', 'horizon', 'treemap', 'sunburst', 'flame', 'sankey', 'network', 'edge-bundling', 'choropleth', 'forest', 'isoline', 'streamline', 'voronoi-map', 'kaplan-meier', 'renko', 'manhattan', 'phase-portrait', 'upset', 'nightingale-rose', 'venn', 'bifurcation', 'spiral-plot', 'mandelbrot-set', 'spectral-embedding', 'dag-layout', 'max-flow', 'weibull-plot', 'gsea-running-sum', 'zipf-plot', 'community-blockmodel', 'efficient-frontier', 'iv-smile', 'acf-plot', 'tolerance-stackup', 'queue-simulation', 'ramachandran', 'radviz', 'chernoff-faces', 'star-coordinates', 'grand-tour', 'dimensional-stacking', 'parallel-sets', 'voronoi-treemap', 'quantile-dotplot', 'hops', 'time-curves', 'line-integral-convolution', 'force-directed-edge-bundling', 'storyline-chart', 'table-lens', 'bubble-sets', 'nodetrix', 'cone-tree', 'stream-surface', 'radial-sets', 'confluent-drawing', 'timearcs', 'lifeflow']
    await page.goto('./')
    for (let i = 0; i < STAGES.length; i++) {
      await expect(page.getByTestId('hero-link')).toHaveAttribute('href', `#/viz/${viz[i]}`)
      await page.getByTestId('hero-next').click()
    }
    await page.getByTestId('hero-prev').click()
    await page.getByTestId('hero-link').click()
    await expect(page).toHaveURL(/#\/viz\/lifeflow$/)
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'lifeflow')
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

  test('looping through the charts repeatedly does not accumulate marks, nodes or listeners', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const marks = page.getByTestId('hero-marks')
    const perStage: number[][] = Array.from({ length: STAGES.length }, () => [])
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < STAGES.length; i++) {
        await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', STAGES[i])
        if (STAGES[i] === 'choropleth') await expect.poll(async () => marks.locator('*').count(), { timeout: 8000 }).toBeGreaterThan(8)
        perStage[i].push(await marks.locator('*').count())
        await page.getByTestId('hero-next').click()
      }
    }
    // marks of a stage may vary a little with the new data of each loop, but they never pile up
    for (let i = 0; i < STAGES.length; i++) expect(Math.max(...perStage[i]), STAGES[i]).toBeLessThan(Math.min(...perStage[i]) * 1.8 + 40)
    const heap = await page.evaluate(() => document.querySelectorAll('[data-testid=hero-marks] *').length)
    expect(heap).toBeLessThan(1500)
    // the demo is the only animated region: leaving the page removes every mark
    await page.getByTestId('nav-compare').click()
    await expect(page.getByTestId('hero-demo')).toHaveCount(0)
  })

  test('the new charts draw their own marks: connected path, pyramid bars, horizon bands and network nodes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const marks = page.getByTestId('hero-marks')
    const at = async (stage: string) => {
      for (let i = 0; i < STAGES.length; i++) {
        if ((await page.getByTestId('hero-demo').getAttribute('data-stage')) === stage) return
        await page.getByTestId('hero-next').click()
      }
    }
    await at('connected')
    await expect(marks.locator('path')).toHaveCount(1)
    await expect(marks.locator('circle')).toHaveCount(18)
    await at('pyramid')
    await expect(marks.locator('rect')).toHaveCount(36)
    await at('horizon')
    expect(await marks.locator('g').count()).toBe(18)
    await at('network')
    expect(await marks.locator('circle').count()).toBeGreaterThanOrEqual(14)
    expect(await marks.locator('line').count()).toBeGreaterThan(14)
    await expect(page.getByTestId('hero-link')).toHaveAttribute('href', '#/viz/network')
  })

  test('the hierarchy and flow data change from loop to loop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const signature = async (stage: string) => {
      for (let i = 0; i < STAGES.length; i++) {
        if ((await page.getByTestId('hero-demo').getAttribute('data-stage')) === stage) break
        await page.getByTestId('hero-next').click()
      }
      return page.getByTestId('hero-marks').evaluate((g) => Array.from(g.querySelectorAll('rect, path')).map((e) => e.getAttribute('width') ?? e.getAttribute('stroke-width') ?? '').join(','))
    }
    const first = await signature('sankey')
    for (let i = 0; i < STAGES.length; i++) await page.getByTestId('hero-next').click()
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'sankey')
    expect(await signature('sankey')).not.toBe(first)
  })

  test('shows the controls without the old tab strip', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-name')).toHaveText('산점도')
    await expect(page.getByTestId('hero-prev')).toBeVisible()
    await expect(page.getByTestId('hero-next')).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })
})
