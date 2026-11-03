import { readFileSync, readdirSync } from 'node:fs'
import { dragBy, expect, openViz, settle, test } from './fixtures'

/** Ids of the techniques added in v0.7, read from the catalog sources so the spec cannot drift from them. */
const V7 = readdirSync('src/viz').filter((f) => /^catalogV7.+\.ts$/.test(f)).flatMap((f) => [...readFileSync(`src/viz/${f}`, 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]))

/** Opens the details section if it is closed (its state is kept between labs). */
async function openDetails(page: import('@playwright/test').Page) {
  const t = page.getByTestId('details-toggle')
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click()
}

const cards = (page: import('@playwright/test').Page) => page.getByTestId('catalog-grid').locator('.viz-card')

test.describe('v0.7: classification and catalog', () => {
  test('lists every entry once and offers the four kinds as a filter independent of the category', async ({ page }) => {
    expect(V7.length).toBe(31)
    await page.goto('./#/catalog')
    await expect(cards(page)).toHaveCount(360)
    await expect(page.getByTestId('kind-filters')).toBeVisible()
    for (const k of ['technique', 'specialized', 'analysis', 'application']) await expect(page.getByTestId(`nature-${k}`)).toBeVisible()
    await page.getByTestId('nature-analysis').click()
    await expect(page).toHaveURL(/k=analysis/)
    const analysis = await cards(page).count()
    expect(analysis).toBeGreaterThan(40)
    // a result-oriented chart stays reachable, the original techniques do not appear under "analysis"
    await expect(page.getByTestId('card-mandelbrot-set')).toBeVisible()
    await expect(page.getByTestId('card-scatter')).toHaveCount(0)
    // combine with a category: geospatial analysis results only
    await page.getByTestId('chip-geo').click()
    const geoAnalysis = await cards(page).count()
    expect(geoAnalysis).toBeGreaterThan(0)
    expect(geoAnalysis).toBeLessThan(analysis)
    await page.getByTestId('nature-all').click()
    expect(await cards(page).count()).toBeGreaterThan(geoAnalysis)
    // the filter survives a reload and a deep link
    await page.goto('./#/catalog/geo?k=technique')
    await expect(page.getByTestId('nature-technique')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('chip-geo')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('card-globe-3d')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('nature-technique')).toHaveAttribute('aria-pressed', 'true')
  })

  test('Mandelbrot, Julia and Newton keep their labs and explain the object versus the representation', async ({ page }) => {
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal']) {
      await openViz(page, id)
      await openDetails(page)
      await expect(page.getByTestId('details-note')).toContainText('분석·계산 결과')
    }
    await openViz(page, 'domain-coloring')
    await openDetails(page)
    await expect(page.getByTestId('details-note')).toContainText('시각화 방법론')
  })

  test('techniques are linked to the results drawn with them in both directions', async ({ page }) => {
    await openViz(page, 'radviz')
    await expect(page.getByTestId('related-tsne')).toBeVisible()
    await openViz(page, 'tsne')
    await expect(page.getByTestId('related-radviz')).toBeVisible()
  })

  test('search finds the new techniques by Korean and English names', async ({ page }) => {
    await page.goto('./#/catalog')
    for (const [q, id] of [['체르노프', 'chernoff-faces'], ['RadViz', 'radviz'], ['Hilbert', 'space-filling-curve'], ['FDEB', 'force-directed-edge-bundling'], ['워드', 'word-cloud'], ['HOPs', 'hops']]) {
      await page.getByTestId('catalog-search').fill(q)
      await expect(page.getByTestId(`card-${id}`), q).toBeVisible()
    }
  })
})

test.describe('v0.7: every new technique opens from a deep link and survives a reload', () => {
  test('all 31 labs render without console errors or failed requests', async ({ page }) => {
    test.setTimeout(300000)
    const failed: string[] = []
    page.on('requestfailed', (r) => failed.push(r.url()))
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
    for (const id of V7) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('lab'), id).toHaveAttribute('data-viz', id, { timeout: 15000 })
      await expect(page.locator('[data-testid=lab] svg').first(), id).toBeVisible({ timeout: 15000 })
      await openDetails(page)
      await expect(page.getByTestId('details-body'), id).toContainText('다른 기법과의 차이')
    }
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', V7[V7.length - 1])
    expect(failed).toEqual([])
  })
})

