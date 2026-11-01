import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { domainColor, julia, makeNewtonFast, makePoly, mandelbrot, rational, hslToRgb, type Complex } from '../../stats/fractal'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { PALETTES, Plane, lut, type PlaneView } from './kitPlane'

/** Complex-plane charts: Mandelbrot set, Julia set, Newton fractal and domain colouring of a rational function. */

const paletteOptions = Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.name }))
const scale = (z: number) => `${z >= 1000 ? z.toExponential(1) : fmt(z, 1)}×`

function ViewReset({ params, setParams, home }: { params: PlaneView; setParams: (p: Partial<PlaneView>) => void; home: PlaneView }) {
  return (
    <div className="field">
      <button type="button" className="btn btn-secondary btn-sm" data-testid="plane-home" onClick={() => setParams(home)}>처음 영역으로</button>
      <p className="hint" style={{ margin: '6px 0 0' }}>끌어서 이동하고 휠로 커서 위치를 중심으로 확대합니다. 현재 중심 {fmt(params.cx, 4)} {params.cy < 0 ? '−' : '+'} {fmt(Math.abs(params.cy), 4)}i</p>
    </div>
  )
}

interface Site { name: string; x: number; y: number; zoom: number }
function readSites(table: DataTable, mapping: Mapping): Site[] {
  const ni = columnIndex(table, roleColumn(mapping, 'name')), xi = columnIndex(table, roleColumn(mapping, 're')), yi = columnIndex(table, roleColumn(mapping, 'im')), zi = columnIndex(table, roleColumn(mapping, 'zoom'))
  if (xi < 0 || yi < 0) return []
  const out: Site[] = []
  table.rows.forEach((r, i) => { const x = toNumber(r[xi]), y = toNumber(r[yi]); if (x != null && y != null) out.push({ name: ni >= 0 ? toLabel(r[ni]) || `지점 ${i + 1}` : `지점 ${i + 1}`, x, y, zoom: zi >= 0 ? toNumber(r[zi]) ?? 10 : 10 }) })
  return out
}

// ─── Mandelbrot ─────────────────────────────────────────────────────────────────────

export interface MandelParams extends PlaneView { iterations: number; power: number; palette: string; sites: boolean; interior: boolean }
const HOME_M: PlaneView = { cx: -0.5, cy: 0, span: 3.4 }
const siteRoles: RoleSpec[] = [
  { key: 'name', label: '이름 (선택)', type: 'category', auto: true },
  { key: 're', label: '실수부', type: 'number', required: true, prefer: '실수|re' },
  { key: 'im', label: '허수부', type: 'number', required: true, prefer: '허수|im' },
  { key: 'zoom', label: '권장 배율 (선택)', type: 'number', auto: true, prefer: '배율|zoom' },
]

function MandelChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<MandelParams>) {
  const sites = useMemo(() => readSites(table, mapping), [table, mapping])
  const colors = useMemo(() => lut(PALETTES[params.palette]?.interp ?? PALETTES.fire.interp), [params.palette])
  const iter = params.iterations
  const pixel = (x: number, y: number): [number, number, number] => {
    const t = mandelbrot(x, y, iter, params.power)
    if (t < 0) return params.interior ? [10, 10, 16] : [0, 0, 0]
    return colors[Math.floor((((Math.log(t + 1) / Math.log(iter + 1)) * 6) % 1) * 255)]
  }
  const zoomFactor = HOME_M.span / params.span
  return (
    <Plane width={width} height={height} compact={compact} view={params} setView={setParams} pixel={pixel} version={`${iter}|${params.power}|${params.palette}|${params.interior}`} title={`망델브로 집합: 배율 ${scale(zoomFactor)}`}
      minSpan={1e-13}
      info={(x, y) => { const t = mandelbrot(x, y, iter, params.power); return <><b>c = {fmt(x, 6)} {y < 0 ? '−' : '+'} {fmt(Math.abs(y), 6)}i</b><br />{t < 0 ? `${iter}회 안에 발산하지 않음 (집합 안)` : `${fmt(t, 1)}회째에 발산`}</> }}
      readout={[{ label: '배율', value: scale(zoomFactor) }, { label: '최대 반복', value: iter }, { label: '화소 크기', value: (params.span / Math.max(1, width)).toExponential(1) }]}
      note={zoomFactor > 1e13 ? '배정밀도(64비트) 한계에 도달했습니다 — 더 확대하면 화소가 뭉개집니다' : '검은색 = 반복 횟수 안에 발산하지 않은 점(집합에 속한다고 판정)'}
      overlay={({ x, y }) => params.sites && !compact ? (
        <g>{sites.map((s, i) => (
          <g key={i} transform={`translate(${x(s.x)},${y(s.y)})`} style={{ cursor: 'pointer' }} data-testid="mandel-site" onClick={(e) => { e.stopPropagation(); setParams({ cx: s.x, cy: s.y, span: Math.max(1e-12, HOME_M.span / s.zoom) }) }}>
            <circle r={5} fill="#ffffff" fillOpacity={0.85} stroke="#111827" /><text x={8} y={4} fontSize={11} fill="#ffffff" stroke="#111827" strokeWidth={2.4} paintOrder="stroke">{s.name}</text>
          </g>
        ))}</g>
      ) : null} />
  )
}

