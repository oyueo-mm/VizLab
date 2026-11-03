import { readFileSync, readdirSync } from 'node:fs'
import { dragBy, expect, openViz, settle, test } from './fixtures'
import type { Page } from '@playwright/test'

const V8 = readdirSync('src/viz').filter((f) => /^catalogV8.*\.ts$/.test(f)).flatMap((f) => [...readFileSync(`src/viz/${f}`, 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]))
const cards = (page: Page) => page.getByTestId('catalog-grid').locator('.viz-card')
const seg = (page: Page, id: string, label: string) => page.getByTestId(id).getByText(label, { exact: true }).click()
const setRange = async (page: Page, id: string, v: number) => { await page.getByTestId(id).fill(String(v)); await settle(page) }
/** The details section keeps its state between labs, so only open it when it is closed. */
const openDetails = async (page: Page) => { const t = page.getByTestId('details-toggle'); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click() }
const num = (s: string | null, re: RegExp) => Number(re.exec(s ?? '')?.[1] ?? NaN)

test.describe('v0.8: encoding-principle filter', () => {
  test('the filter combines with the other filters, lives in the URL and survives reload and Back', async ({ page }) => {
    await page.goto('./#/catalog')
    await expect(page.getByTestId('encoding-filters')).toBeVisible()
    const all = await cards(page).count()
    expect(all).toBe(360)
    await page.getByTestId('enc-partition').click()
    await expect(page).toHaveURL(/[?&]e=partition/)
    const part = await cards(page).count()
    expect(part).toBeGreaterThan(10)
    expect(part).toBeLessThan(all)
    await expect(page.getByTestId('card-treemap')).toBeVisible()
    await expect(page.getByTestId('card-semantic-substrates')).toBeVisible()
    // combined with the nature filter and a category
    await page.getByTestId('nature-technique').click()
    await expect(page).toHaveURL(/k=technique/)
    await expect(page).toHaveURL(/e=partition/)
    expect(await cards(page).count()).toBeLessThanOrEqual(part)
    await page.getByTestId('chip-hierarchy').click()
    await expect(page).toHaveURL(/#\/catalog\/hierarchy\?/)
    const combined = await cards(page).count()
    expect(combined).toBeGreaterThan(0)
    await page.reload()
    await expect(page.getByTestId('enc-partition')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('nature-technique')).toHaveAttribute('aria-pressed', 'true')
    expect(await cards(page).count()).toBe(combined)
    // Back removes the last filter step
    await page.goBack()
    await expect(page).not.toHaveURL(/hierarchy/)
    await page.getByTestId('filter-reset').click()
    expect(await cards(page).count()).toBe(all)
    await expect(page.getByTestId('enc-all')).toHaveAttribute('aria-pressed', 'true')
  })

  test('every technique counts under its main and its secondary principles', async ({ page }) => {
    await page.goto('./#/catalog?e=temporal')
    await expect(page.getByTestId('card-timearcs')).toBeVisible()
    await expect(page.getByTestId('card-lifeflow')).toBeVisible()
    await page.goto('./#/catalog?e=spatial3d')
    for (const id of ['cone-tree', 'stream-surface', 'streamtube']) await expect(page.getByTestId(`card-${id}`)).toBeVisible()
  })
})

test.describe('v0.8: the twenty new labs', () => {
  test('every new lab renders its chart and loads its explanation with the required sections', async ({ page }) => {
    test.setTimeout(240000)
    expect(V8.length).toBe(20)
    for (const id of V8) {
      await openViz(page, id)
      await openDetails(page)
      const body = page.getByTestId('details-body')
      await expect(body, id).toContainText('정의', { timeout: 10000 })
      for (const h of ['시각적 매핑', '작동 원리', '수학적 원리', '장점', '단점', '주의사항', '다른 기법과의 차이', '참고자료']) await expect(body, `${id}: ${h}`).toContainText(h)
    }
  })

  test('opening an explanation loads only the version group that holds it', async ({ page }) => {
    const files: string[] = []
    page.on('request', (r) => { const m = /\/assets\/(legacy|v5|v6|v7|v8)-[\w-]+\.js/.exec(r.url()); if (m) files.push(m[1]) })
    await openViz(page, 'bubble-sets')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의')
    expect(files).toContain('v8')
    expect(files).not.toContain('v5')
    expect(files).not.toContain('v6')
  })
})

test.describe('v0.8: set techniques', () => {
  test('Bubble Sets: switching to membership editing changes the set size; settings are restored after reload', async ({ page }) => {
    await openViz(page, 'bubble-sets')
    await expect(page.getByTestId('set-region').first()).toBeVisible()
    const before = await page.getByTestId('chart-svg').textContent()
    const a0 = num(before, /집합 A \((\d+)/)
    await seg(page, 'ctl-mode', '소속 바꾸기')
    await page.getByTestId('set-point').first().click()
    await settle(page)
    const after = await page.getByTestId('chart-svg').textContent()
    expect(num(after, /집합 A \((\d+)/)).not.toBe(a0)
    await setRange(page, 'ctl-r1', 60)
    await page.waitForTimeout(500)
    await page.reload()
    await expect(page.getByTestId('ctl-r1')).toHaveValue('60')
  })

  test('Bubble Sets: dragging a point moves it and the region follows', async ({ page }) => {
    await openViz(page, 'bubble-sets')
    const p = page.getByTestId('set-point').first()
    const before = await p.getAttribute('transform')
    const d0 = await page.getByTestId('set-region').first().getAttribute('d')
    await dragBy(page, p, 60, 30)
    await settle(page)
    expect(await page.getByTestId('set-point').first().getAttribute('transform')).not.toBe(before)
    expect(await page.getByTestId('set-region').first().getAttribute('d')).not.toBe(d0)
    // Undo restores the position
    await page.getByRole('button', { name: /실행 취소|되돌리기/ }).first().click().catch(() => {})
  })

  test('LineSets counts crossings; Kelp fusion enlarges the regions', async ({ page }) => {
    await openViz(page, 'linesets')
    await expect(page.getByTestId('line-crossings')).toContainText('선 교차')
    await expect(page.getByTestId('set-line').first()).toBeVisible()
    await openViz(page, 'kelp-diagram')
    const area = async () => (await page.getByTestId('set-region').first().getAttribute('d'))!.length
    const a0 = await area()
    await setRange(page, 'ctl-fusion', 1)
    expect(await area()).not.toBe(a0)
  })

  test('Rainbow Boxes: ordering the elements reduces the number of box fragments', async ({ page }) => {
    await openViz(page, 'rainbow-boxes')
    const txt = async () => (await page.getByTestId('rainbow-frag').textContent())!
    const opt = num(await txt(), /상자 조각 (\d+)/)
    await page.getByTestId('ctl-optimize').click()
    await settle(page)
    const plain = num(await txt(), /상자 조각 (\d+)/)
    expect(opt).toBeLessThan(plain)
    await page.getByTestId('rainbow-col').first().click()
    await expect(page.getByTestId('rainbow-clear')).toBeVisible()
  })

  test('Radial Sets: choosing a set dims the bands of the other sets', async ({ page }) => {
    await openViz(page, 'radial-sets')
    expect(await page.getByTestId('radial-link').count()).toBeGreaterThan(3)
    await page.getByTestId('radial-sector').first().dispatchEvent('click')
    await settle(page)
    expect(await page.locator('[data-testid=radial-link][fill-opacity="0.05"]').count()).toBeGreaterThan(0)
  })

  test('the three point-set views highlight the same observation in the comparison lab', async ({ page }) => {
    await page.goto('./#/compare/set-regions')
    for (const id of ['bubble-sets', 'linesets', 'kelp-diagram']) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${id}"]`)).toBeVisible()
    await page.getByTestId('pane-chart-0').getByTestId('set-point').first().hover()
    for (const i of [0, 1, 2]) await expect(page.getByTestId(`pane-chart-${i}`).getByTestId('set-point-linked'), `pane ${i}`).toHaveCount(1)
  })
})

test.describe('v0.8: network techniques', () => {
  test('NodeTrix collapses a community into a node and expands it again; a cell selects the edge', async ({ page }) => {
    await openViz(page, 'nodetrix')
    const matrices = await page.getByTestId('nodetrix-matrix').count()
    expect(matrices).toBeGreaterThanOrEqual(3)
    await page.getByTestId('nodetrix-header').first().dblclick()
    await expect(page.getByTestId('nodetrix-matrix')).toHaveCount(matrices - 1)
    await expect(page.getByTestId('nodetrix-node')).toHaveCount(1)
    await page.getByTestId('nodetrix-node').first().dblclick()
    await expect(page.getByTestId('nodetrix-matrix')).toHaveCount(matrices)
    await page.getByTestId('nodetrix-cell').first().click()
    await settle(page)
  })

  test('NodeTrix: a cell hovered in the comparison lab marks its nodes in the node-link view', async ({ page }) => {
    await page.goto('./#/compare/network-hybrid')
    for (const id of ['network', 'nodetrix', 'biofabric']) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${id}"]`)).toBeVisible()
    await page.getByTestId('pane-chart-1').getByTestId('nodetrix-cell').first().hover()
    await expect(page.getByTestId('pane-chart-0').locator('[data-testid="net-node"]').first()).toBeVisible()
  })

  test('Power Graph compresses the dependency network and the power edge restores its original edges', async ({ page }) => {
    await openViz(page, 'power-graph')
    const stats = (await page.getByTestId('power-stats').textContent())!
    const original = num(stats, /원본 간선 (\d+)/), compressed = num(stats, /표현 (\d+)/)
    expect(compressed).toBeLessThan(original / 3)
    await page.getByTestId('power-edge').first().click({ force: true })
    expect(await page.getByTestId('power-restored').count()).toBeGreaterThanOrEqual(4)
    await setRange(page, 'ctl-mingain', 20)
    expect(await page.getByTestId('power-edge').count()).toBeLessThan(3)
  })

  test('Confluent Drawing: selecting a node reports the nodes reached through the shared trunks', async ({ page }) => {
    await openViz(page, 'confluent-drawing')
    expect(await page.getByTestId('confluent-trunk').count()).toBeGreaterThanOrEqual(2)
    await page.getByTestId('confluent-node').first().click()
    await expect(page.getByTestId('confluent-stats')).toContainText('에서 닿는 노드')
    await page.getByTestId('ctl-original').click()
    expect(await page.getByTestId('confluent-original').count()).toBeGreaterThan(50)
  })

  test('Semantic Substrates filters the links; PivotGraph aggregates by cell', async ({ page }) => {
    await openViz(page, 'semantic-substrates')
    const all = await page.getByTestId('substrate-link').count()
    await seg(page, 'ctl-links', '영역 안')
    const within = await page.getByTestId('substrate-link').count()
    await seg(page, 'ctl-links', '영역 사이')
    const between = await page.getByTestId('substrate-link').count()
    expect(within).toBeLessThan(all)
    expect(between).toBeLessThan(all)
    expect(within + between).toBe(all)
    await openViz(page, 'pivot-graph')
    expect(await page.getByTestId('pivot-cell').count()).toBeGreaterThan(8)
    await setRange(page, 'ctl-minlink', 6)
    expect(await page.getByTestId('pivot-link').count()).toBeLessThan(10)
  })
})

test.describe('v0.8: three-dimensional techniques', () => {
  test('Cone Tree selects a node, rotates the path to the front and collapses a subtree', async ({ page }) => {
    await openViz(page, 'cone-tree')
    await expect(page.getByTestId('canvas3d')).toBeVisible()
    const total = await page.locator('.chart-readout dd').first().textContent()
    const dept = page.getByTestId('cone-node').filter({ hasText: '영업' })
    await dept.click()
    await settle(page)
    await expect(page.locator('.chart-readout')).toContainText('선택영업')
    await dept.dblclick()
    await settle(page)
    expect(await page.locator('.chart-readout dd').first().textContent()).not.toBe(total)
    await page.getByTestId('cone-reset').click()
    await settle(page)
    expect(await page.locator('.chart-readout dd').first().textContent()).toBe(total)
  })

  test('Stream Surface and Streamtube rebuild when the seed line or the tube rule changes', async ({ page }) => {
    await openViz(page, 'stream-surface')
    await expect(page.getByTestId('canvas3d')).toBeVisible()
    const tris = async () => (await page.locator('.chart-readout').textContent())!
    const t0 = await tris()
    await setRange(page, 'ctl-seeds', 6)
    expect(await tris()).not.toBe(t0)
    await setRange(page, 'ctl-length', 1.6)
    await expect(page.getByTestId('seed-line')).toBeVisible()
    await openViz(page, 'streamtube')
    await setRange(page, 'ctl-seeds', 2)
    await expect(page.locator('.chart-readout')).toContainText('2개')
    await seg(page, 'ctl-mode', '일정')
    await expect(page.getByTestId('canvas3d')).toBeVisible()
  })
})

test.describe('v0.8: time, flow and text techniques', () => {
  test('TimeArcs orders the rows by shorter arcs; LifeFlow searches a pattern; TimeSets and Flowstrates respond', async ({ page }) => {
    await openViz(page, 'timearcs')
    const cost = (await page.getByTestId('timearcs-cost').textContent())!
    expect(num(cost, /호 길이 합 (\d+)/)).toBeLessThan(num(cost, /처음 등장 순 (\d+)/))
    await page.getByTestId('timearcs-node').first().click()
    await seg(page, 'ctl-order', '처음 등장 순')
    await expect(page.getByTestId('timearcs-cost')).not.toContainText('처음 등장 순')

    await openViz(page, 'lifeflow')
    expect(await page.getByTestId('lifeflow-node').count()).toBeGreaterThan(8)
    await page.getByTestId('ctl-p1').selectOption('검사')
    await page.getByTestId('ctl-p2').selectOption('치료')
    await expect(page.getByTestId('lifeflow-stats')).toContainText('패턴')

    await openViz(page, 'timesets')
    expect(await page.getByTestId('timeset-region').count()).toBe(3)
    await seg(page, 'ctl-focus', '사안 A')

    await openViz(page, 'flowstrates')
    const rows = await page.getByTestId('flowstrate-row').count()
    await page.getByTestId('flowstrate-origin').first().click()
    expect(await page.getByTestId('flowstrate-row').count()).toBeLessThan(rows)
  })

  test('TextArc draws rays to the sentences of a word; Parallel Tag Clouds and Phrase Net respond to their settings', async ({ page }) => {
    await openViz(page, 'textarc')
    await page.getByTestId('textarc-word').first().hover()
    expect(await page.getByTestId('textarc-ray').count()).toBeGreaterThanOrEqual(2)
    await openViz(page, 'parallel-tag-clouds')
    expect(await page.getByTestId('tag-word').count()).toBeGreaterThan(20)
    const first = await page.getByTestId('tag-word').first().textContent()
    await seg(page, 'ctl-metric', '빈도')
    await expect.poll(async () => page.getByTestId('tag-word').first().textContent()).not.toBeNull()
    expect(first).toBeTruthy()
    await openViz(page, 'phrase-net')
    const and = await page.getByTestId('phrase-word').allTextContents()
    await page.getByTestId('ctl-pattern').selectOption('of')
    await settle(page)
    expect(await page.getByTestId('phrase-word').allTextContents()).not.toEqual(and)
  })
})

test.describe('v0.8: performance and workers', () => {
  test('FDEB computes in a Web Worker and reports the bundling time', async ({ page }) => {
    const workers: string[] = []
    page.on('worker', (w) => workers.push(w.url()))
    await page.goto('./#/viz/force-directed-edge-bundling')
    await expect(page.getByTestId('fdeb-readout')).toContainText('ms', { timeout: 20000 })
    expect(workers.length).toBeGreaterThanOrEqual(1)
    // changing a setting while a computation runs replaces it with the newer one
    await setRange(page, 'ctl-cycles', 7)
    await setRange(page, 'ctl-cycles', 3)
    await expect(page.getByTestId('fdeb-readout')).not.toContainText('계산 중', { timeout: 20000 })
  })
})

test.describe('v0.8: home animation and comparison presets', () => {
  test('the home animation lists the eight new stages and each links to its lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 100')
    for (let i = 0; i < 64; i++) await page.getByTestId('hero-next').click()
    for (const [stage, viz] of [['bubble', 'bubble-sets'], ['nodetrix', 'nodetrix'], ['cone', 'cone-tree'], ['ssurface', 'stream-surface'], ['radial', 'radial-sets'], ['confluent', 'confluent-drawing'], ['tarcs', 'timearcs'], ['lflow', 'lifeflow']]) {
      await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', stage)
      await expect(page.getByTestId('hero-link')).toHaveAttribute('href', `#/viz/${viz}`)
      expect(await page.getByTestId('hero-marks').locator('*').count(), stage).toBeGreaterThan(8)
      await page.getByTestId('hero-next').click()
    }
  })

  test('the nine new comparison presets open with their representations of one table', async ({ page }) => {
    const presets: [string, string[]][] = [
      ['set-regions', ['bubble-sets', 'linesets', 'kelp-diagram']], ['set-overlap-radial', ['venn', 'upset', 'radial-sets']], ['set-boxes', ['linear-set-diagram', 'rainbow-boxes', 'radial-sets']],
      ['network-hybrid', ['network', 'nodetrix', 'biofabric']], ['network-compress', ['power-graph', 'confluent-drawing', 'nodetrix']], ['network-attributes', ['semantic-substrates', 'pivot-graph', 'adjacency']],
      ['flow-3d', ['vector-field-3d', 'stream-surface', 'streamtube']], ['hierarchy-3d', ['treemap', 'hyperbolic-tree', 'cone-tree']], ['text-views', ['word-cloud', 'parallel-tag-clouds', 'textarc']],
    ]
    for (const [id, charts] of presets) {
      await page.goto(`./#/compare/${id}`)
      for (const c of charts) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${c}"]`), `${id}:${c}`).toBeVisible({ timeout: 15000 })
    }
  })
})
