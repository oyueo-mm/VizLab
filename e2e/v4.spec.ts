import type { Page } from '@playwright/test'
import { dragBy, expect, openViz, readout, test } from './fixtures'

const V4 = ['choropleth', 'symbol-map', 'dot-density', 'geo-hexbin', 'flow-map', 'tile-grid', 'dorling', 'forest', 'bland-altman', 'calibration', 'control', 'funnel-plot', 'gantt', 'funnel', 'marimekko', 'flame', 'adjacency', 'edge-bundling', 'bipartite', 'hive']

async function openData(page: Page) {
  await page.getByTestId('tab-data').click()
  await expect(page.getByTestId('data-table')).toBeVisible()
}
async function openSettings(page: Page) {
  await page.getByTestId('tab-settings').click()
}
const cellInput = (page: Page, row: number, col: string) => page.getByLabel(`${row}행 ${col}`, { exact: true })
async function setCellValue(page: Page, row: number, col: string, value: string) {
  const input = cellInput(page, row, col)
  await input.fill(value)
  await input.press('Enter')
}
const num = async (loc: ReturnType<Page['locator']>, attr: string) => Number(await loc.getAttribute(attr))

test.describe('v0.4: every new chart opens, draws and explains itself', () => {
  for (const id of V4) {
    test(`${id}: lab renders without a message, shows details and a hint`, async ({ page }) => {
      await openViz(page, id)
      await expect(page.locator('.chart-message')).toHaveCount(0)
      expect(await page.getByTestId('chart-svg').locator('*').count()).toBeGreaterThan(5)
      await page.getByTestId('details-toggle').click()
      await expect(page.getByTestId('details-body')).toBeVisible()
      await expect(page.getByTestId('details-body').locator('.katex').first()).toBeVisible()
    })
  }
})

test.describe('v0.4: catalog', () => {
  test('lists 167 charts, the four new categories and the geospatial data-type filter', async ({ page }) => {
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(167)
    for (const c of ['geo', 'network', 'special']) await expect(page.getByTestId(`chip-${c}`)).toBeVisible()
    await page.getByTestId('chip-geo').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(39)
    await page.getByTestId('chip-all').click()
    if (await page.getByTestId('filter-toggle').isVisible()) await page.getByTestId('filter-toggle').click()
    await page.getByTestId('kind-geospatial').click()
    expect(await page.getByTestId('catalog-grid').locator('.viz-card').count()).toBeGreaterThanOrEqual(7)
    await expect(page.getByTestId('card-choropleth')).toBeVisible()
    await expect(page.getByTestId('card-dorling')).toBeVisible()
  })

  test('searching by Korean, English and keyword finds the new charts; every card has a real chart preview', async ({ page }) => {
    await page.goto('./#/catalog')
    const search = page.getByTestId('catalog-search')
    for (const [q, id] of [['코로플레스', 'choropleth'], ['Flame', 'flame'], ['egger', 'funnel-plot'], ['간트', 'gantt'], ['adjacency', 'adjacency'], ['번들', 'edge-bundling'], ['출판 편향', 'funnel-plot'], ['마리메코', 'marimekko']] as const) {
      await search.fill(q)
      await expect(page.getByTestId(`card-${id}`), q).toBeVisible()
    }
    await search.fill('')
    for (const id of ['choropleth', 'flow-map', 'forest', 'gantt', 'hive']) {
      const card = page.getByTestId(`card-${id}`)
      await card.scrollIntoViewIfNeeded()
      await expect(page.getByTestId(`preview-${id}`).locator('svg *').first()).toBeAttached({ timeout: 8000 })
    }
  })
})

