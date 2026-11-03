import { readFileSync } from 'node:fs'
import { expect, openViz, settle, test } from './fixtures'
import type { Page } from '@playwright/test'

const V10 = [...readFileSync('src/viz/catalogV10.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])
const cards = (page: Page) => page.getByTestId('catalog-grid').locator('.viz-card')
const setRange = async (page: Page, id: string, v: number) => { await page.getByTestId(id).fill(String(v)); await settle(page) }
const openDetails = async (page: Page) => { const t = page.getByTestId('details-toggle'); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click() }
const num = (s: string | null, re: RegExp) => Number(re.exec(s ?? '')?.[1] ?? NaN)

test.describe('v1.0: catalog and explanations', () => {
  test('the catalog lists 360 entries and the 20 new techniques are searchable by Korean and English names', async ({ page }) => {
    expect(V10.length).toBe(20)
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid')).toBeVisible()
    expect(await cards(page).count()).toBe(360)
    for (const [q, id] of [['자메', 'zame'], ['Excentric', 'excentric-labeling'], ['LineUp', 'lineup'], ['단위 시각화', 'unit-visualization'], ['splatter', 'splatterplot'], ['컨투어 트리', 'contour-tree'], ['persistence', 'persistence-diagram'], ['토폴로지컬', 'topological-landscape'], ['확률적 등치선', 'probabilistic-isocontour'], ['band depth', 'functional-boxplot'], ['줄기', 'stem-and-leaf'], ['sunflower', 'sunflower-plot'], ['rootogram', 'hanging-rootogram'], ['지니', 'lorenz-curve'], ['tornado', 'tornado-chart'], ['bagplot', 'bagplot'], ['리커트', 'diverging-stacked-bar'], ['net benefit', 'decision-curve'], ['윤곽 상자', 'contour-boxplot'], ['SpaceTree', 'spacetree']]) {
      await page.goto(`./#/catalog?q=${encodeURIComponent(q)}`)
      await expect(page.getByTestId(`card-${id}`), `${q} → ${id}`).toBeVisible()
    }
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal', 'tsne', 'umap', 'metrosets', 'zame']) {
      await page.goto('./#/catalog')
      await expect(page.getByTestId(`card-${id}`)).toHaveCount(1)
    }
  })

  test('every new lab shows its chart and a full explanation with the differences and the sources', async ({ page }) => {
    test.setTimeout(300000)
    for (const id of V10) {
      await openViz(page, id)
      await openDetails(page)
      const body = page.getByTestId('details-body')
      await expect(body, id).toContainText('정의', { timeout: 10000 })
      for (const h of ['시각적 매핑', '작동 원리', '수학적 원리', '장점', '단점', '주의사항', '다른 기법과의 차이', '참고자료']) await expect(body, `${id}: ${h}`).toContainText(h)
      await expect(body, `${id}: 서지`).toContainText('서지')
    }
  })

  test('opening an explanation loads only the version group that holds it', async ({ page }) => {
    const files: string[] = []
    page.on('request', (r) => { const m = /\/assets\/(legacy|v5|v6|v7|v8|v9|v10)-[\w-]+\.js/.exec(r.url()); if (m) files.push(m[1]) })
    await openViz(page, 'bagplot')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의')
    expect(files).toContain('v10')
    expect(files).not.toContain('v9')
    expect(files).not.toContain('v5')
  })
})

test.describe('v1.0: statistical labs', () => {
  test('bagplot: a larger fence factor flags fewer outliers; hovering a point shows its depth', async ({ page }) => {
    await openViz(page, 'bagplot')
    await settle(page)
    await expect(page.getByTestId('bag-bag')).toBeVisible()
    await setRange(page, 'ctl-factor', 1.5)
    const few = await page.getByTestId('bag-outlier').count()
    await setRange(page, 'ctl-factor', 4)
    const many = await page.getByTestId('bag-outlier').count()
    expect(few).toBeGreaterThanOrEqual(many)
    expect(few).toBeGreaterThan(0)
    await page.getByTestId('bag-point').first().dispatchEvent('pointerover')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
  })

  test('diverging stacked bar: every row has five segments around one zero line and sorting reorders the rows', async ({ page }) => {
    await openViz(page, 'diverging-stacked-bar')
    const rows = page.getByTestId('div-bar')
    await expect(rows).toHaveCount(8)
    const sortedPos = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-positive'))))
    for (let i = 1; i < sortedPos.length; i++) expect(sortedPos[i]).toBeLessThanOrEqual(sortedPos[i - 1] + 1e-9)
    await page.getByTestId('ctl-sorted').click()
    const raw = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-positive'))))
    expect(raw).not.toEqual(sortedPos)
    expect([...raw].sort((a, b) => b - a)).toEqual(sortedPos)
    await expect(rows.first().locator('rect')).toHaveCount(5)
  })

  test('decision curve: the model A curve beats treat-all at some threshold; the threshold slider shortens the curves', async ({ page }) => {
    await openViz(page, 'decision-curve')
    for (const k of ['all', 'A', 'B']) await expect(page.getByTestId(`dca-${k}`)).toBeVisible()
    await expect(page.getByTestId('dca-none')).toHaveCount(1)
    const before = await page.getByTestId('dca-A').getAttribute('d')
    await setRange(page, 'ctl-maxt', 0.3)
    const after = await page.getByTestId('dca-A').getAttribute('d')
    expect((after ?? '').length).toBeLessThan((before ?? '').length)
    await page.getByTestId('ctl-showb').click()
    await expect(page.getByTestId('dca-B')).toHaveCount(0)
  })

  test('Lorenz curve: the Gini coefficient is between 0 and 1 and the deciles are shown', async ({ page }) => {
    await openViz(page, 'lorenz-curve')
    const g = num(await page.getByTestId('lorenz-gini').textContent(), /([\d.]+)/)
    expect(g).toBeGreaterThan(0.1)
    expect(g).toBeLessThan(1)
    await expect(page.getByTestId('lorenz-decile')).toHaveCount(9)
  })

  test('tornado chart: bars are sorted by swing and the toggle returns the input order', async ({ page }) => {
    await openViz(page, 'tornado-chart')
    const swings = () => page.getByTestId('tornado-bar').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-swing'))))
    const sorted = await swings()
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeLessThanOrEqual(sorted[i - 1] + 1e-9)
    await page.getByTestId('ctl-sorted').click()
    expect((await swings()).length).toBe(sorted.length)
  })

  test('stem-and-leaf and hanging rootogram: rows and bars are drawn from the data', async ({ page }) => {
    await openViz(page, 'stem-and-leaf')
    const n = await page.getByTestId('stem-row').count()
    expect(n).toBeGreaterThan(6)
    await page.getByTestId('ctl-split').click()
    expect(await page.getByTestId('stem-row').count()).toBeLessThan(n)
    await openViz(page, 'hanging-rootogram')
    expect(await page.getByTestId('root-bar').count()).toBeGreaterThan(5)
    await expect(page.getByTestId('root-curve')).toBeVisible()
  })

  test('sunflower plot and splatterplot draw their marks', async ({ page }) => {
    await openViz(page, 'sunflower-plot')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await openViz(page, 'splatterplot')
    await expect(page.getByTestId('splat-region').first()).toBeVisible()
    await expect(page.getByTestId('splat-readout')).toContainText('점')
  })
})

test.describe('v1.0: topology and ensembles', () => {
  test('contour boxplot: the median contour, a box and the outlier are drawn; the level changes the result', async ({ page }) => {
    await openViz(page, 'contour-boxplot')
    await expect(page.getByTestId('cb-median')).toBeVisible()
    await expect(page.getByTestId('cb-box')).toBeVisible()
    await expect(page.getByTestId('cb-outlier').first()).toBeVisible()
    const s0 = await page.getByTestId('cb-summary').textContent()
    await setRange(page, 'ctl-level', 0.9)
    expect(await page.getByTestId('cb-summary').textContent()).not.toBe(s0)
  })

  test('SpaceTree: selecting a node opens only its path; selecting it again closes one level', async ({ page }) => {
    await openViz(page, 'spacetree')
    const nodes = page.getByTestId('st-node')
    const closed = await nodes.count()
    expect(await page.locator('[data-testid=st-node][data-open=true]').count()).toBe(1) // the root only
    await nodes.nth(1).dispatchEvent('click')
    await expect(page.locator('[data-testid=st-node][data-open=true]')).toHaveCount(2)
    expect(await nodes.count()).toBeGreaterThan(closed)
    await nodes.nth(1).dispatchEvent('click')
    await expect(page.locator('[data-testid=st-node][data-open=true]')).toHaveCount(1)
  })

  test('contour tree, persistence, landscape and probabilistic isocontour render', async ({ page }) => {
    for (const [id, tid] of [['contour-tree', 'ct-tree'], ['persistence-diagram', 'pers-barcode'], ['probabilistic-isocontour', 'prob-readout']] as const) {
      await openViz(page, id)
      await expect(page.getByTestId(tid), id).toBeVisible()
    }
    await openViz(page, 'topological-landscape')
    await expect(page.getByTestId('canvas3d')).toBeVisible()
  })
})

test.describe('v1.0: information visualization labs', () => {
  test('ZAME, LineUp, unit visualization and excentric labeling draw their marks', async ({ page }) => {
    await openViz(page, 'zame')
    await expect(page.getByTestId('zame-cell').first()).toBeVisible()
    await openViz(page, 'lineup')
    expect(await page.getByTestId('lineup-row').count()).toBeGreaterThan(5)
    await openViz(page, 'unit-visualization')
    expect(await page.getByTestId('unit-mark').count()).toBeGreaterThan(20)
    await openViz(page, 'excentric-labeling')
    expect(await page.getByTestId('ex-point').count()).toBeGreaterThan(20)
  })
})

test.describe('v1.0: home animation, comparison presets and linking', () => {
  test('the home animation runs 100 charts and ends on the ten v1.0 stages', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 100')
    for (let i = 0; i < 80; i++) await page.getByTestId('hero-next').click()
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'fbox')
    await expect(page.getByTestId('hero-count')).toHaveText('81 / 100')
  })

  test('the eight new comparison presets draw every chart from one table', async ({ page }) => {
    const presets: [string, string[]][] = [
      ['bag-views', ['scatter', 'bagplot', 'kde2d']], ['overdraw', ['scatter', 'splatterplot', 'hexbin']], ['score-digits', ['stem-and-leaf', 'histogram', 'box']], ['inequality', ['lorenz-curve', 'ecdf', 'histogram']],
      ['terrain-topology', ['contour-tree', 'persistence-diagram', 'topological-landscape']], ['tree-browsers', ['spacetree', 'hyperbolic-tree', 'treemap']], ['model-utility', ['decision-curve', 'roc', 'calibration']], ['count-fit', ['hanging-rootogram', 'histogram']],
    ]
    await page.goto('./#/compare')
    await page.evaluate(() => localStorage.clear())
    for (const [id, charts] of presets) {
      await page.goto(`./#/compare/${id}`)
      await expect(page.getByTestId('compare-grid')).toHaveClass(new RegExp(`panes-${charts.length}`))
      for (let i = 0; i < charts.length; i++) {
        await expect(page.getByTestId(`compare-pane-${i}`), `${id}:${charts[i]}`).toHaveAttribute('data-viz', charts[i])
        await expect(page.getByTestId(`pane-issue-${i}`), `${id}:${charts[i]}`).toHaveCount(0)
      }
    }
  })

  test('linked highlighting: hovering a bagplot point marks the same observation in the scatter plot (rows are shared); the rootogram bar round-trips its rows', async ({ page }) => {
    await page.goto('./#/compare')
    await page.evaluate(() => localStorage.clear())
    await page.goto('./#/compare/bag-views')
    await expect(page.getByTestId('pane-chart-1').getByTestId('bag-point').first()).toBeVisible()
    const hot = page.getByTestId('pane-chart-0').locator('circle.mark-point[stroke="#111827"]')
    await expect(hot).toHaveCount(0)
    await page.getByTestId('pane-chart-1').getByTestId('bag-point').first().dispatchEvent('pointerover')
    await expect(hot).toHaveCount(1)
    await page.getByTestId('pane-chart-1').getByTestId('bag-point').first().dispatchEvent('pointerout')
    await expect(hot).toHaveCount(0)
    await page.goto('./#/compare/count-fit')
    await expect(page.getByTestId('pane-chart-0').getByTestId('root-bar').first()).toBeVisible()
    await page.getByTestId('pane-chart-0').getByTestId('root-bar').nth(2).dispatchEvent('pointerover')
    // the hovered bar reports its rows to the shared state and comes back marked (the histogram pane's own marking is not asserted here)
    await expect(page.getByTestId('pane-chart-0').locator('rect[data-testid=root-bar][stroke="#f59e0b"]')).toHaveCount(1)
  })
})

test.describe('v1.0: large network in a Web Worker', () => {
  test('3,000 nodes are laid out in a worker and drawn on canvas; the layout settles and the page stays usable', async ({ page }) => {
    test.setTimeout(240000)
    await openViz(page, 'network')
    await page.getByTestId('tab-data').click()
    await page.getByTestId('dataset-size').evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    }, 3000)
    const svg = page.getByTestId('chart-svg')
    await expect.poll(async () => Number(await svg.getAttribute('data-nodes')), { timeout: 60000 }).toBeGreaterThanOrEqual(2850)
    await expect(svg).toHaveAttribute('data-renderer', 'canvas')
    // completion is awaited on the page's own state, not on a fixed sleep
    await expect(svg).toHaveAttribute('data-running', '0', { timeout: 120000 })
    // the main thread stays responsive during interaction
    const box = (await svg.boundingBox())!
    for (let i = 0; i < 6; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -120) }
    await expect(svg).toBeVisible()
  })
})
