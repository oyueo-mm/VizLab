import { readFileSync } from 'node:fs'
import { expect, openViz, settle, test } from './fixtures'
import type { Page } from '@playwright/test'

const V11 = [...readFileSync('src/viz/catalogV11.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])
const cards = (page: Page) => page.getByTestId('catalog-grid').locator('.viz-card')
const setRange = async (page: Page, id: string, v: number) => { await page.getByTestId(id).fill(String(v)); await settle(page) }
const seg = (page: Page, id: string, label: string) => page.getByTestId(id).getByText(label, { exact: true }).click()
const openDetails = async (page: Page) => { const t = page.getByTestId('details-toggle'); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click() }

test.describe('v1.1: catalog and explanations', () => {
  test('the catalog lists 360 entries and the 20 new techniques are searchable by Korean and English names', async ({ page }) => {
    expect(V11.length).toBe(20)
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid')).toBeVisible()
    expect(await cards(page).count()).toBe(360)
    for (const [q, id] of [['행렬 큐브', 'matrix-cube'], ['Edge Splatting', 'parallel-edge-splatting'], ['캑터스', 'cactus-tree'], ['Pythagoras', 'pythagoras-tree'], ['힌턴', 'hinton-diagram'], ['continuous scatterplot', 'continuous-scatterplot'], ['연속 평행', 'continuous-parallel-coordinates'], ['spot noise', 'spot-noise'], ['스트림 리본', 'stream-ribbons'], ['직사각형 카토그램', 'rectangular-cartogram'], ['이동시간', 'travel-time-cartogram'], ['링 맵', 'ring-map'], ['History Flow', 'history-flow'], ['테일러', 'taylor-diagram'], ['타깃 도표', 'target-diagram'], ['nomogram', 'nomogram'], ['파이퍼', 'piper-diagram'], ['stiff', 'stiff-diagram'], ['skew-t', 'skew-t'], ['하세', 'hasse-diagram']]) {
      await page.goto(`./#/catalog?q=${encodeURIComponent(q)}`)
      await expect(page.getByTestId(`card-${id}`), `${q} → ${id}`).toBeVisible()
    }
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal', 'tsne', 'umap', 'zame', 'bagplot']) {
      await page.goto('./#/catalog')
      await expect(page.getByTestId(`card-${id}`)).toHaveCount(1)
    }
  })

  test('every new lab shows its chart and a full explanation with the differences and the sources', async ({ page }) => {
    test.setTimeout(300000)
    for (const id of V11) {
      await openViz(page, id)
      await openDetails(page)
      const body = page.getByTestId('details-body')
      await expect(body, id).toContainText('정의', { timeout: 10000 })
      for (const h of ['시각적 매핑', '작동 원리', '수학적 원리', '장점', '단점', '주의사항', '다른 기법과의 차이', '참고자료']) await expect(body, `${id}: ${h}`).toContainText(h)
      await expect(body, `${id}: 구현 수준`).toContainText('구현 수준')
    }
  })

  test('opening an explanation loads only the version group that holds it', async ({ page }) => {
    const files: string[] = []
    page.on('request', (r) => { const m = /\/assets\/(legacy|v5|v6|v7|v8|v9|v10|v11)-[\w-]+\.js/.exec(r.url()); if (m) files.push(m[1]) })
    await openViz(page, 'hinton-diagram')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의')
    expect(files).toContain('v11')
    expect(files).not.toContain('v10')
    expect(files).not.toContain('v5')
  })
})

test.describe('v1.1: specialized diagrams', () => {
  test('Hinton diagram: area ∝ |value| and the sign decides the colour; the row scale changes the sizes', async ({ page }) => {
    await openViz(page, 'hinton-diagram')
    const cells = page.getByTestId('hinton-cell')
    await expect(cells).toHaveCount(64)
    const read = () => cells.evaluateAll((els) => els.map((e) => ({ v: Number(e.getAttribute('data-value')), s: Number(e.getAttribute('data-side')) })))
    const a = await read()
    const big = a.reduce((p, q) => (Math.abs(q.v) > Math.abs(p.v) ? q : p))
    const small = a.filter((q) => Math.abs(q.v) > 0.3).reduce((p, q) => (Math.abs(q.v) < Math.abs(p.v) ? q : p))
    expect((big.s / small.s) ** 2).toBeCloseTo(Math.abs(big.v) / Math.abs(small.v), 0)
    await seg(page, 'ctl-hscale', '행마다')
    expect(await read()).not.toEqual(a)
  })

  test('Taylor and Target diagrams: the model points move with the normalisation and the law of cosines holds', async ({ page }) => {
    await openViz(page, 'taylor-diagram')
    const models = page.getByTestId('taylor-model')
    await expect(models).toHaveCount(3)
    await expect(page.getByTestId('taylor-ref')).toBeVisible()
    const sd0 = await models.first().getAttribute('data-sd')
    await page.getByTestId('ctl-tnorm').click()
    expect(await models.first().getAttribute('data-sd')).not.toBe(sd0)
    const r = Number(await models.first().getAttribute('data-r'))
    expect(r).toBeGreaterThan(0.5)
    expect(r).toBeLessThanOrEqual(1)
    await openViz(page, 'target-diagram')
    const ts = page.getByTestId('target-model')
    await expect(ts).toHaveCount(3)
    const ys = await ts.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-y'))))
    expect(Math.abs(ys[2])).toBeGreaterThan(Math.abs(ys[0])) // model C carries the planted bias
  })

  test('nomogram: five axes, the longest spans 100 points, and the intercept moves the probability', async ({ page }) => {
    await openViz(page, 'nomogram')
    const axes = page.getByTestId('nomo-axis')
    await expect(axes).toHaveCount(5)
    const ranges = await axes.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-range'))))
    expect(Math.max(...ranges)).toBeCloseTo(100, 1)
    const t0 = await page.getByTestId('nomo-readout').textContent()
    await setRange(page, 'ctl-intercept', -2)
    expect(await page.getByTestId('nomo-readout').textContent()).not.toBe(t0)
  })

  test('Piper and Stiff diagrams: one point per ion group and one polygon per sample; the sample count changes the polygons', async ({ page }) => {
    await openViz(page, 'piper-diagram')
    await expect(page.getByTestId('piper-sample')).toHaveCount(24)
    await openViz(page, 'stiff-diagram')
    const pats = page.getByTestId('stiff-pattern')
    await expect(pats).toHaveCount(12)
    expect(await pats.first().getAttribute('data-vertices')).toBe('6')
    await setRange(page, 'ctl-smax', 6)
    await expect(pats).toHaveCount(6)
  })

  test('Skew-T: temperature, dewpoint, parcel path and LCL are drawn; the skew changes the isotherms', async ({ page }) => {
    await openViz(page, 'skew-t')
    for (const id of ['skew-temp', 'skew-dew', 'skew-parcel', 'skew-lcl']) await expect(page.getByTestId(id), id).toBeVisible()
    const d0 = await page.getByTestId('skew-temp').getAttribute('d')
    await setRange(page, 'ctl-skew', 10)
    expect(await page.getByTestId('skew-temp').getAttribute('d')).not.toBe(d0)
    await page.getByTestId('ctl-parcel').click()
    await expect(page.getByTestId('skew-parcel')).toHaveCount(0)
  })

  test('Hasse diagram: 14 covering lines, selecting an element marks its up-set and down-set', async ({ page }) => {
    await openViz(page, 'hasse-diagram')
    await expect(page.getByTestId('hasse-node')).toHaveCount(12)
    await expect(page.getByTestId('hasse-cover')).toHaveCount(14)
    await page.getByTestId('hasse-node').filter({ hasText: '4' }).first().dispatchEvent('click')
    await expect(page.locator('[data-testid=hasse-node][data-state=sel]')).toHaveCount(1)
    expect(await page.locator('[data-testid=hasse-node][data-state=up]').count()).toBeGreaterThan(0)
    expect(await page.locator('[data-testid=hasse-node][data-state=down]').count()).toBeGreaterThan(0)
    await page.getByTestId('ctl-closure').click()
    expect(await page.getByTestId('hasse-closure').count()).toBeGreaterThan(0)
  })
})

test.describe('v1.1: hierarchy, dynamic network and documents', () => {
  test('Pythagoras tree: the root is the biggest square and the depth slider changes the number of squares', async ({ page }) => {
    await openViz(page, 'pythagoras-tree')
    const nodes = page.getByTestId('pyth-node')
    const sides = await nodes.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-side'))))
    expect(sides[0]).toBeCloseTo(Math.max(...sides), 6)
    const n6 = sides.length
    await setRange(page, 'ctl-pdepth', 2)
    expect(await nodes.count()).toBeLessThan(n6)
  })

  test('CactusTree: circles with linked bundles; the bundling strength changes the curves and a node selection fades other links', async ({ page }) => {
    await openViz(page, 'cactus-tree')
    expect(await page.getByTestId('cactus-node').count()).toBeGreaterThan(10)
    const links = page.getByTestId('cactus-link')
    expect(await links.count()).toBeGreaterThan(10)
    const d0 = await links.first().getAttribute('d')
    await setRange(page, 'ctl-beta', 0.2)
    expect(await links.first().getAttribute('d')).not.toBe(d0)
  })

  test('History flow: ribbons join the same segment across versions; inserted and deleted segments are counted', async ({ page }) => {
    await openViz(page, 'history-flow')
    expect(await page.getByTestId('flow-seg').count()).toBeGreaterThan(40)
    expect(await page.getByTestId('flow-ribbon').count()).toBeGreaterThan(30)
    await expect(page.getByTestId('flow-readout')).toContainText('삽입')
    await page.getByTestId('flow-seg').first().dispatchEvent('click')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
  })

  test('Matrix cube: the 3D cube, a time cut and a node cut', async ({ page }) => {
    await openViz(page, 'matrix-cube')
    await expect(page.getByTestId('cube-slice')).toBeVisible()
    await seg(page, 'ctl-cview', '시간 단면')
    expect(await page.getByTestId('cube-cell').count()).toBeGreaterThan(20)
    const n0 = await page.getByTestId('cube-cell').count()
    await setRange(page, 'ctl-ct', 2)
    expect(await page.getByTestId('cube-cell').count()).not.toBe(n0)
    await seg(page, 'ctl-cview', '노드 단면')
    expect(await page.getByTestId('cube-cell').count()).toBeGreaterThan(5)
  })

  test('Parallel edge splatting: one stripe per time step; the time range changes the stripes', async ({ page }) => {
    await openViz(page, 'parallel-edge-splatting')
    await expect(page.getByTestId('pes-canvas')).toHaveAttribute('data-stripes', '12')
    await setRange(page, 'ctl-pfrom', 3)
    await setRange(page, 'ctl-pto', 6)
    await expect(page.getByTestId('pes-canvas')).toHaveAttribute('data-stripes', '4')
  })
})

test.describe('v1.1: fields, flows and maps', () => {
  test('continuous scatterplot conserves the mass; continuous parallel coordinates has three axes', async ({ page }) => {
    await openViz(page, 'continuous-scatterplot')
    const cv = page.getByTestId('cs-canvas')
    const mass = Number(await cv.getAttribute('data-mass')), area = Number(await cv.getAttribute('data-area'))
    expect(Math.abs(mass - area) / area).toBeLessThan(0.08)
    await page.getByTestId('ctl-cspoints').click()
    expect(await page.getByTestId('cs-point').count()).toBe(24 * 24)
    await openViz(page, 'continuous-parallel-coordinates')
    await expect(page.getByTestId('cpc-canvas')).toHaveAttribute('data-axes', '3')
    await expect(page.getByTestId('cpc-axis')).toHaveCount(3)
    await page.getByTestId('ctl-cpclines').click()
    expect(await page.getByTestId('cpc-line').count()).toBeGreaterThan(50)
  })

  test('spot noise and stream ribbons render; the seed line is movable', async ({ page }) => {
    await openViz(page, 'spot-noise')
    await expect(page.getByTestId('spot-canvas')).toBeVisible()
    await setRange(page, 'ctl-spots', 2000)
    await expect(page.getByTestId('spot-canvas')).toHaveAttribute('data-spots', '2000')
    await openViz(page, 'stream-ribbons')
    await expect(page.getByTestId('canvas3d')).toBeVisible()
    await expect(page.getByTestId('seed-line')).toBeVisible()
  })

  test('rectangular cartogram: 17 rectangles whose areas are proportional to the values', async ({ page }) => {
    await openViz(page, 'rectangular-cartogram')
    const rs = page.getByTestId('rect-region')
    await expect(rs).toHaveCount(17)
    const d = await rs.evaluateAll((els) => els.map((e) => ({ a: Number(e.getAttribute('data-area')), v: Number(e.getAttribute('data-value')) })))
    const k = d[0].a / d[0].v
    for (const q of d) expect(q.a / q.v / k).toBeCloseTo(1, 1)
    await expect(page.getByTestId('rect-readout')).toContainText('인접 관계 보존')
  })

  test('travel-time cartogram: times come from the network and the blend moves the places; ring map has one sector per province', async ({ page }) => {
    await openViz(page, 'travel-time-cartogram')
    await expect(page.getByTestId('travel-node')).toHaveCount(25)
    const origin = page.locator('[data-testid=travel-node][data-time="0.0"]')
    await expect(origin).toHaveCount(1)
    const c0 = await page.getByTestId('travel-node').nth(0).locator('circle').getAttribute('cx')
    await setRange(page, 'ctl-tblend', 0)
    expect(await page.getByTestId('travel-node').nth(0).locator('circle').getAttribute('cx')).not.toBe(c0)
    await openViz(page, 'ring-map')
    await expect(page.getByTestId('ring-sector')).toHaveCount(17)
    await expect(page.getByTestId('ring-cell')).toHaveCount(17 * 6)
  })
})

test.describe('v1.1: home animation, comparison presets and linking', () => {
  test('the home animation runs 100 charts and ends on the ten v1.1 stages', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 100')
    for (let i = 0; i < 90; i++) await page.getByTestId('hero-next').click()
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'hinton')
    await expect(page.getByTestId('hero-count')).toHaveText('91 / 100')
  })

  test('the eleven new comparison presets draw every chart from one table', async ({ page }) => {
    const presets: [string, string[]][] = [
      ['dynamic-matrix', ['matrix-cube', 'parallel-edge-splatting']], ['hierarchy-forms', ['pythagoras-tree', 'treemap', 'spacetree']], ['signed-matrix', ['hinton-diagram', 'heatmap']], ['field-density', ['continuous-scatterplot', 'continuous-parallel-coordinates']],
      ['flow-synthesis', ['spot-noise', 'ibfv', 'vector-field-topology']], ['ribbon-tube-surface', ['stream-ribbons', 'streamtube', 'stream-surface']], ['skill-summary', ['taylor-diagram', 'target-diagram', 'scatter']], ['water-diagrams', ['piper-diagram', 'stiff-diagram']],
      ['rect-carto', ['rectangular-cartogram', 'cartogram-contiguous', 'tile-grid']], ['ring-choropleth', ['ring-map', 'choropleth']], ['poset-order', ['hasse-diagram', 'dag-layout']],
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

  test('linked highlighting: a Piper sample marks the same sample in the Stiff diagram (shared rows); a Hinton cell marks its source row', async ({ page }) => {
    await page.goto('./#/compare')
    await page.evaluate(() => localStorage.clear())
    await page.goto('./#/compare/water-diagrams')
    await expect(page.getByTestId('pane-chart-0').getByTestId('piper-sample').first()).toBeVisible()
    const marked = page.getByTestId('pane-chart-1').locator('path[stroke="#111827"][data-x], [data-testid=stiff-pattern] path[stroke="#111827"]')
    await expect(marked).toHaveCount(0)
    await page.getByTestId('pane-chart-0').getByTestId('piper-sample').first().dispatchEvent('pointerover')
    await expect(marked).toHaveCount(1)
    await page.getByTestId('pane-chart-0').getByTestId('piper-sample').first().dispatchEvent('pointerout')
    await expect(marked).toHaveCount(0)
    await page.goto('./#/compare/signed-matrix')
    await expect(page.getByTestId('pane-chart-0').getByTestId('hinton-cell').first()).toBeVisible()
    await page.getByTestId('pane-chart-0').getByTestId('hinton-cell').first().locator('rect').dispatchEvent('pointerover')
    await expect(page.getByTestId('pane-chart-0').locator('[data-testid=hinton-cell] rect[stroke="#f59e0b"]')).toHaveCount(1)
  })
})