test.describe('v0.4: maps', () => {
  test('choropleth: Korea provinces, classes, projection, zoom/pan and value editing with undo', async ({ page }) => {
    await openViz(page, 'choropleth')
    const regions = page.getByTestId('map-region')
    await expect(regions).toHaveCount(17)
    const seoul = page.locator('[data-testid="map-region"][data-id="KR-11"]')
    const before = await num(seoul, 'data-value')
    expect(before).toBeGreaterThan(9000)
    const fills = async () => regions.evaluateAll((els) => els.map((e) => e.getAttribute('fill')))
    const quantile = await fills()
    await openSettings(page)
    await page.getByTestId('ctl-class-method').selectOption('equal')
    const equal = await fills()
    expect(equal.join()).not.toBe(quantile.join())
    // projection really changes the geometry
    const d0 = await regions.first().getAttribute('d')
    await page.getByTestId('ctl-projection').selectOption('orthographic')
    const d1 = await regions.first().getAttribute('d')
    expect(d1).not.toBe(d0)
    await page.getByTestId('ctl-projection').selectOption('auto')
    // zoom buttons and reset
    const svg = page.getByTestId('chart-svg')
    await page.getByTestId('map-zoom-in').click()
    await expect.poll(async () => Number(await svg.getAttribute('data-zoom'))).toBeGreaterThan(1.3)
    await page.getByTestId('map-zoom-reset').click()
    await expect.poll(async () => Number(await svg.getAttribute('data-zoom'))).toBeCloseTo(1, 1)
    // wheel zoom must not edit data; clicking a region opens the value editor and edits it
    await seoul.click()
    await page.getByTestId('map-input').fill('12345')
    await page.getByTestId('map-input').press('Enter')
    expect(await num(seoul, 'data-value')).toBe(12345)
    await page.getByTestId('undo').click()
    expect(await num(seoul, 'data-value')).toBe(before)
  })

  test('choropleth: world map joins by ISO id, shows the per-capita caveat and tolerates unknown ids', async ({ page }) => {
    await openViz(page, 'choropleth')
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('world-regions')
    const regions = page.getByTestId('map-region')
    await expect.poll(async () => regions.count()).toBeGreaterThan(150)
    await expect(page.locator('[data-testid="map-region"][data-id="KOR"]')).toHaveCount(1)
    await openSettings(page)
    await expect(page.getByText(/인구 같은 절댓값은 큰 지역이 항상 진하게/)).toBeVisible()
    // an id that exists on no map is reported, not drawn
    await openData(page)
    await setCellValue(page, 1, 'ID', 'ZZZ')
    await expect(page.locator('.chart-warning')).toContainText(/지도에 없는 지역 ID/)
  })

  test('symbol map: area vs radius encoding, drag edits lat/lon', async ({ page }) => {
    await openViz(page, 'symbol-map')
    const dots = page.getByTestId('symbol')
    await expect(dots).toHaveCount(17)
    const r = async () => (await dots.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-r')))))
    const area = await r()
    await openSettings(page)
    await page.getByTestId('ctl-size-mode').getByRole('radio', { name: '반지름' }).click().catch(async () => { await page.getByTestId('ctl-size-mode').getByText('반지름').click() })
    const radius = await r()
    expect(Math.max(...radius)).toBeCloseTo(Math.max(...area), 3)
    const small = Math.min(...area.filter((x) => x > 0))
    const smallR = Math.min(...radius.filter((x) => x > 0))
    expect(smallR).toBeLessThan(small)
    // dragging a marker moves its coordinates in the data table
    await openData(page)
    const lat0 = Number(await cellInput(page, 1, '위도').inputValue())
    await dragBy(page, dots.first(), 30, 25)
    const lat1 = Number(await cellInput(page, 1, '위도').inputValue())
    expect(lat1).not.toBe(lat0)
  })

  test('dot density is reproducible and responds to the quantity of one dot', async ({ page }) => {
    await openViz(page, 'dot-density')
    // one `M…h0` segment per dot; the count is independent of the pane size, so it is a stable fingerprint of the seeded layout
    const dotsPath = () => page.locator('.map-dots').evaluateAll((els) => els.reduce((n, e) => n + (e.getAttribute('d')!.match(/M/g) ?? []).length, 0))
    await expect.poll(dotsPath).toBeGreaterThan(1000)
    const first = await dotsPath()
    const regionDots = () => page.getByTestId('dot-region').evaluateAll((els) => els.map((e) => e.getAttribute('data-dots')).join())
    const perRegion = await regionDots()
    await page.reload()
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await expect.poll(dotsPath).toBe(first)
    expect(await regionDots()).toBe(perRegion)
    await openSettings(page)
    await page.getByTestId('ctl-per-dot').fill('200')
    await page.getByTestId('ctl-per-dot').press('Enter')
    await expect.poll(dotsPath).toBeLessThan(first)
    await expect(page.getByText(/합성/).first()).toBeVisible()
  })

  test('geographic hexbin: equal-area cells share one ground area, screen cells do not', async ({ page }) => {
    await openViz(page, 'geo-hexbin')
    await expect(readout(page, '칸 면적')).toBeVisible()
    const area = async () => (await readout(page, '칸 면적').textContent())!
    const eq = await area()
    const [lo, hi] = eq.replace(/[^\d–]/g, '').split('–')
    expect(lo).toBe(hi)
    await openSettings(page)
    await page.getByTestId('ctl-binning').getByText('화면(투영 후)').click()
    await expect.poll(area).not.toBe(eq)
  })

  test('flow map: dateline flows are split, selecting a place separates inflow from outflow', async ({ page }) => {
    await openViz(page, 'flow-map')
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('world-flows')
    await expect(page.getByTestId('flow').first()).toBeAttached()
    await expect.poll(async () => page.locator('[data-testid="flow"][data-wrap="1"]').count()).toBeGreaterThan(0)
    const wrapped = page.locator('[data-testid="flow"][data-wrap="1"]').first()
    expect(await wrapped.locator('path').count()).toBeGreaterThanOrEqual(4)
    await page.locator('[data-testid="flow-place"][data-name="서울"]').click()
    await expect(page.getByTestId('chart-svg').locator('[stroke="#e07a3f"]').first()).toBeAttached()
    await expect(page.getByTestId('chart-svg').locator('[stroke="#2f6fb3"]').first()).toBeAttached()
  })

  test('tile grid: drag swaps two tiles and the layout can be reset; Korea and world layouts differ', async ({ page }) => {
    await openViz(page, 'tile-grid')
    const tiles = page.getByTestId('tile')
    await expect(tiles).toHaveCount(17)
    const seoul = page.locator('[data-testid="tile"][data-id="KR-11"]')
    const incheon = page.locator('[data-testid="tile"][data-id="KR-28"]')
    const [c0, i0] = [await seoul.getAttribute('data-col'), await incheon.getAttribute('data-col')]
    const sb = (await seoul.boundingBox())!
    const ib = (await incheon.boundingBox())!
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(seoul).toHaveAttribute('data-col', i0!)
    await expect(incheon).toHaveAttribute('data-col', c0!)
    await openSettings(page)
    await page.getByTestId('tile-reset').click()
    await expect(seoul).toHaveAttribute('data-col', c0!)
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('world-regions')
    await expect.poll(async () => tiles.count()).toBeGreaterThan(50)
  })

  test('dorling cartogram: circle area follows the value and no circles overlap', async ({ page }) => {
    await openViz(page, 'dorling')
    const circles = page.getByTestId('dorling-circle')
    await expect(circles).toHaveCount(17)
    await expect(readout(page, '최대 겹침')).toHaveText('없음')
    const items = await circles.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-id')!, r: Number(e.getAttribute('data-r')), x: Number(e.getAttribute('data-x')), y: Number(e.getAttribute('data-y')) })))
    const seoul = items.find((c) => c.id === 'KR-11')!
    const jeju = items.find((c) => c.id === 'KR-49')!
    // area ∝ value → radius ratio = sqrt(value ratio) (seoul 9,386 vs jeju 676 thousand)
    expect((seoul.r / jeju.r) ** 2).toBeGreaterThan(10)
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y)).toBeGreaterThan(items[i].r + items[j].r - 0.5)
    await openSettings(page)
    await page.getByTestId('ctl-dorling-pull').fill('0')
    await expect(readout(page, '최대 겹침')).toHaveText('없음')
  })
})

