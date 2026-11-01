import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { HIGH_SYMMETRY, bandPath, dos, eutectic, leverRule, liquidusX, rdf, type Component, type LatticeId, type TbParams, type V3 } from '../../stats/physics'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { Panels, XYPlot, type Layer } from './kit'

/** Condensed-matter and materials charts: radial distribution function, band structure, density of states and binary phase diagram. */

// ─── radial distribution function ───────────────────────────────────────────────────

export interface RdfParams { dr: number; rmax: number; showN: boolean }
const rdfRoles: RoleSpec[] = [
  { key: 'x', label: 'x 좌표', type: 'number', required: true, prefer: 'x' },
  { key: 'y', label: 'y 좌표', type: 'number', required: true, prefer: 'y' },
  { key: 'z', label: 'z 좌표', type: 'number', required: true, prefer: 'z' },
  { key: 'box', label: '주기 상자 한 변 (선택)', type: 'number', auto: true, prefer: '상자|box|L' },
]

function readParticles(table: DataTable, mapping: Mapping) {
  const xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z')), bi = columnIndex(table, roleColumn(mapping, 'box'))
  const pos: V3[] = []
  let box = NaN
  if (xi >= 0 && yi >= 0 && zi >= 0) table.rows.forEach((r) => {
    const x = toNumber(r[xi]), y = toNumber(r[yi]), z = toNumber(r[zi])
    if (x != null && y != null && z != null) pos.push([x, y, z])
    if (bi >= 0 && Number.isNaN(box)) { const b = toNumber(r[bi]); if (b != null && b > 0) box = b }
  })
  if (Number.isNaN(box) && pos.length) box = Math.max(...[0, 1, 2].map((k) => Math.max(...pos.map((p) => p[k])) - Math.min(...pos.map((p) => p[k])))) * 1.05
  return { pos, box }
}

function RdfChart({ table, mapping, params, width, height, compact }: ChartProps<RdfParams>) {
  const { pos, box } = useMemo(() => readParticles(table, mapping), [table, mapping])
  const res = useMemo(() => (pos.length >= 20 && box > 0 ? rdf(pos, box, params.dr, params.rmax * (box / 2)) : null), [pos, box, params.dr, params.rmax])
  if (!res) return <ChartMessage>x, y, z 좌표 열을 고르세요. 입자가 20개 이상 필요합니다.</ChartMessage>
  const g = res.g
  // first peak, then the first minimum after it, and the coordination number there
  let pk = 0
  for (let i = 1; i < g.length - 1; i++) if (g[i] > g[pk]) pk = i
  let mn = pk
  for (let i = pk + 1; i < g.length - 1; i++) { mn = i; if (g[i] < g[i + 1] && g[i] < g[i - 1]) break }
  const first: Layer[] = [{ kind: 'hline', v: 1, color: '#9aa1a9' }, { kind: 'line', x: res.r, y: g, color: '#2a8c82', width: 2.4, label: 'g(r)' }, { kind: 'points', color: '#e07a3f', r: 5, pts: [{ x: res.r[pk], y: g[pk], tip: <><b>첫 번째 봉우리</b><br />r = {fmt(res.r[pk], 3)}<br />g = {fmt(g[pk], 2)}</> }] }]
  const common = { width, compact }
  const readout = [{ label: '입자 수 밀도 ρ', value: fmt(res.density, 3) }, { label: '첫 봉우리', value: `r = ${fmt(res.r[pk], 2)}` }, { label: '첫 껍질 배위수', value: fmt(res.coordination[mn], 1) }]
  if (compact || !params.showN) return <XYPlot {...common} height={height} hover xLabel="거리 r" yLabel="g(r)" title={`방사 분포 함수: N = ${pos.length}, L = ${fmt(box, 2)}`} layers={first} readout={readout} />
  return (
    <Panels width={width} height={height} parts={[3, 2]}>
      {[
        (h) => <XYPlot {...common} height={h} hover xLabel="" yLabel="g(r)" title={`방사 분포 함수: N = ${pos.length}, L = ${fmt(box, 2)}`} margin={{ bottom: 22 }} layers={first} readout={readout} />,
        (h) => <XYPlot {...common} height={h} hover xLabel="거리 r" yLabel="누적 배위수 n(r)" title="누적 배위수" margin={{ top: 12 }} layers={[{ kind: 'line', x: res.r, y: res.coordination, color: '#4c6fb5', width: 2.2, label: 'n(r)' }, { kind: 'vline', v: res.r[mn], color: '#e07a3f' }]} />,
      ]}
    </Panels>
  )
}