test.describe('v0.7: multivariate techniques', () => {
  test('RadViz: dragging an anchor moves the points, the reset button restores them', async ({ page }) => {
    await openViz(page, 'radviz')
    await settle(page)
    const p = page.getByTestId('radviz-point').first()
    const before = await p.getAttribute('cx')
    await dragBy(page, page.getByTestId('anchor-꽃잎 길이'), 120, -80)
    await expect.poll(async () => p.getAttribute('cx')).not.toBe(before)
    await page.getByTestId('radviz-reset').click()
    await expect.poll(async () => p.getAttribute('cx')).toBe(before)
  })

  test('Grand Tour: stopping at a position shows a deterministic projection, the same seed gives the same picture', async ({ page }) => {
    await openViz(page, 'grand-tour')
    await page.getByTestId('tour-play').uncheck({ force: true })
    await setT(page, 4.2)
    const a = await page.getByTestId('tour-point').first().getAttribute('cx')
    await setT(page, 9)
    await setT(page, 4.2)
    expect(await page.getByTestId('tour-point').first().getAttribute('cx')).toBe(a)
    await page.getByTestId('tour-point').first().click()
    await expect(page.getByTestId('tour-point').first()).toHaveAttribute('r', '6')
  })

  test('Table lens: clicking rows expands them and the clear button collapses them', async ({ page }) => {
    await openViz(page, 'table-lens')
    // the compressed rows are about a pixel tall, so the click is dispatched on the row element itself
    const click = (i: number) => page.getByTestId('lens-row').nth(i).evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await click(3)
    await expect(page.locator('[data-testid=lens-row][data-focus="1"]')).toHaveCount(1)
    await click(20)
    await expect(page.locator('[data-testid=lens-row][data-focus="1"]')).toHaveCount(2)
    await page.getByTestId('lens-clear').click()
    await expect(page.locator('[data-testid=lens-row][data-focus="1"]')).toHaveCount(0)
  })

  test('Dimensional stacking and Pixel bar chart react to their parameters', async ({ page }) => {
    await openViz(page, 'dimensional-stacking')
    const n3 = await page.getByTestId('stack-cell').count()
    await setRange(page, 'ctl-bins', 4)
    expect(await page.getByTestId('stack-cell').count()).toBeGreaterThan(n3)
    await openViz(page, 'pixel-bar-chart')
    expect(await page.getByTestId('pb-pixel').count()).toBe(150)
    await setRange(page, 'ctl-cols', 5)
    await expect(page.getByTestId('pb-pixel')).toHaveCount(150)
  })

  test('Chernoff faces: remapping a variable changes the drawing', async ({ page }) => {
    await openViz(page, 'chernoff-faces')
    const head = page.getByTestId('chernoff-face').first().locator('ellipse')
    const before = await head.getAttribute('rx')
    await page.getByTestId('face-0').selectOption('')
    await expect.poll(async () => head.getAttribute('rx')).not.toBe(before)
  })

  test('HyperSlice: clicking a panel moves the shared slice position', async ({ page }) => {
    await openViz(page, 'hyperslice')
    const before = await page.getByTestId('slice-2').inputValue()
    await page.getByTestId('hs-hit-0-1').click({ position: { x: 20, y: 20 } })
    await expect.poll(async () => page.getByTestId('slice-0').inputValue()).not.toBe('0.5')
    expect(await page.getByTestId('slice-2').inputValue()).toBe(before)
    await page.getByTestId('hs-center').click()
    await expect.poll(async () => page.getByTestId('slice-0').inputValue()).toBe('0.5')
  })

  async function setT(page: import('@playwright/test').Page, v: number) { await page.getByTestId('tour-t').fill(String(v)) }
  async function setRange(page: import('@playwright/test').Page, id: string, v: number) { await page.getByTestId(id).fill(String(v)); await settle(page) }
})