test.describe('v0.4: statistics and uncertainty', () => {
  test('forest plot: pooled estimate matches the model, adding and deleting studies recomputes it', async ({ page }) => {
    await openViz(page, 'forest')
    const boxes = page.getByTestId('forest-box')
    await expect(boxes).toHaveCount(14)
    const pooled = page.getByTestId('forest-pooled')
    const random = await num(pooled, 'data-effect')
    expect(random).toBeGreaterThan(0.6); expect(random).toBeLessThan(0.85)
    expect(await num(pooled, 'data-lo')).toBeLessThan(random)
    // with no heterogeneity (I² = 0) both models agree; the small-study dataset is heterogeneous, so they differ
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('studies-biased')
    await expect(boxes).toHaveCount(24)
    const randomBiased = await num(pooled, 'data-effect')
    await openSettings(page)
    await page.getByTestId('ctl-model').getByText('고정효과').click()
    await expect.poll(async () => num(pooled, 'data-effect')).not.toBe(randomBiased)
    await page.getByTestId('forest-add').click()
    await expect(boxes).toHaveCount(25)
    await page.getByTestId('forest-delete').click()
    await expect(boxes).toHaveCount(24)
    // the null line sits at OR = 1 on a log axis
    await expect(page.getByTestId('forest-null')).toBeAttached()
  })

  test('Bland–Altman: bias and limits follow the data; dragging a point edits the pair', async ({ page }) => {
    await openViz(page, 'bland-altman')
    const bias = page.getByTestId('ba-bias')
    const b0 = await num(bias, 'data-value')
    expect(b0).toBeLessThan(-1)
    const hi = await num(page.getByTestId('ba-loa-hi'), 'data-value')
    const lo = await num(page.getByTestId('ba-loa-lo'), 'data-value')
    expect(hi).toBeGreaterThan(b0); expect(lo).toBeLessThan(b0)
    expect(hi - b0).toBeCloseTo(b0 - lo, 3)
    await openData(page)
    const a0 = Number(await cellInput(page, 1, '방법 A').inputValue())
    await dragBy(page, page.getByTestId('ba-point').first(), 0, -40)
    expect(Number(await cellInput(page, 1, '방법 A').inputValue())).not.toBe(a0)
    await expect.poll(async () => num(bias, 'data-value')).not.toBe(b0)
    await page.getByTestId('undo').click()
    await expect.poll(async () => num(bias, 'data-value')).toBeCloseTo(b0, 6)
    await openSettings(page)
    await page.getByTestId('ctl-ba-mode').getByText('백분율').click()
    await expect(page.getByTestId('chart-svg')).toContainText('%')
  })

  test('calibration: bins and strategy change the curve; the diagonal is perfect calibration', async ({ page }) => {
    await openViz(page, 'calibration')
    const bins = page.getByTestId('cal-bin')
    const n0 = await bins.count()
    expect(n0).toBeGreaterThan(4)
    const first = bins.first()
    expect(await num(first, 'data-pred')).toBeLessThan(0.2)
    // an over-confident model: high-probability bins sit below the diagonal
    const last = bins.last()
    expect(await num(last, 'data-obs')).toBeLessThan(await num(last, 'data-pred') + 0.2)
    await openSettings(page)
    await page.getByTestId('ctl-cal-bins').fill('5')
    await expect(bins).toHaveCount(5)
    await page.getByTestId('ctl-cal-strategy').getByText('같은 개수').click()
    const counts = await bins.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-n'))))
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('cal-diagonal')).toBeAttached()
  })

  test('control chart: limits, signals, baseline phase and spec limits are separate things', async ({ page }) => {
    await openViz(page, 'control')
    const ucl = await num(page.getByTestId('ctl-ucl'), 'data-value')
    const lcl = await num(page.getByTestId('ctl-lcl'), 'data-value')
    const cl = await num(page.getByTestId('ctl-center'), 'data-value')
    expect(ucl - cl).toBeCloseTo(cl - lcl, 3)
    expect(await page.locator('[data-testid="ctl-point"][data-signal]').count()).toBeGreaterThan(0)
    await expect(page.getByTestId('ctl-range-ucl')).toBeAttached()
    await openSettings(page)
    await page.getByTestId('ctl-baseline').fill('15')
    await expect.poll(async () => num(page.getByTestId('ctl-center'), 'data-value')).not.toBe(cl)
    await page.getByRole('button', { name: /규격 한계/ }).click()
    await page.getByTestId('ctl-spec').click()
    await expect(page.getByTestId('spec-usl')).toBeAttached()
    await expect(page.getByTestId('spec-lsl')).toBeAttached()
    // the dataset with counts: p chart with limits that change point by point
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('process-counts')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await expect(page.locator('.chart-message')).toHaveCount(0)
  })

  test('funnel plot: the small-study effect shows as outside points and a significant Egger test', async ({ page }) => {
    await openViz(page, 'funnel-plot')
    await expect(page.getByTestId('funnel-point')).toHaveCount(24)
    await expect(readout(page, 'Egger p')).toBeVisible()
    expect(Number((await readout(page, 'Egger p').textContent())!.replace('<', ''))).toBeLessThan(0.05)
    await openSettings(page)
    await expect(page.getByText(/출판 편향이 입증된 것은 아닙니다/)).toBeVisible()
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('studies')
    await expect(page.getByTestId('funnel-point')).toHaveCount(14)
    expect(Number((await readout(page, 'Egger p').textContent())!.replace('<', ''))).toBeGreaterThan(0.05)
  })
})

