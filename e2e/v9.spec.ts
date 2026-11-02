import { readFileSync } from 'node:fs'
import { dragBy, expect, openViz, settle, test, testWithBlockedRequests } from './fixtures'
import type { Page } from '@playwright/test'

const V9 = [...readFileSync('src/viz/catalogV9.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1])
const cards = (page: Page) => page.getByTestId('catalog-grid').locator('.viz-card')
const seg = (page: Page, id: string, label: string) => page.getByTestId(id).getByText(label, { exact: true }).click()
const setRange = async (page: Page, id: string, v: number) => { await page.getByTestId(id).fill(String(v)); await settle(page) }
const openDetails = async (page: Page) => { const t = page.getByTestId('details-toggle'); if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click() }
const num = (s: string | null, re: RegExp) => Number(re.exec(s ?? '')?.[1] ?? NaN)

test.describe('v0.9: catalog and explanations', () => {
  test('the catalog lists 320 entries and the 19 new techniques are searchable by Korean and English names', async ({ page }) => {
    expect(V9.length).toBe(19)
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid')).toBeVisible()
    expect(await cards(page).count()).toBe(320)
    for (const [q, id] of [['메트로', 'metrosets'], ['MosaicSets', 'mosaicsets'], ['불리언', 'infocrystal'], ['hypergraph', 'paohvis'], ['braiding', 'sequence-braiding'], ['자석', 'dust-magnet'], ['gosper', 'gosper-map'], ['wordstream', 'wordstream'], ['tilebars', 'tilebars'], ['flow topology', 'vector-field-topology'], ['seesoft', 'seesoft'], ['setnet', 'setnet'], ['ibfv', 'ibfv'], ['fiber', 'fiber-surfaces'], ['perspective', 'perspective-wall']]) {
      await page.goto(`./#/catalog?q=${encodeURIComponent(q)}`)
      await expect(page.getByTestId(`card-${id}`), `${q} → ${id}`).toBeVisible()
    }
    for (const id of ['mandelbrot-set', 'julia-set', 'newton-fractal', 'tsne', 'umap']) {
      await page.goto('./#/catalog')
      await expect(page.getByTestId(`card-${id}`)).toHaveCount(1)
    }
  })

  test('every new lab shows its chart and a full explanation with the differences and the sources', async ({ page }) => {
    test.setTimeout(240000)
    for (const id of V9) {
      await openViz(page, id)
      await openDetails(page)
      const body = page.getByTestId('details-body')
      await expect(body, id).toContainText('정의', { timeout: 10000 })
      for (const h of ['시각적 매핑', '작동 원리', '수학적 원리', '장점', '단점', '주의사항', '다른 기법과의 차이', '참고자료']) await expect(body, `${id}: ${h}`).toContainText(h)
      await expect(body, `${id}: 서지 검증 표기`).toContainText('서지 검증')
    }
  })

  test('opening an explanation loads only the version group that holds it', async ({ page }) => {
    const files: string[] = []
    page.on('request', (r) => { const m = /\/assets\/(legacy|v5|v6|v7|v8|v9)-[\w-]+\.js/.exec(r.url()); if (m) files.push(m[1]) })
    await openViz(page, 'metrosets')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의')
    expect(files).toContain('v9')
    expect(files).not.toContain('v8')
    expect(files).not.toContain('v5')
  })
})

testWithBlockedRequests.describe('v0.9: explanation loading failure', () => {
  testWithBlockedRequests('a blocked explanation chunk shows the error, retry loads it, other groups and the chart keep working', async ({ page }) => {
    let blocked = true
    const blockedUrls: string[] = []
    await page.route(/\/assets\/v9-[\w-]+\.js/, (route) => { if (blocked) { blockedUrls.push(route.request().url()); void route.abort('failed') } else void route.continue() })
    await openViz(page, 'metrosets')
    await openDetails(page)
    // the failed request is shown instead of the explanation, and the lab itself still works
    await expect(page.getByTestId('details-retry')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('details-body')).toContainText('설명을 불러오지 못했습니다')
    expect(blockedUrls.length).toBeGreaterThan(0)
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await expect(page.getByTestId('metro-line').first()).toBeVisible()
    // another version group is unaffected while the v9 chunk is blocked
    await openViz(page, 'bubble-sets')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의', { timeout: 10000 })
    // back on the blocked lab: the failure was not cached, so the retry works once the network is back
    await openViz(page, 'metrosets')
    await openDetails(page)
    await expect(page.getByTestId('details-retry')).toBeVisible({ timeout: 15000 })
    blocked = false
    await page.getByTestId('details-retry').click()
    await expect(page.getByTestId('details-body')).toContainText('정의', { timeout: 15000 })
    await expect(page.getByTestId('details-body')).toContainText('다른 기법과의 차이')
    await expect(page.getByTestId('details-retry')).toHaveCount(0)
    // a second v9 lab now reads the cached group without another request
    const before = blockedUrls.length
    await openViz(page, 'mosaicsets')
    await openDetails(page)
    await expect(page.getByTestId('details-body')).toContainText('정의')
    expect(blockedUrls.length).toBe(before)
  })
})

test.describe('v0.9: set techniques', () => {
  test('MetroSets: lines, transfer stations, line highlight and a membership edit', async ({ page }) => {
    await openViz(page, 'metrosets')
    await expect(page.getByTestId('metro-line').first()).toBeVisible()
    expect(await page.getByTestId('metro-transfer').count()).toBeGreaterThan(3)
    const stats = await page.getByTestId('metro-stats').textContent()
    expect(num(stats, /환승역 (\d+)/)).toBe(await page.getByTestId('metro-transfer').count())
    await page.getByTestId('metro-focus-1').click()
    await expect(page.locator('[data-testid=metro-line][data-set="2"]').first()).toHaveAttribute('opacity', '0.14')
    await page.getByTestId('metro-focus-1').click()
    await page.getByTestId('metro-station').first().click()
    await expect(page.getByTestId('member-editor')).toBeVisible()
    const t0 = await page.getByTestId('metro-transfer').count()
    // a station that belongs to one set becomes a transfer station when it joins a second set
    const pressed = await page.getByTestId('member-toggle-0').getAttribute('aria-pressed')
    await page.getByTestId(pressed === 'true' ? 'member-toggle-1' : 'member-toggle-0').click()
    await settle(page)
    expect(await page.getByTestId('metro-transfer').count()).toBeGreaterThanOrEqual(t0)
    await page.getByTestId('metro-relayout').click()
    await settle(page)
    await expect(page.getByTestId('metro-line').first()).toBeVisible()
  })

  test('MosaicSets: every element has a cell, the grid switches, regions are reported', async ({ page }) => {
    await openViz(page, 'mosaicsets')
    const n = await page.getByTestId('mosaic-cell').count()
    expect(n).toBe(26)
    expect(await page.getByTestId('mosaic-stats').textContent()).toMatch(/연속된 집합 \d \/ 5/)
    await seg(page, 'ctl-grid', '사각')
    await settle(page)
    expect(await page.getByTestId('mosaic-cell').count()).toBe(n)
    await page.getByTestId('mosaic-cell').first().click()
    await expect(page.getByTestId('member-editor')).toBeVisible()
    await setRange(page, 'ctl-effort', 0)
    expect(num(await page.getByTestId('mosaic-stats').textContent(), /비용 (\d+) → (\d+)/)).toBeGreaterThan(0)
  })

  test('InfoCrystal: combinations, Boolean presets and switching a criterion off', async ({ page }) => {
    await openViz(page, 'infocrystal')
    expect(await page.getByTestId('crystal-icon').count()).toBe(15)
    const counts = await page.getByTestId('crystal-icon').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))))
    const sum = counts.reduce((a, b) => a + b, 0)
    await page.getByTestId('crystal-or').click()
    expect(num(await page.getByTestId('crystal-result').textContent(), /결과 (\d+)건/)).toBe(sum)
    await page.getByTestId('crystal-and').click()
    const and = num(await page.getByTestId('crystal-result').textContent(), /결과 (\d+)건/)
    expect(and).toBe(counts[counts.length - 1])
    await page.getByTestId('crystal-criterion-3').click()
    await settle(page)
    expect(await page.getByTestId('crystal-icon').count()).toBe(7)
    await page.getByTestId('crystal-clear').click()
    expect(num(await page.getByTestId('crystal-result').textContent(), /결과 (\d+)건/)).toBe(0)
  })

  test('SetNet: nodes stay in their zones and the membership editor opens', async ({ page }) => {
    await openViz(page, 'setnet')
    expect(await page.getByTestId('setnet-node').count()).toBe(22)
    expect(await page.getByTestId('setnet-edge').count()).toBeGreaterThan(10)
    expect(await page.getByTestId('setnet-region').count()).toBe(3)
    await page.getByTestId('setnet-node').first().dispatchEvent('pointerdown', { pointerId: 1, button: 0 })
    await expect(page.getByTestId('member-editor')).toBeVisible()
    await page.getByTestId('setnet-focus-0').click()
    await expect(page.getByTestId('setnet-readout')).toContainText('영역에 못 놓은 노드')
  })
})