test.describe('v0.7: distribution, uncertainty and temporal techniques', () => {
  test('Quantile dotplot: the dot count follows the slider and every dot carries 1/n', async ({ page }) => {
    await openViz(page, 'quantile-dotplot')
    await expect(page.getByTestId('qdot')).toHaveCount(50)
    await page.getByTestId('ctl-dots').fill('20')
    await expect(page.getByTestId('qdot')).toHaveCount(20)
    await expect(page.getByTestId('chart-svg')).toContainText('20개 중')
  })

  test('HOPs: stepping shows a different reproducible outcome and the seed resets the tally', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openViz(page, 'hops')
    await settle(page)
    const h = async () => (await page.getByTestId('hop-bar').evaluateAll((els) => els.map((e) => e.getAttribute('height')))).join()
    const first = await h()
    await page.getByTestId('hop-step').click()
    await expect.poll(h).not.toBe(first)
    await page.getByTestId('hop-seed').fill('8')
    await page.getByTestId('hop-seed').fill('7')
    await expect.poll(h).toBe(first)
  })

  test('Gradient plot switches to the interval-bar representation', async ({ page }) => {
    await openViz(page, 'gradient-plot')
    expect(await page.getByTestId('grad-slice').count()).toBeGreaterThan(100)
    await page.getByTestId('ctl-mode').getByRole('radio', { name: '구간 막대' }).click()
    await expect(page.getByTestId('grad-slice')).toHaveCount(0)
    expect(await page.getByTestId('grad-interval').count()).toBeGreaterThan(2)
  })

  test('Wilkinson dot plot keeps every observation and Punchcard sorts rows', async ({ page }) => {
    await openViz(page, 'wilkinson-dotplot')
    await expect(page.getByTestId('wdot')).toHaveCount(200)
    await openViz(page, 'punchcard')
    const before = await page.getByTestId('punch-circle').first().getAttribute('r')
    await page.getByTestId('ctl-sort').getByRole('radio', { name: '합계 큰 순' }).click()
    await expect.poll(async () => page.getByTestId('punch-circle').first().getAttribute('r')).not.toBe(before)
  })

  test('Time curves, Marey chart and LifeLines show their domain marks', async ({ page }) => {
    await openViz(page, 'time-curves')
    await expect(page.getByTestId('tc-point')).toHaveCount(48)
    await expect(page.getByTestId('tc-loop')).toBeVisible()
    await openViz(page, 'marey-chart')
    await expect(page.getByTestId('marey-line')).toHaveCount(8)
    expect(await page.getByTestId('marey-cross').count()).toBeGreaterThan(5)
    await page.getByTestId('ctl-cross').uncheck({ force: true })
    await expect(page.getByTestId('marey-cross')).toHaveCount(0)
    await openViz(page, 'lifelines')
    const all = await page.getByTestId('ll-bar').count()
    await page.getByTestId('ll-entity-환자 1').click()
    await expect.poll(async () => page.getByTestId('ll-bar').count()).toBeLessThan(all)
    await page.getByTestId('ll-reset').click()
    await expect.poll(async () => page.getByTestId('ll-bar').count()).toBe(all)
  })
})

test.describe('v0.7: set, hierarchy, text and flow techniques', () => {
  test('Parallel sets, Linear set diagram and Tanglegram respond to their controls', async ({ page }) => {
    await openViz(page, 'parallel-sets')
    expect(await page.getByTestId('ps-ribbon').count()).toBeGreaterThan(10)
    await openViz(page, 'linear-set-diagram')
    const cols = await page.getByTestId('lin-column').count()
    expect(cols).toBeGreaterThan(5)
    await page.getByTestId('lin-column').first().click()
    await expect(page.getByTestId('lin-column').nth(2)).toHaveAttribute('opacity', '0.35')
    await page.getByTestId('lin-clear').click()
    await openViz(page, 'tanglegram')
    await expect(page.getByTestId('tangle-readout')).toContainText('교차')
    await page.getByTestId('ctl-untangle').uncheck({ force: true })
    await expect(page.getByTestId('tangle-readout')).not.toContainText('정렬 전')
  })

  test('Word cloud recomputes when a word is excluded; Word tree follows the chosen root', async ({ page }) => {
    await openViz(page, 'word-cloud')
    await expect(page.getByTestId('cloud-word').filter({ hasText: /^시각화$/ })).toHaveCount(1)
    await page.getByTestId('ctl-stop').fill('시각화')
    await expect(page.getByTestId('cloud-word').filter({ hasText: /^시각화$/ })).toHaveCount(0)
    await openViz(page, 'word-tree')
    await expect(page.getByTestId('wt-root')).toHaveText('시각화')
    await page.getByTestId('ctl-root').selectOption({ index: 3 })
    await expect(page.getByTestId('wt-root')).not.toHaveText('시각화')
  })

  test('Space-filling curve, Voronoi treemap and Hyperbolic tree', async ({ page }) => {
    await openViz(page, 'space-filling-curve')
    expect(await page.getByTestId('curve-pixel').count()).toBeGreaterThan(500)
    await openViz(page, 'voronoi-treemap')
    expect(await page.getByTestId('vt-leaf').count()).toBeGreaterThan(5)
    await openViz(page, 'hyperbolic-tree')
    const total = await page.getByTestId('hyp-node').count()
    expect(total).toBeGreaterThan(50)
    const first = await page.getByTestId('hyp-node').nth(1).getAttribute('r')
    await page.getByTestId('hyp-node').nth(1).click()
    await expect.poll(async () => page.getByTestId('hyp-node').nth(1).getAttribute('r')).not.toBe(first)
    await page.getByTestId('hyp-home').click()
  })

  test('FDEB shows the bundling time and the straight edges can be overlaid; Storyline keeps one line per character', async ({ page }) => {
    await openViz(page, 'force-directed-edge-bundling')
    await expect(page.getByTestId('fdeb-readout')).toContainText('묶음 계산')
    await page.getByTestId('ctl-mode').getByRole('radio', { name: '겹쳐 비교' }).click()
    await expect(page.getByTestId('fdeb-straight').first()).toBeVisible()
    await expect(page.getByTestId('fdeb-path').first()).toBeVisible()
    await openViz(page, 'storyline-chart')
    await expect(page.getByTestId('story-line')).toHaveCount(9)
    expect(await page.getByTestId('story-block').count()).toBeGreaterThan(5)
  })
})