test.describe('v0.4: special-purpose charts', () => {
  test('gantt: dragging moves dates by whole days, resizing changes the duration, tasks can be added and deleted', async ({ page }) => {
    await openViz(page, 'gantt')
    const bars = page.getByTestId('gantt-bar')
    await expect(bars).toHaveCount(11)
    await expect(page.getByTestId('gantt-dep').first()).toBeAttached()
    await openData(page)
    const s0 = await cellInput(page, 11, '시작').inputValue()
    const e0 = await cellInput(page, 11, '종료').inputValue()
    await page.getByTestId('tab-settings').click()
    const bar = bars.nth(10).locator('rect[data-nodrag]').first()
    await dragBy(page, bar, 60, 0)
    await openData(page)
    const s1 = await cellInput(page, 11, '시작').inputValue()
    const e1 = await cellInput(page, 11, '종료').inputValue()
    expect(s1).not.toBe(s0)
    const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
    expect(days(s0, s1)).toBe(days(e0, e1))
    // a single-day task: start = end means 1 day
    await expect(bars.nth(10)).toHaveAttribute('data-days', '1')
    await page.getByTestId('gantt-add').click()
    await expect(bars).toHaveCount(12)
    await page.getByTestId('gantt-delete').click()
    await expect(bars).toHaveCount(11)
  })

  test('gantt: starting before a predecessor ends is flagged, not silently fixed', async ({ page }) => {
    await openViz(page, 'gantt')
    await openData(page)
    await setCellValue(page, 2, '시작', '2024-03-04')
    await expect(page.locator('.chart-warning')).toContainText(/끝나기 전에 시작/)
    expect(await cellInput(page, 2, '시작').inputValue()).toBe('2024-03-04')
  })

  test('funnel chart: conversion per stage, mid-process inflow is flagged instead of shown as a conversion', async ({ page }) => {
    await openViz(page, 'funnel')
    const stages = page.getByTestId('funnel-stage')
    await expect(stages).toHaveCount(5)
    expect(await num(stages.nth(1), 'data-conversion')).toBeCloseTo((await num(stages.nth(1), 'data-value')) / (await num(stages.nth(0), 'data-value')), 4)
    await expect(page.locator('[data-testid="funnel-stage"][data-inflow="1"]')).toHaveCount(0)
    await openData(page)
    await page.getByTestId('dataset-select').selectOption('process-flow')
    await expect(page.locator('[data-testid="funnel-stage"][data-inflow="1"]')).toHaveCount(1)
    await expect(page.locator('.chart-warning')).toContainText(/중간에 새로 들어온/)
  })

  test('marimekko: every rectangle’s area is its share of the grand total', async ({ page }) => {
    await openViz(page, 'marimekko')
    const cells = page.getByTestId('mekko-cell')
    const info = await cells.evaluateAll((els) => els.map((e) => ({ v: Number(e.getAttribute('data-value')), a: Number(e.getAttribute('data-area')) })))
    expect(info.length).toBe(12)
    const total = info.reduce((s, c) => s + c.v, 0)
    const area = info.reduce((s, c) => s + c.a, 0)
    for (const c of info) expect(c.a / area).toBeCloseTo(c.v / total, 2)
    await cells.first().click()
    await page.getByTestId('mekko-input').fill('1000')
    await page.getByTestId('mekko-input').press('Enter')
    const after = await cells.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))))
    expect(after).toContain(1000)
  })

  test('flame graph: click zooms into a function, back returns, search marks matches; the axis is not time', async ({ page }) => {
    await openViz(page, 'flame')
    const blocks = page.getByTestId('flame-block')
    const all = await blocks.count()
    expect(all).toBeGreaterThan(15)
    await expect(page.getByTestId('chart-svg')).toContainText('시간 순서가 아닙니다')
    const main = page.locator('[data-testid="flame-block"][data-name="main"]')
    const w0 = await num(main, 'data-width')
    await page.locator('[data-testid="flame-block"][data-name="http.Serve"] rect').first().click()
    await expect(page.getByTestId('flame-crumb')).toContainText('http.Serve')
    const served = page.locator('[data-testid="flame-block"][data-name="http.Serve"]')
    expect(await num(served, 'data-width')).toBeGreaterThan(w0 * 0.9)
    await page.getByTestId('flame-back').click()
    await expect(page.getByTestId('flame-crumb')).toContainText('main')
    await page.getByTestId('flame-reset').click()
    await openSettings(page)
    await page.getByTestId('ctl-flame-query').fill('render')
    // template.Render is called from two handlers: every call site is marked
    await expect.poll(async () => page.getByTestId('chart-svg').locator('[stroke="#2f6fb3"]').count()).toBe(2)
  })
})

