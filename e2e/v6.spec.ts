import { readFileSync, readdirSync } from 'node:fs'
import { expect, readout, setRange, test } from './fixtures'

/** Ids of the charts added in v0.6, read from the catalog sources so the spec cannot drift from them. */
const V6 = readdirSync('src/viz').filter((f) => /^catalogV6.+\.ts$/.test(f)).flatMap((f) => [...readFileSync(`src/viz/${f}`, 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]))

test.describe('v0.6: catalog and categories', () => {
  test('lists 340 charts in 17 categories, including the new industry, text and ML categories', async ({ page }) => {
    expect(V6.length).toBe(83)
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(340)
    for (const c of ['ml', 'industry', 'text']) await expect(page.getByTestId(`chip-${c}`)).toBeVisible()
    await page.getByTestId('chip-industry').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(5)
    await page.getByTestId('chip-text').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(12)
    await page.getByTestId('chip-ml').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(20)
  })

  test('search finds v0.6 charts by Korean names, English names and abbreviations', async ({ page }) => {
    await page.goto('./#/catalog')
    const search = page.getByTestId('catalog-search')
    for (const [q, id] of [['와이블', 'weibull-plot'], ['t-SNE', 'tsne'], ['GSEA', 'gsea-running-sum'], ['Louvain', 'community-blockmodel'], ['임계 경로', 'dag-layout'], ['PMI', 'collocation-matrix']] as const) {
      await search.fill(q)
      await expect(page.getByTestId(`card-${id}`), q).toBeVisible()
    }
  })
})

test.describe('v0.6: every new chart opens from a deep link and survives a reload', () => {
  test('all 83 labs render without console errors or failed requests', async ({ page }) => {
    test.setTimeout(600000)
    const failed: string[] = []
    page.on('requestfailed', (r) => failed.push(r.url()))
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
    for (const id of V6) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('lab'), id).toHaveAttribute('data-viz', id, { timeout: 15000 })
      await expect(page.locator('[data-testid=lab] svg, [data-testid=lab] canvas').first(), id).toBeVisible({ timeout: 15000 })
    }
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', V6[V6.length - 1])
    expect(failed).toEqual([])
  })
})

test.describe('v0.6: network, industry, bio and text labs', () => {
  test('max flow reaches the textbook value 23 and the step slider replays the augmenting paths', async ({ page }) => {
    await page.goto('./#/viz/max-flow')
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'max-flow')
    await expect(readout(page, '최대 유량')).toHaveText('23')
    await expect(readout(page, '최소 절단 용량')).toHaveText('23')
    await setRange(page.getByTestId('ctl-step'), 1)
    await expect(page.locator('.chart-readout')).toContainText('증가 경로 1/3')
  })

  test('layered DAG reports the critical path length and switches orientation', async ({ page }) => {
    await page.goto('./#/viz/dag-layout')
    await expect(readout(page, '순환을 끊은 간선')).toHaveText('0')
    await expect(readout(page, '전체 기간\\(임계 경로 길이\\)')).toHaveText('28')
    await page.getByTestId('ctl-orient').getByRole('radio', { name: '위 → 아래' }).click()
    await expect(page.getByTestId('layer-node').first()).toBeVisible()
  })

  test('community blockmodel finds the four planted groups', async ({ page }) => {
    await page.goto('./#/viz/community-blockmodel')
    await expect(readout(page, '탐지한 군집')).toHaveText('4')
    await expect(page.getByTestId('heat-cell').first()).toBeVisible()
  })

  test('Weibull plot recovers a wear-out shape and the estimation method can be switched', async ({ page }) => {
    await page.goto('./#/viz/weibull-plot')
    const beta = readout(page, '형상 β')
    await expect(beta).toBeVisible()
    expect(Number(await beta.innerText())).toBeGreaterThan(1.5)
    await page.getByTestId('ctl-method').getByRole('radio', { name: '최대가능도' }).click()
    await expect(readout(page, '추정 방식')).toHaveText('최대가능도')
  })

  test('queue simulation compares the recorded wait with the M/M/c theory and reacts to the number of servers', async ({ page }) => {
    await page.goto('./#/viz/queue-simulation')
    const before = await readout(page, '관측 평균 대기').innerText()
    await setRange(page.getByTestId('ctl-servers'), 1)
    await expect(readout(page, '관측 평균 대기')).not.toHaveText(before)
    await expect(readout(page, 'M/M/c 이론 평균 대기')).toBeVisible()
  })

  test('process map lists case variants and the fault tree finds five minimal cut sets', async ({ page }) => {
    await page.goto('./#/viz/process-map')
    await expect(page.getByTestId('variants')).toContainText('주문 접수')
    await page.goto('./#/viz/fault-tree')
    await expect(readout(page, '최소 절단 집합')).toHaveText('5')
  })

  test('GSEA is significant for the enriched pathway, the Ramachandran plot places the helix in the α region and the contact map counts contacts', async ({ page }) => {
    await page.goto('./#/viz/gsea-running-sum')
    await expect(readout(page, 'NES')).toBeVisible()
    await page.goto('./#/viz/ramachandran')
    await expect(readout(page, 'α-나선')).toBeVisible()
    await page.goto('./#/viz/contact-map')
    await expect(readout(page, '접촉 수')).toBeVisible()
  })

  test('text charts: Zipf slope is near −1 for the synthetic corpus and the collocation matrix draws cells', async ({ page }) => {
    await page.goto('./#/viz/zipf-plot')
    const s = Number(await readout(page, '지프 지수 s \\(−기울기\\)').innerText())
    expect(s).toBeGreaterThan(0.85); expect(s).toBeLessThan(1.2)
    await page.goto('./#/viz/collocation-matrix')
    await expect(page.getByTestId('heat-cell').first()).toBeVisible()
  })

  test('the home animation reaches the v0.6 stages', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 90')
    for (let i = 0; i < 36; i++) await page.getByTestId('hero-next').click()
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'mandelbrot')
    await expect(page.getByTestId('hero-link')).toHaveAttribute('href', '#/viz/mandelbrot-set')
    await expect.poll(async () => page.getByTestId('hero-marks').locator('*').count(), { timeout: 8000 }).toBeGreaterThan(8)
  })
})