function RdfControls({ params, setParams }: ControlsProps<RdfParams>) {
  return (
    <ControlGroup title="방사 분포 함수">
      <Slider label="거리 구간 폭 dr" value={params.dr} min={0.01} max={0.2} step={0.01} onChange={(dr) => setParams({ dr })} testId="ctl-dr" />
      <Slider label="최대 거리 (상자 절반의 비율)" value={params.rmax} min={0.3} max={1} step={0.05} onChange={(rmax) => setParams({ rmax })} testId="ctl-rmax" />
      <Toggle label="누적 배위수 n(r) 보기" checked={params.showN} onChange={(showN) => setParams({ showN })} />
      <Hint>모든 입자 쌍의 거리(주기 경계의 최소 이미지 규약)를 구간별로 세어, 무작위로 흩어진 이상 기체에서 기대되는 쌍의 수로 나눈 값이 g(r)입니다. 기체는 1, 액체는 가까운 거리에서 쌓이는 껍질 구조 때문에 1.1σ 부근의 높은 봉우리와 점점 약해지는 진동, 결정은 격자 거리마다 날카로운 봉우리를 갖습니다. 누적 배위수는 첫 번째 극솟값까지 적분해 이웃 수(면심입방 결정이면 12)를 줍니다. 표의 좌표를 고치면 즉시 다시 계산됩니다.</Hint>
    </ControlGroup>
  )
}

export const rdfModule: VizModule<RdfParams> = {
  roles: rdfRoles, datasets: ['particles-liquid', 'particles-fcc', 'particles-gas'], defaultParams: { dr: 0.05, rmax: 1, showN: true },
  Chart: RdfChart, Controls: RdfControls, hint: '액체·결정·기체 데이터를 바꿔 보세요 · dr을 줄이면 세부가 보이지만 잡음이 커집니다 · 표의 좌표를 고쳐 보세요',
}

// ─── tight-binding bands and density of states ──────────────────────────────────────

export interface BandParams { model: LatticeId; resolution: number; sigma: number; filling: number }
const tbRoles: RoleSpec[] = [
  { key: 'name', label: '모수 이름', type: 'category', required: true },
  { key: 'value', label: '값 (eV)', type: 'number', required: true },
]
const MODELS: { value: LatticeId; label: string }[] = [{ value: 'chain', label: '1차원 사슬' }, { value: 'ssh', label: '이원자 사슬 (SSH)' }, { value: 'square', label: '2차원 정사각 격자' }, { value: 'graphene', label: '그래핀 (벌집 격자)' }]

function readTb(table: DataTable, mapping: Mapping): TbParams {
  const ni = columnIndex(table, roleColumn(mapping, 'name')), vi = columnIndex(table, roleColumn(mapping, 'value'))
  const m = new Map<string, number>()
  if (ni >= 0 && vi >= 0) for (const r of table.rows) { const v = toNumber(r[vi]); if (v != null) m.set(toLabel(r[ni]).trim(), v) }
  const g = (...keys: string[]) => { for (const k of keys) if (m.has(k)) return m.get(k)!; return undefined }
  return { eps: g('ε', 'eps', '준위') ?? 0, t1: g('t1', 't', 't₁') ?? 1, t2: g('t2', 't₂') ?? 0.6, delta: g('Δ', 'delta') ?? 0 }
}