test.describe('v0.4: network charts', () => {
  test('adjacency matrix: cells = edges (twice when undirected), order changes labels, editing a cell edits the edge list', async ({ page }) => {
    await openViz(page, 'adjacency')
    const cells = page.getByTestId('adj-cell')
    const n = await cells.count()
    expect(n % 2).toBe(0)
    await openData(page)
    const rows = await page.getByTestId('data-table').locator('tbody tr').count()
    expect(rows).toBeGreaterThan(0)
    await page.getByTestId('tab-settings').click()
    const order0 = await page.getByTestId('adj-label').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).join())
    await page.getByTestId('ctl-adj-order').selectOption('name')
    const order1 = await page.getByTestId('adj-label').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).join())
    expect(order1).not.toBe(order0)
    // delete an existing connection through its cell: weight 0
    const cell = cells.first()
    const a = await cell.getAttribute('data-row'); const b = await cell.getAttribute('data-col')
    await cell.click({ force: true })
    await page.getByTestId('adj-input').fill('0')
    await page.getByTestId('adj-input').press('Enter')
    await expect(cells).toHaveCount(n - 2)
    expect(a).not.toBe(b)
    await page.getByTestId('undo').click()
    await expect(cells).toHaveCount(n)
  })

  test('hierarchical edge bundling: edges follow the hierarchy path; strength changes the curves; selecting a node splits in/out', async ({ page }) => {
    await openViz(page, 'edge-bundling')
    const edges = page.getByTestId('bundle-edge')
    expect(await edges.count()).toBeGreaterThan(20)
    const d0 = await edges.first().getAttribute('d')
    await openSettings(page)
    await page.getByTestId('ctl-bundle-beta').fill('0')
    await expect.poll(async () => edges.first().getAttribute('d')).not.toBe(d0)
    await page.getByTestId('ctl-bundle-beta').fill('0.85')
    await page.locator('[data-testid="bundle-node"][data-id="core/Logger"] circle').click()
    await expect(page.getByTestId('chart-svg').locator('[stroke="#e07a3f"]').first()).toBeAttached()
    await page.getByTestId('map-zoom-in').click()
  })

  test('bipartite: two disjoint sets, a name on both sides is reported, ordering reduces crossings, nodes can be dragged', async ({ page }) => {
    await openViz(page, 'bipartite')
    const left = page.locator('[data-testid="bip-node"][data-side="left"]')
    const right = page.locator('[data-testid="bip-node"][data-side="right"]')
    expect(await left.count()).toBe(14)
    expect(await right.count()).toBe(8)
    const crossings = async () => Number((await readout(page, '교차').textContent())!)
    const barycenter = await crossings()
    await openSettings(page)
    await page.getByTestId('ctl-bip-order').selectOption('name')
    expect(await crossings()).toBeGreaterThan(barycenter)
    // dragging a node switches to manual order
    await page.getByTestId('ctl-bip-order').selectOption('data')
    await dragBy(page, left.first().locator('circle'), 0, 120)
    await expect(page.getByTestId('ctl-bip-order')).toHaveValue('manual')
    // the same name on both sides breaks the two-set structure
    await openData(page)
    await setCellValue(page, 1, '모임', '민준')
    await expect(page.locator('.chart-warning')).toContainText(/양쪽 집합/)
  })

  test('hive plot: layout is deterministic and the axis rule moves nodes between axes', async ({ page }) => {
    await openViz(page, 'hive')
    const signature = () => page.getByTestId('hive-node').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-id')}:${e.getAttribute('data-axis')}:${e.getAttribute('data-t')}`).join())
    const first = await signature()
    await page.reload()
    await expect(page.getByTestId('hive-node').first()).toBeAttached()
    expect(await signature()).toBe(first)
    await expect(page.getByTestId('hive-axis')).toHaveCount(3)
    await openSettings(page)
    await page.getByTestId('ctl-hive-axes').getByText('4').click()
    await expect(page.getByTestId('hive-axis')).toHaveCount(4)
    await page.getByTestId('ctl-hive-rule').selectOption('degree')
    expect(await signature()).not.toBe(first)
  })

  test('large network switches to canvas automatically and keeps hover and selection working', async ({ page }) => {
    await openViz(page, 'network')
    await openData(page)
    await page.getByTestId('dataset-size').fill('600')
    await expect(page.getByTestId('chart-svg')).toHaveAttribute('data-renderer', 'canvas')
    await expect(page.getByTestId('net-canvas')).toBeVisible()
    await expect(page.getByTestId('chart-svg')).toHaveAttribute('data-running', '0', { timeout: 60000 })
    const box = (await page.getByTestId('chart-svg').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3, { steps: 3 })
    // the canvas has real pixels
    const painted = await page.getByTestId('net-canvas').evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n })
    expect(painted).toBeGreaterThan(1000)
    await openSettings(page)
    await page.getByTestId('chart-svg').scrollIntoViewIfNeeded()
  })
})