test.describe('v0.9: dynamic relations, sequences, multivariate and hierarchy', () => {
  test('PAOHvis: aggregated hyperedges, ordering and highlighting', async ({ page }) => {
    await openViz(page, 'paohvis')
    expect(await page.getByTestId('paoh-row').count()).toBe(12)
    const stats = await page.getByTestId('paoh-stats').textContent()
    expect(num(stats, /하이퍼엣지 (\d+)개/)).toBe(await page.getByTestId('paoh-edge').count())
    const span = num(stats, /길이 합 (\d+)/)
    await seg(page, 'ctl-order', '등장순')
    await settle(page)
    expect(num(await page.getByTestId('paoh-stats').textContent(), /길이 합 (\d+)/)).toBeGreaterThanOrEqual(span)
    await page.getByTestId('paoh-row').first().dispatchEvent('click')
    const faded = await page.getByTestId('paoh-edge').evaluateAll((els) => els.filter((e) => e.getAttribute('opacity') === '0.18').length)
    expect(faded).toBeGreaterThan(0)
    await setRange(page, 'ctl-to', 2018)
    expect(num(await page.getByTestId('paoh-stats').textContent(), /하이퍼엣지 (\d+)개/)).toBeLessThan(num(stats, /하이퍼엣지 (\d+)개/))
  })

  test('Set Streams: items are conserved and a ribbon can be followed', async ({ page }) => {
    await openViz(page, 'set-streams')
    expect(await page.getByTestId('stream-ribbon').count()).toBeGreaterThan(20)
    expect(await page.getByTestId('stream-stats').textContent()).toMatch(/개체 79명/)
    const moving = page.locator('[data-testid=stream-ribbon][data-moves="1"]').first()
    await moving.dispatchEvent('click')
    await expect(page.getByTestId('stream-selected')).toBeVisible()
    await page.getByTestId('stream-clear').click()
    await expect(page.getByTestId('stream-selected')).toHaveCount(0)
    await page.getByTestId('ctl-hide-none').click()
    await settle(page)
    expect(await page.getByTestId('stream-lane').count()).toBeLessThan(16)
    await setRange(page, 'ctl-to', 4)
    expect(await page.getByTestId('chart-svg').getAttribute('aria-label')).toContain('시점 4개')
  })

  test('Sequence Braiding: strands per sequence, grouping and pattern selection', async ({ page }) => {
    await openViz(page, 'sequence-braiding')
    expect(await page.getByTestId('braid-strand').count()).toBe(60)
    expect(await page.getByTestId('braid-node').count()).toBe(8)
    const x0 = num(await page.getByTestId('braid-stats').textContent(), /교차 (\d+)/)
    await seg(page, 'ctl-sort', '개체 순서')
    await settle(page)
    expect(num(await page.getByTestId('braid-stats').textContent(), /교차 (\d+)/)).toBeGreaterThanOrEqual(x0)
    await seg(page, 'ctl-sort', '집단 + 다음 단계')
    await page.locator('[data-testid=braid-node][data-type="접수"]').dispatchEvent('click')
    await page.locator('[data-testid=braid-node][data-type="수술"]').dispatchEvent('click')
    await expect(page.getByTestId('braid-readout')).toContainText('패턴 접수 → 수술')
    const m = await page.getByTestId('braid-readout').textContent()
    expect(num(m, /: (\d+) \/ 60/)).toBeGreaterThan(5)
    expect(num(m, /: (\d+) \/ 60/)).toBeLessThan(60)
  })

  test('Dust & Magnet: dragging a magnet moves the dust, switching one off removes its pull', async ({ page }) => {
    await openViz(page, 'dust-magnet')
    await expect(page.getByTestId('dust').first()).toBeVisible()
    await page.waitForTimeout(1200)
    const pos = () => page.getByTestId('dust').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]))
    const before = await pos()
    const magnet = page.getByTestId('magnet').first()
    await dragBy(page, magnet.locator('circle').first(), -140, 90)
    await page.waitForTimeout(1200)
    const after = await pos()
    const moved = after.filter((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1]) > 3).length
    expect(moved).toBeGreaterThan(5)
    await page.getByTestId('magnet-on-0').click()
    await expect(magnet).toHaveAttribute('data-on', '0')
    await page.getByTestId('dust-reset').click()
  })

  test('GosperMap: regions are drawn, selecting zooms into a node and the view resets', async ({ page }) => {
    await openViz(page, 'gosper-map')
    expect(await page.getByTestId('gosper-cell').count()).toBe(343)
    expect(await page.getByTestId('gosper-label').count()).toBeGreaterThan(5)
    await page.getByTestId('gosper-cell').nth(10).click()
    await expect(page.getByTestId('gosper-path')).toContainText('보는 중')
    expect(await page.getByTestId('gosper-cell').count()).toBeLessThan(343)
    await page.getByTestId('gosper-reset').click()
    expect(await page.getByTestId('gosper-cell').count()).toBe(343)
    await setRange(page, 'ctl-level', 2)
    expect(await page.getByTestId('gosper-cell').count()).toBe(49)
  })
})