function BandChart({ table, mapping, params, width, height, compact }: ChartProps<BandParams>) {
  const tb = useMemo(() => readTb(table, mapping), [table, mapping])
  const path = useMemo(() => bandPath(params.model, tb, params.resolution), [params.model, tb, params.resolution])
  const nb = path.bands[0].length
  const all = path.bands.flat()
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1
  const E = useMemo(() => Array.from({ length: 160 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / 159), [lo, hi, pad])
  const g = useMemo(() => dos(params.model, tb, E, Math.max(0.02, (hi - lo) / 60), 800, 60), [params.model, tb, E, lo, hi])
  const sym = HIGH_SYMMETRY[params.model]
  const layers: Layer[] = [
    ...sym.points.map((_, i): Layer => ({ kind: 'vline', v: i, color: '#d1d5db', dash: '0' })),
    ...Array.from({ length: nb }, (_, b): Layer => ({ kind: 'line', x: path.k, y: path.bands.map((e) => e[b]), color: colorAt(b), width: 2.6, label: `띠 ${b + 1}` })),
    { kind: 'hline', v: tb.eps, color: '#9aa1a9' },
  ]
  const widths = Array.from({ length: nb }, (_, b) => Math.max(...path.bands.map((e) => e[b])) - Math.min(...path.bands.map((e) => e[b])))
  const gap = nb === 2 ? Math.min(...path.bands.map((e) => e[1])) - Math.max(...path.bands.map((e) => e[0])) : 0
  const yDomain: [number, number] = [lo - pad, hi + pad]
  const bandPlot = (w: number, h: number, c?: boolean) => (
    <XYPlot hover layers={layers} width={w} height={h} compact={c} xLabel="" yLabel="에너지 E (eV)" title={`띠 구조: ${MODELS.find((m) => m.value === params.model)?.label}`} yDomain={yDomain} xDomain={[0, sym.points.length - 1]} xTicks={sym.points.length} grid={false}
      xFormat={(v) => (Math.abs(v - Math.round(v)) < 1e-6 ? sym.labels[Math.round(v)] ?? '' : '')}
      readout={[{ label: '띠 너비', value: widths.map((v) => fmt(v, 2)).join(' / ') + ' eV' }, { label: '띠 간격(갭)', value: gap > 1e-9 ? `${fmt(gap, 2)} eV` : nb === 2 ? '닫힘' : '–' }]} />
  )
  if (compact) return bandPlot(width, height, true)
  const dw = Math.floor(width * 0.28)
  return (
    <div style={{ width, height, display: 'flex' }}>
      <div style={{ width: width - dw, height, position: 'relative' }}>{bandPlot(width - dw, height)}</div>
      <div style={{ width: dw, height, position: 'relative' }}>
        <XYPlot width={dw} height={height} layers={[{ kind: 'line', x: g, y: E, color: '#2a8c82', width: 2.2 }]} xLabel="상태 밀도" yLabel="" yDomain={yDomain} title="상태 밀도" margin={{ left: 14, right: 12 }} yFormat={() => ''} />
      </div>
    </div>
  )
}

function ModelControls({ params, setParams, table, mapping, extra }: ControlsProps<BandParams> & { extra?: React.ReactNode }) {
  const tb = readTb(table, mapping)
  return (
    <ControlGroup title="결정 모형">
      <Select label="격자" value={params.model} options={MODELS} onChange={(model) => setParams({ model })} testId="ctl-model" />
      {extra}
      <p className="hint" style={{ margin: '4px 0 0' }}>ε = {fmt(tb.eps, 2)} · t₁ = {fmt(tb.t1, 2)} · t₂ = {fmt(tb.t2, 2)} · Δ = {fmt(tb.delta, 2)} eV (표에서 바꿉니다)</p>
    </ControlGroup>
  )
}

export const bandModule: VizModule<BandParams> = {
  roles: tbRoles, datasets: ['tb-params', 'tb-params-gapped'], defaultParams: { model: 'graphene', resolution: 60, sigma: 0.08, filling: 0.5 },
  Chart: BandChart,
  Controls: (p) => (
    <>
      <ModelControls {...p} extra={<Slider label="경로 해상도 (구간당 점 수)" value={p.params.resolution} min={20} max={150} step={10} onChange={(resolution) => p.setParams({ resolution })} testId="ctl-resolution" />} />
      <ControlGroup title="띠 구조 읽기"><Hint>강한 결합(tight-binding) 모형의 블로흐 해밀토니안을 대칭 경로를 따라 고유값으로 풀어 에너지띠 E(k)를 그립니다. 1차원 사슬은 E = ε − 2t cos k, 이원자 사슬은 두 띠 사이에 2|t₁ − t₂| 크기의 갭이 열리고(Δ 추가 시 더 커짐), 그래핀은 K점에서 두 띠가 만나는 디랙점이 있어 선형 분산을 보입니다. 오른쪽은 같은 모형의 상태 밀도입니다. 표의 호핑 값을 바꾸면 띠 너비와 갭이 달라집니다.</Hint></ControlGroup>
    </>
  ),
  hint: '격자를 바꿔 띠 구조를 비교하세요 · 그래핀의 K점에서 띠가 만납니다 · 표의 Δ를 키우면 갭이 열립니다',
}

function DosChart({ table, mapping, params, width, height, compact }: ChartProps<BandParams>) {
  const tb = useMemo(() => readTb(table, mapping), [table, mapping])
  const path = useMemo(() => bandPath(params.model, tb, 24), [params.model, tb])
  const all = path.bands.flat()
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.1 || 1
  const E = useMemo(() => Array.from({ length: 400 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / 399), [lo, hi, pad])
  const g = useMemo(() => dos(params.model, tb, E, params.sigma, compact ? 500 : 2500, compact ? 50 : 140), [params.model, tb, E, params.sigma, compact])
  const dE = E[1] - E[0]
  const N = useMemo(() => { let acc = 0; return g.map((v) => (acc += v * dE)) }, [g, dE])
  const nb = path.bands[0].length
  const eF = useMemo(() => { const target = params.filling * nb; const i = N.findIndex((v) => v >= target); return i < 0 ? E[E.length - 1] : E[i] }, [N, E, nb, params.filling])
  const gF = g[Math.max(0, E.findIndex((e) => e >= eF))] ?? 0
  const peak = g.reduce((b, v, i) => (v > g[b] ? i : b), 0)
  const common = { width, compact }
  const top: Layer[] = [{ kind: 'band', x: E.filter((e) => e <= eF), lo: E.filter((e) => e <= eF).map(() => 0), hi: g.slice(0, E.filter((e) => e <= eF).length), color: '#2a8c82', opacity: 0.25 }, { kind: 'line', x: E, y: g, color: '#2a8c82', width: 2.2, label: 'g(E)' }, { kind: 'vline', v: eF, color: '#e07a3f', dash: '0', width: 1.8 }]
  const readout = [{ label: '페르미 에너지', value: `${fmt(eF, 2)} eV` }, { label: 'g(E_F)', value: fmt(gF, 3) }, { label: '가장 높은 봉우리', value: `${fmt(E[peak], 2)} eV` }]
  if (compact) return <XYPlot {...common} height={height} xLabel="E (eV)" yLabel="g(E)" layers={top} title="상태 밀도" />
  return (
    <Panels width={width} height={height} parts={[3, 2]}>
      {[
        (h) => <XYPlot {...common} height={h} hover xLabel="" yLabel="상태 밀도 g(E) (셀당 / eV)" title={`상태 밀도: ${MODELS.find((m) => m.value === params.model)?.label}`} margin={{ bottom: 22 }} layers={top} readout={readout} />,
        (h) => <XYPlot {...common} height={h} hover xLabel="에너지 E (eV)" yLabel="채워진 상태 수 N(E)" title="누적 상태 수" margin={{ top: 12 }} layers={[{ kind: 'line', x: E, y: N, color: '#4c6fb5', width: 2.2, label: 'N(E)' }, { kind: 'vline', v: eF, color: '#e07a3f', dash: '0', width: 1.8 }, { kind: 'hline', v: params.filling * nb, color: '#9aa1a9' }]} />,
      ]}
    </Panels>
  )
}

export const dosModule: VizModule<BandParams> = {
  roles: tbRoles, datasets: ['tb-params', 'tb-params-gapped'], defaultParams: { model: 'square', resolution: 60, sigma: 0.08, filling: 0.5 },
  Chart: DosChart,
  Controls: (p) => (
    <>
      <ModelControls {...p} extra={<><Slider label="가우시안 퍼짐 σ (eV)" value={p.params.sigma} min={0.02} max={0.4} step={0.01} onChange={(sigma) => p.setParams({ sigma })} testId="ctl-sigma" /><Slider label="채움 비율 (띠당)" value={p.params.filling} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(filling) => p.setParams({ filling })} testId="ctl-filling" /></>} />
      <ControlGroup title="상태 밀도 읽기"><Hint>상태 밀도 g(E)는 에너지 E 근처의 허용된 전자 상태가 얼마나 빽빽한지를 나타냅니다. 균일한 k 격자에서 모든 띠의 에너지를 구해 가우시안으로 퍼뜨려 더한 값(셀당)이며, 적분하면 띠의 수가 됩니다. 1차원 사슬은 띠 끝에서 1/√ 발산(반 호베 특이점), 2차원 정사각 격자는 띠 중앙의 로그 발산 봉우리, 그래핀은 디랙점에서 g = 0으로 줄어듭니다. 채움 비율을 정하면 그 전자 수가 들어가는 페르미 에너지가 나옵니다. 퍼짐이 클수록 세부가 뭉개집니다.</Hint></ControlGroup>
    </>
  ),
  hint: '퍼짐 σ를 줄여 반 호베 특이점을 또렷이 보고, 채움 비율로 페르미 에너지를 옮겨 보세요',
}

// ─── binary phase diagram ───────────────────────────────────────────────────────────

export interface PhaseParams { x0: number; temp: number }
const phaseRoles: RoleSpec[] = [
  { key: 'name', label: '성분 이름', type: 'category', required: true },
  { key: 'tm', label: '녹는점 (K)', type: 'number', required: true, prefer: '녹는점|tm|melting' },
  { key: 'hf', label: '융해열 (kJ/mol)', type: 'number', required: true, prefer: '융해열|hf|fusion' },
]

function readComponents(table: DataTable, mapping: Mapping): Component[] {
  const ni = columnIndex(table, roleColumn(mapping, 'name')), ti = columnIndex(table, roleColumn(mapping, 'tm')), hi = columnIndex(table, roleColumn(mapping, 'hf'))
  const out: Component[] = []
  if (ni < 0 || ti < 0 || hi < 0) return out
  for (const r of table.rows) { const tm = toNumber(r[ti]), hf = toNumber(r[hi]); if (tm != null && hf != null && tm > 0 && hf > 0) out.push({ name: toLabel(r[ni]) || `성분 ${out.length + 1}`, tm, hf: hf * 1000 }) }
  return out.slice(0, 2)
}

function PhaseChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<PhaseParams>) {
  const comps = useMemo(() => readComponents(table, mapping), [table, mapping])
  const model = useMemo(() => {
    if (comps.length < 2) return null
    const [a, b] = comps
    const e = eutectic(a, b)
    if (!e) return null
    const tTop = Math.max(a.tm, b.tm) * 1.08, tBot = e.T * 0.82
    const Ts = Array.from({ length: 90 }, (_, i) => e.T + ((Math.min(a.tm, b.tm) - e.T) * i) / 89)
    const nx = 70, ny = 60
    const z: number[] = []
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = leverRule(a, b, (i + 0.5) / nx, tBot + ((j + 0.5) / ny) * (tTop - tBot))
      z.push(!r ? 0 : r.phases.startsWith('액상') ? 0 : r.phases === '고상 A + 액상' ? 1 : r.phases === '고상 B + 액상' ? 2 : 3)
    }
    const leftA = Array.from({ length: 80 }, (_, i) => a.tm - ((a.tm - e.T) * i) / 79), rightB = Array.from({ length: 80 }, (_, i) => b.tm - ((b.tm - e.T) * i) / 79)
    return { a, b, e, tTop, tBot, z, nx, ny, lineA: { x: leftA.map((T) => 1 - liquidusX(a, T)), y: leftA }, lineB: { x: rightB.map((T) => liquidusX(b, T)), y: rightB }, Ts }
  }, [comps])
  if (!model) return <ChartMessage>두 성분(이름, 녹는점 K, 융해열 kJ/mol)이 필요합니다. 두 성분이 공정(eutectic)을 만드는 값이어야 합니다.</ChartMessage>
  const { a, b, e } = model
  const probe = leverRule(a, b, params.x0, params.temp)
  const palette = ['#dbeafe', '#fde7c7', '#dcfce7', '#e5e7eb']
  const layers: Layer[] = [
    { kind: 'raster', nx: model.nx, ny: model.ny, z: model.z, x0: 0, x1: 1, y0: model.tBot, y1: model.tTop, color: (v) => palette[Math.round(v)] ?? '#fff' },
    { kind: 'line', ...model.lineA, color: '#1d4ed8', width: 2.8, label: `${a.name} 액상선` },
    { kind: 'line', ...model.lineB, color: '#b45309', width: 2.8, label: `${b.name} 액상선` },
    { kind: 'line', x: [0, 1], y: [e.T, e.T], color: '#111827', width: 1.8, label: '공정 온도' },
    { kind: 'points', color: '#111827', r: 6, pts: [{ x: e.xB, y: e.T, tip: <><b>공정점</b><br />{fmt(e.T, 1)} K, {b.name} {fmt(e.xB * 100, 1)}%</> }] },
    { kind: 'points', color: '#e11d48', r: 7, stroke: '#fff', pts: [{ x: params.x0, y: params.temp, tip: <><b>선택한 점</b><br />{b.name} {fmt(params.x0 * 100, 1)}% · {fmt(params.temp, 0)} K</> }] },
    { kind: 'text', x: 0.5, y: model.tTop - (model.tTop - model.tBot) * 0.08, text: '액상 (L)', color: '#1f2937', size: 13 },
    { kind: 'text', x: 0.14, y: e.T + (a.tm - e.T) * 0.35, text: `${a.name} + 액상`, color: '#1d4ed8', size: 12 },
    { kind: 'text', x: 0.86, y: e.T + (b.tm - e.T) * 0.35, text: `${b.name} + 액상`, color: '#b45309', size: 12 },
    { kind: 'text', x: 0.5, y: model.tBot + (e.T - model.tBot) * 0.5, text: `고상 ${a.name} + 고상 ${b.name}`, color: '#374151', size: 12 },
  ]
  return (
    <XYPlot layers={layers} width={width} height={height} compact={compact} xDomain={[0, 1]} yDomain={[model.tBot, model.tTop]} pad={0} grid={false} xLabel={`${b.name}의 몰분율 (${a.name} ← → ${b.name})`} yLabel="온도 (K)" title={`이성분 공정계 상평형도: ${a.name}–${b.name}`}
      onPick={compact ? undefined : (x, y) => setParams({ x0: +Math.min(0.995, Math.max(0.005, x)).toFixed(3), temp: Math.round(Math.min(model.tTop, Math.max(model.tBot, y))) })}
      readout={[{ label: '공정', value: `${fmt(e.T, 0)} K, ${b.name} ${fmt(e.xB * 100, 0)}%` }, ...(probe ? [{ label: '선택한 점의 상', value: probe.phases }, ...(probe.liquid > 0 && probe.liquid < 1 ? [{ label: '액상 / 고상', value: `${fmt(probe.liquid * 100, 0)}% / ${fmt((1 - probe.liquid) * 100, 0)}%` }] : [])] : [])]}
      note="그림을 눌러 조성과 온도를 고르면 지렛대 법칙으로 상 분율을 계산합니다" />
  )
}