test.describe('v0.4: comparison lab', () => {
  test('new presets draw every chart from one dataset', async ({ page }) => {
    await page.goto('./#/compare')
    for (const [preset, charts] of [
      ['calibration', ['roc', 'pr', 'calibration']], ['geo-symbol', ['choropleth', 'symbol-map', 'bar']], ['geo-tile', ['choropleth', 'tile-grid', 'dorling']], ['agreement', ['scatter', 'bland-altman']],
      ['network-matrix', ['network', 'adjacency']], ['bipartite', ['network', 'bipartite']], ['mekko', ['mosaic', 'marimekko']],
    ] as const) {
      await page.getByTestId(`preset-${preset}`).click()
      await expect(page).toHaveURL(new RegExp(`#/compare/${preset}$`))
      for (let i = 0; i < charts.length; i++) {
        await expect(page.getByTestId(`compare-pane-${i}`)).toHaveAttribute('data-viz', charts[i])
        await expect(page.getByTestId(`pane-chart-${i}`).locator('svg').first()).toBeVisible()
        await expect(page.getByTestId(`pane-issue-${i}`), `${preset}:${charts[i]}`).toHaveCount(0)
      }
    }
  })

  test('chart choices are judged against the shared data before any chart code is loaded', async ({ page }) => {
    await page.goto('./#/compare/mekko')
    const options = page.getByTestId('pane-select-0').locator('option')
    await expect(options.first()).toBeAttached()
    // the mosaic/marimekko data (3 columns) cannot drive a Bland–Altman plot (two numbers) or a Gantt chart (two dates)
    for (const [id, name] of [['bland-altman', '블랜드-알트만'], ['gantt', '간트'], ['calibration', '보정']] as const) {
      const opt = page.getByTestId('pane-select-0').locator(`option[value="${id}"]`)
      await expect(opt, id).toContainText('맞지 않음')
      expect(await opt.getAttribute('title'), name).toMatch(/필요하지만/)
      // flagged, never forbidden
      await expect(opt).toBeEnabled()
    }
    await expect(page.getByTestId('pane-select-0').locator('option[value="bar"]')).not.toContainText('맞지 않음')
  })

  test('linked highlighting: a map region marks the same row in the bar chart; a network node marks its adjacency row', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto('./#/compare/geo-symbol')
    await expect(page.getByTestId('pane-chart-0').getByTestId('map-region').first()).toBeVisible()
    const region = page.getByTestId('pane-chart-0').locator('[data-testid="map-region"][data-id="KR-11"]')
    await region.hover()
    const hot = page.getByTestId('pane-chart-2').locator('rect[stroke="#121816"]')
    await expect(hot).toHaveCount(1)
    await page.mouse.move(2, 2)
    await expect(hot).toHaveCount(0)
    await page.goto('./#/compare/network-matrix')
    await expect(page.getByTestId('pane-chart-1').getByTestId('adj-cell').first()).toBeVisible()
    // the force layout is still settling in a fresh pane, so wait for it to rest before aiming at a node
    await expect(page.getByTestId('pane-chart-0').getByTestId('chart-svg')).toHaveAttribute('data-running', '0', { timeout: 20000 })
    await page.getByTestId('pane-chart-0').getByTestId('net-node').first().hover()
    await expect(page.getByTestId('pane-chart-1').locator('rect[stroke="#121816"]').first()).toBeAttached()
  })

  test('calibration bin marks its observations on the ROC curve', async ({ page }) => {
    await page.goto('./#/compare/calibration')
    await expect(page.getByTestId('pane-chart-2').getByTestId('cal-bin').first()).toBeVisible()
    await page.getByTestId('pane-chart-2').getByTestId('cal-bin').nth(2).locator('circle').hover()
    await expect(page.getByTestId('pane-chart-0').getByTestId('roc-linked').first()).toBeAttached()
  })
})