function MandelControls({ params, setParams }: ControlsProps<MandelParams>) {
  return (
    <>
      <ControlGroup title="영역">
        <ViewReset params={params} setParams={setParams} home={HOME_M} />
        <Toggle label="표의 지점 표시 (누르면 이동)" checked={params.sites} onChange={(sites) => setParams({ sites })} testId="ctl-sites" />
      </ControlGroup>
      <ControlGroup title="계산">
        <Slider label="최대 반복 횟수" value={params.iterations} min={30} max={1500} step={10} onChange={(iterations) => setParams({ iterations })} testId="ctl-iter" />
        <Slider label="거듭제곱 p (z → z^p + c)" value={params.power} min={2} max={6} onChange={(power) => setParams({ power })} testId="ctl-power" />
        <Select label="색상표" value={params.palette} options={paletteOptions} onChange={(palette) => setParams({ palette })} testId="ctl-palette" />
        <Hint>복소수 c마다 z₀ = 0에서 z → z² + c를 반복해 |z|가 커지면 발산한다고 보고, 발산하기까지의 횟수(부드러운 반복 횟수 n + 1 − log₂ log|z|)를 색으로 칠합니다. 반복 횟수 안에 발산하지 않은 점은 집합에 속하는 것으로 간주해 검게 둡니다. 확대할수록 경계의 세부가 계속 나타나므로 반복 횟수를 함께 늘려야 합니다. 실수 계산은 64비트 부동소수점이라 약 10¹³배 배율이 한계입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const mandelbrotModule: VizModule<MandelParams> = {
  roles: siteRoles, datasets: ['mandelbrot-sites'], defaultParams: { ...HOME_M, iterations: 200, power: 2, palette: 'fire', sites: true, interior: true },
  Chart: MandelChart, Controls: MandelControls, hint: '끌어서 이동 · 휠로 확대 · 표시된 지점을 누르면 그곳으로 이동 · 반복 횟수를 늘리면 깊은 경계가 보입니다',
}

// ─── Julia ──────────────────────────────────────────────────────────────────────────

export interface JuliaParams extends PlaneView { cRe: number; cIm: number; iterations: number; palette: string; inset: boolean }
const HOME_J: PlaneView = { cx: 0, cy: 0, span: 3.2 }
const juliaRoles: RoleSpec[] = [
  { key: 'name', label: '이름 (선택)', type: 'category', auto: true },
  { key: 're', label: 'c 실수부', type: 'number', required: true, prefer: '실수|re' },
  { key: 'im', label: 'c 허수부', type: 'number', required: true, prefer: '허수|im' },
]

function MandelInset({ sites, c, setC, w, h }: { sites: Site[]; c: Complex; setC: (re: number, im: number) => void; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const colors = useMemo(() => lut(d3.interpolateGreys), [])
  const dom = { x: [-2.2, 0.8], y: [-1.1, 1.1] }
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d'); if (!ctx) return
    const img = ctx.createImageData(w, h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const t = mandelbrot(dom.x[0] + ((i + 0.5) / w) * 3, dom.y[1] - ((j + 0.5) / h) * 2.2, 60)
      const o = (j * w + i) * 4, v = t < 0 ? 40 : 255 - Math.min(190, t * 18)
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [w, h, colors]) // eslint-disable-line react-hooks/exhaustive-deps
  const px = (re: number) => ((re - dom.x[0]) / 3) * w, py = (im: number) => ((dom.y[1] - im) / 2.2) * h
  return (
    <div style={{ position: 'absolute', right: 14, bottom: 52, width: w, height: h, border: '1px solid #9ca3af', borderRadius: 6, overflow: 'hidden', background: '#fff', zIndex: 2 }} data-testid="julia-inset" title="매개변수 평면: 눌러서 c 고르기">
      <canvas ref={ref} style={{ width: w, height: h, display: 'block' }} />
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setC(dom.x[0] + ((e.clientX - r.left) / w) * 3, dom.y[1] - ((e.clientY - r.top) / h) * 2.2) }}>
        {sites.map((s, i) => <circle key={i} cx={px(s.x)} cy={py(s.y)} r={3} fill="#2a8c82" stroke="#fff" />)}
        <circle cx={px(c[0])} cy={py(c[1])} r={5} fill="#e11d48" stroke="#fff" strokeWidth={1.5} />
      </svg>
    </div>
  )
}

function JuliaChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<JuliaParams>) {
  const sites = useMemo(() => readSites(table, mapping), [table, mapping])
  const colors = useMemo(() => lut(PALETTES[params.palette]?.interp ?? PALETTES.ocean.interp), [params.palette])
  const iter = params.iterations
  const pixel = (x: number, y: number): [number, number, number] => {
    const t = julia(x, y, params.cRe, params.cIm, iter)
    if (t < 0) return [8, 10, 20]
    return colors[Math.floor((((Math.log(t + 1) / Math.log(iter + 1)) * 5) % 1) * 255)]
  }
  const inMandel = mandelbrot(params.cRe, params.cIm, 400) < 0
  return (
    <Plane width={width} height={height} compact={compact} view={params} setView={setParams} pixel={pixel} version={`${params.cRe}|${params.cIm}|${iter}|${params.palette}`} title={`줄리아 집합: c = ${fmt(params.cRe, 3)} ${params.cIm < 0 ? '−' : '+'} ${fmt(Math.abs(params.cIm), 3)}i`}
      resolution={0.7} xLabel="Re z" yLabel="Im z"
      info={(x, y) => { const t = julia(x, y, params.cRe, params.cIm, iter); return <><b>z₀ = {fmt(x, 4)} {y < 0 ? '−' : '+'} {fmt(Math.abs(y), 4)}i</b><br />{t < 0 ? '발산하지 않음 (채운 줄리아 집합 안)' : `${fmt(t, 1)}회째에 발산`}</> }}
      readout={[{ label: 'c', value: `${fmt(params.cRe, 3)}, ${fmt(params.cIm, 3)}` }, { label: '연결성', value: inMandel ? '연결 (c ∈ 망델브로)' : '끊어짐 (먼지)' }]}
      note="어두운 영역 = 발산하지 않는 점들, 오른쪽 아래 작은 지도에서 c를 고르세요"
      extra={params.inset && !compact ? <MandelInset sites={sites} c={[params.cRe, params.cIm]} setC={(cRe, cIm) => setParams({ cRe: +cRe.toFixed(4), cIm: +cIm.toFixed(4) })} w={150} h={110} /> : null} />
  )
}