function PhaseControls({ params, setParams, table, mapping }: ControlsProps<PhaseParams>) {
  const comps = readComponents(table, mapping)
  return (
    <ControlGroup title="선택한 점 (지렛대 법칙)">
      <Slider label={`${comps[1]?.name ?? 'B'} 몰분율`} value={params.x0} min={0.01} max={0.99} step={0.01} onChange={(x0) => setParams({ x0 })} testId="ctl-x0" format={(v) => `${(v * 100).toFixed(0)}%`} />
      <Slider label="온도 (K)" value={params.temp} min={250} max={800} step={1} onChange={(temp) => setParams({ temp })} testId="ctl-temp" />
      <Hint>두 성분이 액체에서는 이상용액으로 섞이고 고체에서는 전혀 섞이지 않는(순수한 고체) 단순 공정계의 상평형도입니다. 액상선은 Schröder–van Laar 식 ln x = −(ΔH_fus/R)(1/T − 1/T_m)에서 계산한 값이며, 두 액상선이 만나는 지점이 공정점(액체가 두 고체로 동시에 응고하는 최저 녹는 조성)입니다. 두 상이 공존하는 영역에서는 지렛대 법칙으로 각 상의 분율을 구합니다. 실제 합금은 용액이 이상적이지 않고 고용체가 생기므로 이 모형은 근사입니다(예: Sn–Pb의 실제 공정은 456 K).</Hint>
    </ControlGroup>
  )
}

export const phaseModule: VizModule<PhaseParams> = {
  roles: phaseRoles, datasets: ['phase-bi-cd', 'phase-sn-pb'], defaultParams: { x0: 0.3, temp: 480 },
  Chart: PhaseChart, Controls: PhaseControls, hint: '그림을 눌러 점을 옮기면 상과 분율이 계산됩니다 · 표의 녹는점·융해열을 고치면 상평형도가 다시 그려집니다',
}