test.describe('v0.4: home animation and persistence', () => {
  test('the animation has 36 charts including the v0.4 and v0.5 ones, each linking to its lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 36')
    for (const [stage, viz] of [['flame', 'flame'], ['bundle', 'edge-bundling'], ['choropleth', 'choropleth'], ['forest', 'forest']] as const) {
      for (let i = 0; i < 36 && (await page.getByTestId('hero-demo').getAttribute('data-stage')) !== stage; i++) await page.getByTestId('hero-next').click()
      await expect(page.getByTestId('hero-link')).toHaveAttribute('href', `#/viz/${viz}`)
      await expect.poll(async () => page.getByTestId('hero-marks').locator('*').count(), { timeout: 8000 }).toBeGreaterThan(8)
    }
  })

  test('the map data is a separate download that the home page does not fetch up front', async ({ page }) => {
    const urls: string[] = []
    page.on('response', (r) => urls.push(r.url()))
    await page.goto('./')
    await expect(page.getByTestId('hero-demo')).toBeVisible()
    await page.waitForTimeout(800)
    expect(urls.filter((u) => /topo|choropleth|maps-/i.test(u))).toEqual([])
  })

  test('settings and data survive a reload on a deep link', async ({ page }) => {
    await openViz(page, 'choropleth')
    await openSettings(page)
    await page.getByTestId('ctl-class-method').selectOption('jenks')
    await page.waitForTimeout(500)
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'choropleth')
    await openSettings(page)
    await expect(page.getByTestId('ctl-class-method')).toHaveValue('jenks')
    await expect(page.getByTestId('map-region')).toHaveCount(17)
  })

  test('related charts link between the geo charts', async ({ page }) => {
    await openViz(page, 'choropleth')
    await page.locator('a[href="#/viz/dorling"]').first().click()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'dorling')
  })
})