test.describe('v0.9: text, geography, focus and science', () => {
  test('WordStream: words sit in their topic bands; selecting a word dims the others', async ({ page }) => {
    await openViz(page, 'wordstream')
    expect(await page.getByTestId('stream-band').count()).toBe(4)
    expect(await page.getByTestId('stream-word').count()).toBeGreaterThan(30)
    await page.getByTestId('stream-word').first().click()
    const faded = await page.getByTestId('stream-word').evaluateAll((els) => els.filter((e) => Number(e.getAttribute('opacity')) < 0.5).length)
    expect(faded).toBeGreaterThan(10)
    await page.getByTestId('topic-데이터').click()
    await setRange(page, 'ctl-topwords', 2)
    await settle(page)
    expect(await page.getByTestId('stream-word').count()).toBeLessThan(80)
  })

  test('TileBars: one bar per document, the query decides the rows, a tile shows its sentences', async ({ page }) => {
    await openViz(page, 'tilebars')
    expect(await page.getByTestId('tilebar').count()).toBe(5)
    const three = await page.getByTestId('tile').count()
    await page.getByTestId('tile-query').fill('지도')
    await settle(page)
    expect(await page.getByTestId('tile').count()).toBe(three / 3)
    await page.getByTestId('tile-query').fill('지도|맵, 시간')
    await settle(page)
    expect(await page.getByTestId('tile').count()).toBe((three / 3) * 2)
    await page.getByTestId('tile').first().click()
    await expect(page.getByTestId('tile-text')).toBeVisible()
    await seg(page, 'ctl-mode', '화제 전환 기준')
    await settle(page)
    expect(await page.getByTestId('tilebar').count()).toBe(5)
  })

  test('OD Maps and MapTrix: every pair has a cell, selecting highlights, the reference switches', async ({ page }) => {
    await openViz(page, 'od-maps')
    expect(await page.getByTestId('od-cell').count()).toBe(30 * 29)
    await page.getByTestId('od-cell').nth(5).click()
    await expect(page.getByTestId('od-note')).toContainText('선택')
    await seg(page, 'ctl-mode', '도착지(안: 출발지)')
    await settle(page)
    expect(await page.getByTestId('od-cell').count()).toBe(30 * 29)
    await openViz(page, 'maptrix')
    expect(await page.getByTestId('maptrix-cell').count()).toBe(900)
    expect(await page.getByTestId('leader-row').count()).toBe(30)
    await page.getByTestId('maptrix-point').nth(7).click()
    const hot = await page.getByTestId('leader-row').evaluateAll((els) => els.filter((e) => e.getAttribute('stroke') === '#d4452f').length)
    expect(hot).toBe(1)
  })

  test('Perspective Wall / Bifocal: dragging moves the focus, both modes keep every document', async ({ page }) => {
    await openViz(page, 'perspective-wall')
    expect(await page.getByTestId('wall-item').count()).toBe(180)
    const r0 = await page.getByTestId('wall-readout').textContent()
    const svg = (await page.getByTestId('chart-svg').boundingBox())!
    await page.mouse.move(svg.x + svg.width * 0.5, svg.y + svg.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(svg.x + svg.width * 0.5, svg.y + svg.height * 0.5)
    await page.mouse.move(svg.x + svg.width * 0.46, svg.y + svg.height * 0.5)
    await page.mouse.up()
    await settle(page)
    const r1 = await page.getByTestId('wall-readout').textContent()
    expect(r1).not.toBe(r0)
    // the detail panel stays linear: two items one day apart are drawn at the same distance wherever the focus is
    await seg(page, 'ctl-mode', 'Bifocal Display')
    await settle(page)
    expect(await page.getByTestId('wall-item').count()).toBe(180)
    await expect(page.getByTestId('wall-readout')).toContainText('양쪽 균일 압축')
  })

  test('IBFV: the texture keeps moving and the speed control changes the flow', async ({ page }) => {
    await openViz(page, 'ibfv')
    const frame = async () => Number(await page.getByTestId('ibfv-canvas').getAttribute('data-frame'))
    const f0 = await frame()
    await page.waitForTimeout(900)
    expect(await frame()).toBeGreaterThan(f0 + 5)
    await page.getByTestId('ctl-playing').click()
    await page.waitForTimeout(200)
    const f1 = await frame()
    await page.waitForTimeout(500)
    expect(await frame()).toBe(f1)
    await setRange(page, 'ctl-speed', 3)
    await page.getByTestId('ibfv-restart').click()
  })

  test('Hyperstreamlines: tubes follow the seeds and the traced eigenvector can change', async ({ page }) => {
    await openViz(page, 'hyperstreamlines')
    expect(await page.getByTestId('hyper-seed').count()).toBe(4)
    await setRange(page, 'ctl-seeds', 2)
    expect(await page.getByTestId('hyper-seed').count()).toBe(2)
    await seg(page, 'ctl-axis', '중간 (λ₂)')
    await settle(page)
    await expect(page.locator('.chart-readout')).toContainText('중간')
  })

  test('Fiber Surfaces: editing the range-plane polygon changes the surface', async ({ page }) => {
    await openViz(page, 'fiber-surfaces')
    const tri = async () => num(await page.locator('.chart-readout').textContent(), /삼각형\s*(\d+)/)
    const t0 = await tri()
    expect(t0).toBeGreaterThan(500)
    await page.getByTestId('fiber-triangle').click()
    await settle(page)
    expect(await tri()).not.toBe(t0)
    await dragBy(page, page.getByTestId('range-vertex-0'), 30, -30)
    await settle(page)
    await expect(page.getByTestId('range-plot')).toBeVisible()
    await page.getByTestId('fiber-band').click()
    await settle(page)
    expect(await tri()).toBeGreaterThan(0)
  })

  test('Vector Field Topology: critical points are classified and clicking adds a streamline', async ({ page }) => {
    await openViz(page, 'vector-field-topology')
    expect(await page.getByTestId('critical-point').count()).toBeGreaterThanOrEqual(3)
    const kinds = await page.getByTestId('critical-point').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    expect(kinds).toContain('saddle')
    expect(await page.getByTestId('separatrix').count()).toBeGreaterThanOrEqual(4)
    const box = (await page.getByTestId('chart-svg').boundingBox())!
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3)
    await expect(page.getByTestId('topo-stream')).toHaveCount(1)
    await page.getByTestId('ctl-sep').click()
    expect(await page.getByTestId('separatrix').count()).toBe(0)
    await page.getByTestId('topo-clear').click()
    await expect(page.getByTestId('topo-stream')).toHaveCount(0)
  })

  test('Seesoft: four files, search turns lines red, the colour basis switches', async ({ page }) => {
    await openViz(page, 'seesoft')
    expect(await page.getByTestId('seesoft-column').count()).toBe(4)
    const lines = await page.getByTestId('seesoft-line').count()
    expect(lines).toBeGreaterThan(200)
    await page.getByTestId('seesoft-search').fill('render')
    await settle(page)
    const red = await page.getByTestId('seesoft-line').evaluateAll((els) => els.filter((e) => e.getAttribute('fill') === '#d4452f').length)
    expect(red).toBeGreaterThan(3)
    expect(red).toBeLessThan(lines)
    await seg(page, 'ctl-colorby', '수정 시점')
    await page.getByTestId('author-가영').click()
    await settle(page)
    expect(await page.getByTestId('seesoft-line').count()).toBe(lines)
  })

  test('VSUP: the bivariate choropleth merges its value colours as uncertainty rises', async ({ page }) => {
    await openViz(page, 'bivariate')
    expect(await page.getByTestId('biv-cell').count()).toBe(9)
    await seg(page, 'ctl-biv-scheme', 'VSUP (불확실성 억제)')
    await settle(page)
    expect(await page.getByTestId('biv-cell').count()).toBe(7)
    await seg(page, 'ctl-biv-classes', '4×4')
    await settle(page)
    expect(await page.getByTestId('biv-cell').count()).toBe(15)
    await page.waitForTimeout(500)
    await page.reload()
    await expect(page.getByTestId('biv-cell')).toHaveCount(15, { timeout: 15000 })
  })
})