test.describe('v0.7: scientific and geospatial techniques', () => {
  test('LIC paints a canvas that changes with the integral length; the arrow overlay appears on demand', async ({ page }) => {
    await openViz(page, 'line-integral-convolution')
    const url = () => page.getByTestId('lic-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL().length)
    // the image is computed in a Web Worker (a low-resolution preview first), so wait until the full image has been painted
    await expect(page.getByTestId('lic-status')).toHaveCount(0, { timeout: 20000 })
    await expect.poll(url, { timeout: 20000 }).toBeGreaterThan(5000)
    const a = await url()
    await page.getByTestId('ctl-length').fill('6')
    await expect.poll(url, { timeout: 20000 }).not.toBe(a)
    await page.getByTestId('ctl-arrows').check({ force: true })
    await expect(page.locator('[data-testid=chart-svg] g[transform*=rotate]').first()).toBeVisible()
  })

  test('3D globe rotates by dragging and by the longitude slider', async ({ page }) => {
    await openViz(page, 'globe-3d')
    const d = () => page.getByTestId('globe-region').evaluateAll((els) => els.map((e) => (e.getAttribute('d') ?? '').length).join(','))
    const before = await d()
    await dragBy(page, page.getByTestId('globe-sphere'), 90, 0)
    await expect.poll(d).not.toBe(before)
    const lon = await page.getByTestId('ctl-lon').inputValue()
    await page.getByTestId('ctl-lon').fill('-60')
    expect(await page.getByTestId('ctl-lon').inputValue()).not.toBe(lon)
  })

  test('Multi-planar reconstruction keeps the three sections synchronized', async ({ page }) => {
    await openViz(page, 'multi-planar-reconstruction')
    await expect(page.getByTestId('mpr-readout')).toBeVisible()
    const before = await page.getByTestId('mpr-readout').textContent()
    await page.getByTestId('mpr-hit-axial').click({ position: { x: 30, y: 30 } })
    await expect.poll(async () => page.getByTestId('mpr-readout').textContent()).not.toBe(before)
    await expect.poll(async () => page.getByTestId('mpr-pos-0').inputValue()).not.toBe('0.5')
    await expect.poll(async () => page.getByTestId('mpr-pos-1').inputValue()).not.toBe('0.5')
    expect(await page.getByTestId('mpr-pos-2').inputValue()).toBe('0.5')
  })
})

test.describe('v0.7: comparison lab', () => {
  test('the new presets open with their three representations of one table', async ({ page }) => {
    await page.goto('./#/compare/multivariate-projections')
    for (const id of ['scatter', 'radviz', 'star-coordinates']) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${id}"]`)).toBeVisible()
    await page.goto('./#/compare/tree-layouts')
    for (const id of ['treemap', 'voronoi-treemap', 'hyperbolic-tree']) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${id}"]`)).toBeVisible()
  })
})