function JuliaControls({ params, setParams, table, mapping }: ControlsProps<JuliaParams>) {
  const sites = readSites(table, mapping)
  return (
    <>
      <ControlGroup title="매개변수 c">
        <Slider label="c 실수부" value={params.cRe} min={-2} max={1} step={0.001} onChange={(cRe) => setParams({ cRe })} testId="ctl-cre" format={(v) => v.toFixed(3)} />
        <Slider label="c 허수부" value={params.cIm} min={-1.5} max={1.5} step={0.001} onChange={(cIm) => setParams({ cIm })} testId="ctl-cim" format={(v) => v.toFixed(3)} />
        {sites.length > 0 && <Select label="표의 대표값 불러오기" value="" onChange={(v) => { const s = sites[Number(v)]; if (s) setParams({ cRe: s.x, cIm: s.y }) }} testId="ctl-preset" options={[{ value: '', label: '선택…' }, ...sites.map((s, i) => ({ value: String(i), label: s.name }))]} />}
        <Toggle label="매개변수 평면(망델브로) 보기" checked={params.inset} onChange={(inset) => setParams({ inset })} />
      </ControlGroup>
      <ControlGroup title="영역과 색">
        <ViewReset params={params} setParams={setParams} home={HOME_J} />
        <Slider label="최대 반복 횟수" value={params.iterations} min={30} max={800} step={10} onChange={(iterations) => setParams({ iterations })} testId="ctl-iter" />
        <Select label="색상표" value={params.palette} options={paletteOptions} onChange={(palette) => setParams({ palette })} testId="ctl-palette" />
        <Hint>고정한 c에서 z → z² + c를 반복할 때 시작점 z₀가 발산하는지를 칠한 줄리아 집합입니다. 같은 c의 망델브로 집합에서의 위치가 곧 줄리아 집합의 위상을 정합니다: c가 망델브로 집합 안이면 줄리아 집합은 연결되어 있고, 밖이면 칸토어 먼지처럼 흩어집니다. 작은 지도에서 초록 점은 표의 대표값이고 빨간 점이 현재 c입니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const juliaModule: VizModule<JuliaParams> = {
  roles: juliaRoles, datasets: ['julia-presets'], defaultParams: { ...HOME_J, cRe: -0.8, cIm: 0.156, iterations: 200, palette: 'ocean', inset: true },
  Chart: JuliaChart, Controls: JuliaControls, hint: '작은 망델브로 지도를 눌러 c를 고르면 줄리아 집합이 바뀝니다 · 경계 근처의 c일수록 복잡합니다',
}

// ─── Newton fractal ─────────────────────────────────────────────────────────────────

export interface NewtonParams extends PlaneView { iterations: number; relax: number; shade: boolean; roots: boolean }
const HOME_N: PlaneView = { cx: 0, cy: 0, span: 4 }
const polyRoles: RoleSpec[] = [
  { key: 'power', label: '지수 k', type: 'number', required: true, prefer: '지수|power|차수' },
  { key: 're', label: '계수 실수부', type: 'number', required: true, prefer: '실수|re' },
  { key: 'im', label: '계수 허수부 (선택)', type: 'number', auto: true, prefer: '허수|im' },
]

function readPoly(table: DataTable, mapping: Mapping): Complex[] {
  const pi = columnIndex(table, roleColumn(mapping, 'power')), ri = columnIndex(table, roleColumn(mapping, 're')), ii = columnIndex(table, roleColumn(mapping, 'im'))
  const coeffs: Complex[] = []
  if (pi < 0 || ri < 0) return coeffs
  for (const r of table.rows) {
    const k = toNumber(r[pi]), a = toNumber(r[ri]), b = ii >= 0 ? toNumber(r[ii]) ?? 0 : 0
    if (k == null || a == null || !Number.isInteger(k) || k < 0 || k > 12) continue
    while (coeffs.length <= k) coeffs.push([0, 0])
    coeffs[k] = [coeffs[k][0] + a, coeffs[k][1] + b]
  }
  return coeffs
}

const termText = (c: Complex[]) => c.map((v, k) => [v, k] as const).filter(([v]) => v[0] !== 0 || v[1] !== 0).reverse().map(([v, k], i) => `${i > 0 && v[0] >= 0 && v[1] === 0 ? '+ ' : ''}${v[1] !== 0 ? `(${fmt(v[0], 2)}${v[1] >= 0 ? '+' : ''}${fmt(v[1], 2)}i)` : Math.abs(v[0]) === 1 && k > 0 ? (v[0] < 0 ? '−' : '') : fmt(v[0], 2)}${k > 0 ? `z${k > 1 ? `^${k}` : ''}` : ''}`).join(' ')

function NewtonChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<NewtonParams>) {
  const coeffs = useMemo(() => readPoly(table, mapping), [table, mapping])
  const poly = useMemo(() => (coeffs.length > 1 ? makePoly(coeffs) : null), [coeffs])
  const solve = useMemo(() => (poly ? makeNewtonFast(poly) : null), [poly])
  const rootColors = useMemo(() => (poly ? poly.roots.map((_, i) => i / poly.roots.length) : []), [poly])
  if (!poly || !solve || !poly.roots.length) return <ChartMessage>다항식의 항(지수·계수)을 입력하세요. 지수 1 이상의 항이 하나는 있어야 합니다.</ChartMessage>
  const iter = params.iterations
  const pixel = (x: number, y: number): [number, number, number] => {
    const r = solve(x, y, iter, params.relax)
    if (r.root < 0) return [0, 0, 0]
    const l = params.shade ? 0.72 - 0.5 * Math.min(1, (r.iter - 1) / Math.min(iter, 24)) : 0.55
    return hslToRgb(0.02 + rootColors[r.root] * 0.96, 0.8, Math.max(0.12, l))
  }
  return (
    <Plane width={width} height={height} compact={compact} view={params} setView={setParams} pixel={pixel} version={`${coeffs.map((c) => c.join(',')).join(';')}|${iter}|${params.relax}|${params.shade}`} title={`뉴턴 프랙탈: p(z) = ${termText(coeffs)}`}
      info={(x, y) => { const r = solve(x, y, iter, params.relax); return <><b>시작점 {fmt(x, 4)} {y < 0 ? '−' : '+'} {fmt(Math.abs(y), 4)}i</b><br />{r.root < 0 ? '근에 수렴하지 않음' : `근 ${fmt(poly.roots[r.root][0], 3)} ${poly.roots[r.root][1] < 0 ? '−' : '+'} ${fmt(Math.abs(poly.roots[r.root][1]), 3)}i로 ${r.iter}회에 수렴`}</> }}
      readout={[{ label: '근의 수', value: poly.roots.length }, { label: '차수', value: coeffs.length - 1 }, { label: '완화 계수', value: fmt(params.relax, 2) }]}
      note="색 = 수렴한 근, 밝기 = 수렴 속도(밝을수록 빠름), 검정 = 수렴하지 않음"
      overlay={({ x, y }) => params.roots && !compact ? <g>{poly.roots.map((r, i) => <circle key={i} cx={x(r[0])} cy={y(r[1])} r={5} fill="#ffffff" stroke="#111827" strokeWidth={1.6} />)}</g> : null} />
  )
}

function NewtonControls({ params, setParams }: ControlsProps<NewtonParams>) {
  return (
    <>
      <ControlGroup title="영역">
        <ViewReset params={params} setParams={setParams} home={HOME_N} />
        <Toggle label="근 표시" checked={params.roots} onChange={(roots) => setParams({ roots })} />
      </ControlGroup>
      <ControlGroup title="뉴턴법">
        <Slider label="최대 반복 횟수" value={params.iterations} min={8} max={120} onChange={(iterations) => setParams({ iterations })} testId="ctl-iter" />
        <Slider label="완화 계수 λ (z ← z − λ p/p′)" value={params.relax} min={0.3} max={1.6} step={0.02} onChange={(relax) => setParams({ relax })} testId="ctl-relax" />
        <Toggle label="수렴 속도로 밝기 조절" checked={params.shade} onChange={(shade) => setParams({ shade })} />
        <Hint>표의 항으로 만든 다항식 p(z)의 근을 Durand–Kerner로 구한 뒤, 평면의 모든 시작점에서 뉴턴 반복 z ← z − p(z)/p′(z)를 돌려 어느 근으로 수렴하는지를 색으로 칠합니다. 근 사이의 경계에서는 시작점의 작은 차이가 다른 근으로 이어져 프랙탈이 됩니다. 완화 계수 λ가 1이 아니면 완화(Nova) 뉴턴법이 되어 수렴 영역이 바뀌고, z³ − 2z + 2에서는 근에 수렴하지 못하는 검은 영역(주기 2 순환)이 나타납니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const newtonModule: VizModule<NewtonParams> = {
  roles: polyRoles, datasets: ['newton-z3', 'newton-z5', 'newton-nova'], defaultParams: { ...HOME_N, iterations: 40, relax: 1, shade: true, roots: true },
  Chart: NewtonChart, Controls: NewtonControls, hint: '표의 행을 고쳐 다항식을 바꿔 보세요 · 완화 계수를 1에서 벗어나게 하면 경계가 변합니다',
}

// ─── domain colouring ───────────────────────────────────────────────────────────────

export interface DomainParams extends PlaneView { modulus: boolean; phase: boolean; markers: boolean }
const HOME_D: PlaneView = { cx: 0, cy: 0, span: 5 }
const zpRoles: RoleSpec[] = [
  { key: 'kind', label: '종류 (영점 / 극점)', type: 'category', required: true },
  { key: 're', label: '실수부', type: 'number', required: true, prefer: '실수|re' },
  { key: 'im', label: '허수부', type: 'number', required: true, prefer: '허수|im' },
]

function readZP(table: DataTable, mapping: Mapping) {
  const ki = columnIndex(table, roleColumn(mapping, 'kind')), ri = columnIndex(table, roleColumn(mapping, 're')), ii = columnIndex(table, roleColumn(mapping, 'im'))
  const zeros: Complex[] = [], poles: Complex[] = []
  if (ki < 0 || ri < 0 || ii < 0) return { zeros, poles }
  for (const r of table.rows) {
    const a = toNumber(r[ri]), b = toNumber(r[ii]), k = toLabel(r[ki])
    if (a == null || b == null) continue
    if (/극|pole/i.test(k)) poles.push([a, b]); else if (/영|zero/i.test(k)) zeros.push([a, b])
  }
  return { zeros, poles }
}

function DomainChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<DomainParams>) {
  const { zeros, poles } = useMemo(() => readZP(table, mapping), [table, mapping])
  if (!zeros.length && !poles.length) return <ChartMessage>영점 또는 극점 행이 하나 이상 필요합니다. ‘종류’ 열에 ‘영점’ 또는 ‘극점’을 쓰세요.</ChartMessage>
  const pixel = (x: number, y: number) => domainColor(rational([x, y], zeros, poles), { modulus: params.modulus, phase: params.phase })
  return (
    <Plane width={width} height={height} compact={compact} view={params} setView={setParams} pixel={pixel} version={`${zeros.join(';')}|${poles.join(';')}|${params.modulus}|${params.phase}`} title={`영역 채색: 영점 ${zeros.length}개, 극점 ${poles.length}개`} resolution={0.7}
      info={(x, y) => { const w = rational([x, y], zeros, poles); return <><b>z = {fmt(x, 3)} {y < 0 ? '−' : '+'} {fmt(Math.abs(y), 3)}i</b><br />|f(z)| = {fmt(Math.hypot(w[0], w[1]), 4)}<br />arg f(z) = {fmt((Math.atan2(w[1], w[0]) * 180) / Math.PI, 1)}°</> }}
      readout={[{ label: '영점', value: zeros.length }, { label: '극점', value: poles.length }, { label: '차수 (영점 − 극점)', value: zeros.length - poles.length }]}
      note="색상 = f(z)의 편각, 밝기 = |f(z)|의 로그 눈금 (검정 = 영점, 흰색 = 극점)"
      overlay={({ x, y }) => params.markers && !compact ? (
        <g>
          {zeros.map((z, i) => <circle key={`z${i}`} cx={x(z[0])} cy={y(z[1])} r={5} fill="none" stroke="#fff" strokeWidth={2} />)}
          {poles.map((z, i) => <g key={`p${i}`} transform={`translate(${x(z[0])},${y(z[1])})`} stroke="#111827" strokeWidth={2.2}><line x1={-5} y1={-5} x2={5} y2={5} /><line x1={-5} y1={5} x2={5} y2={-5} /></g>)}
        </g>
      ) : null} />
  )
}

function DomainControls({ params, setParams }: ControlsProps<DomainParams>) {
  return (
    <ControlGroup title="영역 채색">
      <ViewReset params={params} setParams={setParams} home={HOME_D} />
      <Toggle label="크기(|f|) 등치선 밝기" checked={params.modulus} onChange={(modulus) => setParams({ modulus })} testId="ctl-modulus" />
      <Toggle label="편각 등치선" checked={params.phase} onChange={(phase) => setParams({ phase })} testId="ctl-phase" />
      <Toggle label="영점(○)·극점(×) 표시" checked={params.markers} onChange={(markers) => setParams({ markers })} />
      <Hint>복소함수 f는 평면의 점을 평면의 점으로 보냅니다. 입력 z마다 출력 w = f(z)의 편각을 색상으로, 크기 |w|를 밝기로 칠하면 함수 전체를 한 장에 볼 수 있습니다. 표의 영점 a와 극점 b로 f(z) = Π(z − a)/Π(z − b)를 만듭니다. 영점 주위에서는 색이 한 바퀴(차수가 n이면 n바퀴) 돌고 극점 주위에서는 반대 방향으로 돕니다. 색의 회전 횟수의 합은 편각 원리(영점 수 − 극점 수)와 같습니다.</Hint>
    </ControlGroup>
  )
}

export const domainModule: VizModule<DomainParams> = {
  roles: zpRoles, datasets: ['zeros-poles-a', 'zeros-poles-b'], defaultParams: { ...HOME_D, modulus: true, phase: true, markers: true },
  Chart: DomainChart, Controls: DomainControls, hint: '영점·극점 행을 추가하거나 옮겨 보세요 · 영점 주위로 색이 한 바퀴 도는 방향이 극점과 반대입니다',
}