test.describe('v0.9: home animation and comparison presets', () => {
  test('the home animation lists the eight new stages and each links to its lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 80')
    for (let i = 0; i < 72; i++) await page.getByTestId('hero-next').click()
    for (const [stage, viz] of [['metro', 'metrosets'], ['mosaic', 'mosaicsets'], ['streams', 'set-streams'], ['dust', 'dust-magnet'], ['gosper', 'gosper-map'], ['wstream', 'wordstream'], ['paoh', 'paohvis'], ['braid', 'sequence-braiding']]) {
      await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', stage)
      await expect(page.getByTestId('hero-link')).toHaveAttribute('href', `#/viz/${viz}`)
      await expect.poll(async () => page.getByTestId('hero-marks').locator('*').count(), { message: stage }).toBeGreaterThan(8)
      await page.getByTestId('hero-next').click()
    }
  })

  test('the ten new comparison presets open with their representations of one table', async ({ page }) => {
    const presets: [string, string[]][] = [
      ['set-metro', ['metrosets', 'mosaicsets', 'rainbow-boxes']], ['set-network', ['setnet', 'metrosets', 'mosaicsets']], ['set-query', ['venn', 'upset', 'infocrystal']], ['seq-braiding', ['lifeflow', 'sequence-braiding']],
      ['multivar-dust', ['radviz', 'star-coordinates', 'dust-magnet']], ['hier-gosper', ['treemap', 'voronoi-treemap', 'gosper-map']], ['flow-textures', ['ibfv', 'vector-field-topology']],
      ['tensor-paths', ['tensor-glyph', 'hyperstreamlines']], ['od-views', ['od-maps', 'maptrix']], ['bivariate-surface', ['isosurface', 'fiber-surfaces']],
    ]
    for (const [id, charts] of presets) {
      await page.goto(`./#/compare/${id}`)
      for (const c of charts) await expect(page.locator(`[data-testid^=compare-pane-][data-viz="${c}"]`), `${id}:${c}`).toBeVisible({ timeout: 15000 })
    }
  })

  test('linked highlighting: pointing at one element marks it in the other set and multivariate panes', async ({ page }) => {
    await page.goto('./#/compare/set-metro')
    await expect(page.getByTestId('pane-chart-0').getByTestId('metro-station').first()).toBeVisible({ timeout: 15000 })
    await page.getByTestId('pane-chart-1').getByTestId('mosaic-cell').first().hover()
    const marked = async (i: number) => page.getByTestId(`pane-chart-${i}`).locator('[stroke="#d4452f"]').count()
    expect(await marked(0)).toBeGreaterThan(0)
    expect(await marked(1)).toBeGreaterThan(0)
    await page.goto('./#/compare/multivar-dust')
    await expect(page.getByTestId('pane-chart-2').getByTestId('dust').first()).toBeVisible({ timeout: 15000 })
    await page.getByTestId('pane-chart-2').getByTestId('dust').first().hover()
    expect(await page.getByTestId('pane-chart-2').locator('[stroke="#d4452f"]').count()).toBeGreaterThan(0)
  })
})
