import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Legend, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { categoryColor, palette, schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { chromosomeOffsets, inflationFactor, leaves, lowCoverageRegions, neighborJoining, pcoa, runningMean, sequenceLogo, upgma, type PhyloNode } from '../../stats/bio'
import { hclust, linkageTree, type ClusterNode, type Linkage } from '../../stats/cluster'
import { benjaminiHochberg } from '../../stats/spatialStats'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'

/** Bioinformatics charts. Every bundled example is synthetic; nothing here uses real patient or genome records. */

const seq = (Object.keys(schemes) as ColorScheme[]).filter((k) => !schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))
const div = (Object.keys(schemes) as ColorScheme[]).filter((k) => schemes[k].diverging).map((k) => ({ value: k, label: schemes[k].name }))

/** Many dots on one canvas laid over the chart (positions are in the chart's own pixel space). */
function DotLayer({ dots, width, height, opacity = 0.7 }: { dots: readonly { x: number; y: number; r: number; color: string }[]; width: number; height: number; opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.globalAlpha = opacity
    let last = ''
    for (const d of dots) {
      if (d.color !== last) { ctx.fillStyle = d.color; last = d.color }
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
    }
  }, [dots, width, height, opacity])
  return <canvas ref={ref} className="dot-canvas" data-testid="dot-canvas" aria-hidden="true" style={{ width, height }} />
}

const UP = '#c94b4b', DOWN = '#3f6fb5', NS = '#aeb8b4'

// ─── differential-expression rows (volcano, MA) ─────────────────────────────────────

interface GeneRow { row: number; name: string; fc: number; p: number; mean: number }

function geneRows(table: DataTable, mapping: Mapping, meanRole = false): GeneRow[] {
  const ni = columnIndex(table, roleColumn(mapping, 'gene')), fi = columnIndex(table, roleColumn(mapping, 'fc')), pi = columnIndex(table, roleColumn(mapping, 'p')), mi = meanRole ? columnIndex(table, roleColumn(mapping, 'mean')) : -1
  if (fi < 0 || pi < 0 || (meanRole && mi < 0)) return []
  const out: GeneRow[] = []
  table.rows.forEach((r, row) => {
    const fc = toNumber(r[fi]), p = toNumber(r[pi]), mean = mi >= 0 ? toNumber(r[mi]) : 0
    if (fc == null || p == null || mean == null || p <= 0 || p > 1) return
    out.push({ row, name: ni >= 0 ? toLabel(r[ni]) : `행 ${row + 1}`, fc, p, mean })
  })
  return out
}

interface DeStats { fdr: boolean[]; sig: Map<number, 'up' | 'down'>; up: number; down: number }

function deStats(rows: readonly GeneRow[], alpha: number, fcCut: number, useFdr: boolean): DeStats {
  const flag = useFdr ? benjaminiHochberg(rows.map((r) => r.p), alpha) : rows.map((r) => r.p < alpha)
  const sig = new Map<number, 'up' | 'down'>()
  let up = 0, down = 0
  rows.forEach((r, i) => {
    if (!flag[i] || Math.abs(r.fc) < fcCut) return
    sig.set(r.row, r.fc > 0 ? 'up' : 'down')
    if (r.fc > 0) up++; else down++
  })
  return { fdr: flag, sig, up, down }
}

export interface VolcanoParams { alpha: number; fcCut: number; fdr: boolean; labels: number; clipP: number }

const deRoles = (mean: boolean) => [
  { key: 'gene', label: '유전자 이름', type: 'category' as const, auto: true, prefer: '유전자|gene' },
  { key: 'fc', label: 'log₂ 배수 변화', type: 'number' as const, required: true, prefer: 'log2|fc|배수' },
  { key: 'p', label: 'p 값', type: 'number' as const, required: true, prefer: 'p값|pval|p_value|p-value|^p$' },
  ...(mean ? [{ key: 'mean', label: '평균 발현량', type: 'number' as const, required: true, prefer: '평균|mean|base' }] : []),
]

function VolcanoChart({ table, mapping, params, width, height, compact, linked }: ChartProps<VolcanoParams>) {
  const rows = useMemo(() => geneRows(table, mapping), [table, mapping])
  const st = useMemo(() => deStats(rows, params.alpha, params.fcCut, params.fdr), [rows, params.alpha, params.fcCut, params.fdr])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  const ypts = useMemo(() => rows.map((r) => Math.min(params.clipP, -Math.log10(r.p))), [rows, params.clipP])
  const xmax = Math.max(1, d3.max(rows, (r) => Math.abs(r.fc)) ?? 1) * 1.05
  const x = useMemo(() => d3.scaleLinear([-xmax, xmax], [0, iw]), [xmax, iw])
  const ymax = Math.max(2, d3.max(ypts) ?? 2) * 1.05
  const y = useMemo(() => d3.scaleLinear([0, ymax], [ih, 0]), [ymax, ih])
  const tree = useMemo(() => d3.quadtree<number>().x((i) => x(rows[i].fc)).y((i) => y(ypts[i])).addAll(rows.map((_, i) => i)), [rows, ypts, x, y])
  const dots = useMemo(() => rows.map((r, i) => { const s = st.sig.get(r.row); return { x: m.left + x(r.fc), y: m.top + y(ypts[i]), r: s ? 2.6 : 1.9, color: s === 'up' ? UP : s === 'down' ? DOWN : NS, s: s ? 1 : 0 } }).sort((a, b) => a.s - b.s), [rows, st, x, y, ypts, m.left, m.top])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const top = useMemo(() => (params.labels > 0 ? rows.map((r, i) => ({ r, i })).filter((o) => st.sig.has(o.r.row)).sort((a, b) => b.r.fc ** 2 * ypts[b.i] - a.r.fc ** 2 * ypts[a.i]).slice(0, params.labels) : []), [rows, st, ypts, params.labels])
  if (!roleColumn(mapping, 'fc') || !roleColumn(mapping, 'p')) return <ChartMessage>log₂ 배수 변화와 p 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!rows.length) return <ChartMessage>0 &lt; p ≤ 1 인 유전자가 없습니다.</ChartMessage>
  // with FDR control the effective p cut-off is the largest p among the genes that pass; without it, the nominal level
  const passP = rows.filter((_, i) => st.fdr[i]).map((r) => r.p)
  const yCut = params.fdr && passP.length ? -Math.log10(Math.max(...passP)) : -Math.log10(params.alpha)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`화산 도표: 유전자 ${rows.length}개, 증가 ${st.up}개, 감소 ${st.down}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#e1e6e4" />
          <AxisBottom scale={x} y={ih} label="log₂ 배수 변화 (조건 B ÷ 조건 A)" compact={compact} />
          <AxisLeft scale={y} x={0} label="−log₁₀ p" compact={compact} grid={iw} />
          <line x1={x(-params.fcCut)} x2={x(-params.fcCut)} y1={0} y2={ih} stroke="#8a9490" strokeDasharray="4 3" data-testid="volcano-fc-line" />
          <line x1={x(params.fcCut)} x2={x(params.fcCut)} y1={0} y2={ih} stroke="#8a9490" strokeDasharray="4 3" />
          <line x1={0} x2={iw} y1={y(yCut)} y2={y(yCut)} stroke="#8a9490" strokeDasharray="4 3" data-testid="volcano-p-line" />
          {!compact && top.map(({ r, i }) => <text key={r.row} x={x(r.fc) + (r.fc > 0 ? 5 : -5)} y={y(ypts[i]) - 4} fontSize={10.5} textAnchor={r.fc > 0 ? 'start' : 'end'} fill="#374151" data-testid="volcano-label">{r.name}</text>)}
          {rows.map((r, i) => linkedSet.has(r.row) ? <circle key={`l${r.row}`} cx={x(r.fc)} cy={y(ypts[i])} r={6} fill="none" stroke="#111827" strokeWidth={1.6} /> : null)}
          {!compact && <rect width={iw} height={ih} fill="transparent" onPointerMove={(e) => {
            const l = localPoint(svgRef.current!, e)
            const hit = tree.find(l.x - m.left, l.y - m.top, 14)
            if (hit == null) { hide(); linked?.set(null); return }
            const r = rows[hit]
            linked?.set([r.row])
            show(l.x, l.y, <><b>{r.name}</b><br />log₂FC {fmt(r.fc, 3)}<br />p {r.p.toExponential(2)}<br />{st.sig.get(r.row) === 'up' ? '유의하게 증가' : st.sig.get(r.row) === 'down' ? '유의하게 감소' : '유의하지 않음'}</>)
          }} />}
        </g>
      </svg>
      <DotLayer dots={dots} width={width} height={height} />
      {!compact && <><Legend items={[{ key: `증가 ${st.up}`, color: UP }, { key: `감소 ${st.down}`, color: DOWN }, { key: '유의하지 않음', color: NS }]} /><Readout items={[{ label: '유전자', value: rows.length }, { label: params.fdr ? 'FDR' : 'p 기준', value: params.alpha }, { label: '|log₂FC| ≥', value: params.fcCut }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function VolcanoControls({ params, setParams }: ControlsProps<VolcanoParams>) {
  return (
    <ControlGroup title="화산 도표">
      <Toggle label="다중 검정 보정 (Benjamini–Hochberg FDR)" checked={params.fdr} onChange={(fdr) => setParams({ fdr })} testId="ctl-volcano-fdr" />
      <Slider label={params.fdr ? '허용 FDR' : '유의수준 p'} value={params.alpha} min={0.001} max={0.2} step={0.001} onChange={(alpha) => setParams({ alpha })} format={(v) => v.toFixed(3)} testId="ctl-volcano-alpha" />
      <Slider label="|log₂ 배수 변화| 기준" value={params.fcCut} min={0} max={3} step={0.1} onChange={(fcCut) => setParams({ fcCut })} format={(v) => `${v.toFixed(1)} (${(2 ** v).toFixed(2)}배)`} testId="ctl-volcano-fc" />
      <Slider label="이름을 표시할 유전자 수" value={params.labels} min={0} max={25} onChange={(labels) => setParams({ labels })} />
      <Slider label="세로축 상한 (−log₁₀ p)" value={params.clipP} min={5} max={300} step={5} onChange={(clipP) => setParams({ clipP })} />
      <Hint>화산 도표는 유전자마다 효과 크기(가로: log₂ 배수 변화)와 통계적 유의성(세로: −log₁₀ p)을 한 점으로 보여 줍니다. 오른쪽 위는 많이 늘고 확실한 유전자, 왼쪽 위는 많이 줄고 확실한 유전자입니다. 유전자가 수천 개이면 p 기준을 그대로 쓸 때 우연히 유의한 것이 많이 섞이므로 FDR 보정을 켜면 보정 후 유의한 유전자만 색이 칠해집니다. 이 데이터는 실험으로 얻은 값이 아니라 합성한 값입니다.</Hint>
    </ControlGroup>
  )
}

export const volcanoModule: VizModule<VolcanoParams> = {
  roles: deRoles(false),
  datasets: ['de-genes'],
  defaultParams: { alpha: 0.05, fcCut: 1, fdr: true, labels: 10, clipP: 60 },
  Chart: VolcanoChart,
  Controls: VolcanoControls,
  hint: '점에 포인터를 올리면 유전자 이름과 값 · FDR 보정과 |log₂FC| 기준을 바꾸면 색칠되는 유전자가 달라집니다',
}

// ─── MA plot ────────────────────────────────────────────────────────────────────────

export interface MaParams { alpha: number; fcCut: number; fdr: boolean; smooth: boolean; labels: number }

function MaChart({ table, mapping, params, width, height, compact, linked }: ChartProps<MaParams>) {
  const rows = useMemo(() => geneRows(table, mapping, true).filter((r) => r.mean > 0), [table, mapping])
  const st = useMemo(() => deStats(rows, params.alpha, params.fcCut, params.fdr), [rows, params.alpha, params.fcCut, params.fdr])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  const xs = useMemo(() => rows.map((r) => Math.log10(r.mean)), [rows])
  const [x0, x1] = d3.extent(xs) as [number, number]
  const x = useMemo(() => d3.scaleLinear([Math.floor((x0 ?? 0) * 2) / 2, Math.ceil((x1 ?? 1) * 2) / 2], [0, iw]), [x0, x1, iw])
  const ymax = Math.max(1, d3.max(rows, (r) => Math.abs(r.fc)) ?? 1) * 1.05
  const y = useMemo(() => d3.scaleLinear([-ymax, ymax], [ih, 0]), [ymax, ih])
  const tree = useMemo(() => d3.quadtree<number>().x((i) => x(xs[i])).y((i) => y(rows[i].fc)).addAll(rows.map((_, i) => i)), [rows, xs, x, y])
  const dots = useMemo(() => rows.map((r, i) => { const s = st.sig.get(r.row); return { x: m.left + x(xs[i]), y: m.top + y(r.fc), r: s ? 2.6 : 1.9, color: s === 'up' ? UP : s === 'down' ? DOWN : NS, s: s ? 1 : 0 } }).sort((a, b) => a.s - b.s), [rows, st, x, y, xs, m.left, m.top])
  // running median of the log fold change along the mean axis reveals any intensity-dependent bias
  const trend = useMemo(() => {
    if (!params.smooth || rows.length < 30) return []
    const order = rows.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
    const w = Math.max(15, Math.round(rows.length / 14))
    const out: [number, number][] = []
    for (let k = 0; k < order.length; k += Math.max(1, Math.round(w / 4))) {
      const sl = order.slice(Math.max(0, k - w), Math.min(order.length, k + w + 1))
      out.push([xs[order[k]], d3.median(sl, (i) => rows[i].fc) ?? 0])
    }
    return out
  }, [rows, xs, params.smooth])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  const top = useMemo(() => (params.labels > 0 ? rows.map((r, i) => ({ r, i })).filter((o) => st.sig.has(o.r.row)).sort((a, b) => Math.abs(b.r.fc) - Math.abs(a.r.fc)).slice(0, params.labels) : []), [rows, st, params.labels])
  if (!roleColumn(mapping, 'fc') || !roleColumn(mapping, 'p') || !roleColumn(mapping, 'mean')) return <ChartMessage>평균 발현량, log₂ 배수 변화, p 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!rows.length) return <ChartMessage>평균 발현량이 0보다 크고 0 &lt; p ≤ 1 인 유전자가 없습니다.</ChartMessage>
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`MA 도표: 유전자 ${rows.length}개, 유의 ${st.up + st.down}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#e1e6e4" />
          <AxisBottom scale={x} y={ih} label="평균 발현량 (log₁₀)" compact={compact} />
          <AxisLeft scale={y} x={0} label="log₂ 배수 변화" compact={compact} grid={iw} />
          <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="#111827" strokeOpacity={0.55} />
          {params.fcCut > 0 && [-params.fcCut, params.fcCut].map((c) => <line key={c} x1={0} x2={iw} y1={y(c)} y2={y(c)} stroke="#8a9490" strokeDasharray="4 3" />)}
          {trend.length > 1 && <path data-testid="ma-trend" d={d3.line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveMonotoneX)(trend) ?? ''} fill="none" stroke="#e8a33d" strokeWidth={2.2} />}
          {!compact && top.map(({ r, i }) => <text key={r.row} x={x(xs[i]) + 5} y={y(r.fc) - 4} fontSize={10.5} fill="#374151">{r.name}</text>)}
          {rows.map((r, i) => linkedSet.has(r.row) ? <circle key={`l${r.row}`} cx={x(xs[i])} cy={y(r.fc)} r={6} fill="none" stroke="#111827" strokeWidth={1.6} /> : null)}
          {!compact && <rect width={iw} height={ih} fill="transparent" onPointerMove={(e) => {
            const l = localPoint(svgRef.current!, e)
            const hit = tree.find(l.x - m.left, l.y - m.top, 14)
            if (hit == null) { hide(); linked?.set(null); return }
            const r = rows[hit]
            linked?.set([r.row])
            show(l.x, l.y, <><b>{r.name}</b><br />평균 발현 {fmt(r.mean, 4)}<br />log₂FC {fmt(r.fc, 3)}<br />p {r.p.toExponential(2)}</>)
          }} />}
        </g>
      </svg>
      <DotLayer dots={dots} width={width} height={height} />
      {!compact && <><Legend items={[{ key: `증가 ${st.up}`, color: UP }, { key: `감소 ${st.down}`, color: DOWN }, { key: '유의하지 않음', color: NS }, ...(trend.length ? [{ key: '중앙값 추세', color: '#e8a33d' }] : [])]} /><Readout items={[{ label: '유전자', value: rows.length }, { label: '유의', value: st.up + st.down }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function MaControls({ params, setParams }: ControlsProps<MaParams>) {
  return (
    <ControlGroup title="MA 도표">
      <Toggle label="다중 검정 보정 (Benjamini–Hochberg FDR)" checked={params.fdr} onChange={(fdr) => setParams({ fdr })} />
      <Slider label={params.fdr ? '허용 FDR' : '유의수준 p'} value={params.alpha} min={0.001} max={0.2} step={0.001} onChange={(alpha) => setParams({ alpha })} format={(v) => v.toFixed(3)} />
      <Slider label="|log₂ 배수 변화| 기준" value={params.fcCut} min={0} max={3} step={0.1} onChange={(fcCut) => setParams({ fcCut })} format={(v) => v.toFixed(1)} />
      <Toggle label="중앙값 추세선" checked={params.smooth} onChange={(smooth) => setParams({ smooth })} testId="ctl-ma-trend" />
      <Slider label="이름을 표시할 유전자 수" value={params.labels} min={0} max={20} onChange={(labels) => setParams({ labels })} />
      <Hint>MA 도표는 가로에 평균 발현량(A), 세로에 두 조건의 배수 변화(M)를 놓습니다. 화산 도표와 달리 발현량이 낮은 유전자에서 변동이 커지는 모양(깔때기)과, 발현량에 따라 배수 변화가 한쪽으로 쏠리는 체계적 편향을 확인할 수 있습니다. 대부분의 유전자가 변하지 않는다면 점 구름의 중앙이 0 근처에 수평으로 놓여야 하며, 추세선이 0에서 벗어나면 정규화가 필요하다는 신호입니다. 이 데이터는 합성한 값입니다.</Hint>
    </ControlGroup>
  )
}

export const maModule: VizModule<MaParams> = {
  roles: deRoles(true),
  datasets: ['de-genes'],
  defaultParams: { alpha: 0.05, fcCut: 1, fdr: true, smooth: true, labels: 0 },
  Chart: MaChart,
  Controls: MaControls,
  hint: '중앙값 추세선이 0에서 벗어나면 발현량에 따른 편향입니다 · 점에 포인터를 올리면 유전자 이름과 값',
}

// ─── Manhattan plot ─────────────────────────────────────────────────────────────────

export interface ManhattanParams { genomeWide: number; suggestive: number; scheme: 'alt' | 'chrom'; labels: boolean; cap: number }

interface Snp { row: number; name: string; chr: number; pos: number; p: number }

function snpRows(table: DataTable, mapping: Mapping): Snp[] {
  const ni = columnIndex(table, roleColumn(mapping, 'snp')), ci = columnIndex(table, roleColumn(mapping, 'chr')), pi = columnIndex(table, roleColumn(mapping, 'pos')), qi = columnIndex(table, roleColumn(mapping, 'p'))
  if (ci < 0 || pi < 0 || qi < 0) return []
  const out: Snp[] = []
  table.rows.forEach((r, row) => {
    const chr = toNumber(r[ci]), pos = toNumber(r[pi]), p = toNumber(r[qi])
    if (chr == null || pos == null || p == null || p <= 0 || p > 1 || !Number.isInteger(chr) || chr < 1) return
    out.push({ row, name: ni >= 0 ? toLabel(r[ni]) : `행 ${row + 1}`, chr, pos, p })
  })
  return out
}

function ManhattanChart({ table, mapping, params, width, height, compact, linked }: ChartProps<ManhattanParams>) {
  const snps = useMemo(() => snpRows(table, mapping), [table, mapping])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  // chromosome extents come from the data (largest position), so uploaded data with other species or builds also works
  const layout = useMemo(() => {
    const chrs = [...new Set(snps.map((s) => s.chr))].sort((a, b) => a - b)
    const len = chrs.map((c) => Math.max(...snps.filter((s) => s.chr === c).map((s) => s.pos), 1))
    const gap = Math.max(...len, 1) * 0.015
    const off = chromosomeOffsets(len, gap)
    return { chrs, len, off, total: off[off.length - 1] + len[len.length - 1] }
  }, [snps])
  const x = useMemo(() => d3.scaleLinear([0, layout.total || 1], [0, iw]), [layout.total, iw])
  const lp = useMemo(() => snps.map((s) => Math.min(params.cap, -Math.log10(s.p))), [snps, params.cap])
  const ymax = Math.max(-Math.log10(params.genomeWide) + 1, d3.max(lp) ?? 1) * 1.04
  const y = useMemo(() => d3.scaleLinear([0, ymax], [ih, 0]), [ymax, ih])
  const colorOf = (chr: number) => (params.scheme === 'alt' ? (layout.chrs.indexOf(chr) % 2 === 0 ? '#2a8c82' : '#4c6fb5') : palette[(chr - 1) % palette.length])
  const px = (i: number) => x(layout.off[layout.chrs.indexOf(snps[i].chr)] + snps[i].pos)
  const dots = useMemo(() => snps.map((s, i) => ({ x: m.left + px(i), y: m.top + y(lp[i]), r: lp[i] >= -Math.log10(params.suggestive) ? 2.8 : 1.9, color: colorOf(s.chr) })), [snps, x, y, lp, params.suggestive, params.scheme, layout]) // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => d3.quadtree<number>().x(px).y((i) => y(lp[i])).addAll(snps.map((_, i) => i)), [snps, x, y, lp, layout]) // eslint-disable-line react-hooks/exhaustive-deps
  const lambda = useMemo(() => inflationFactor(snps.map((s) => s.p)), [snps])
  const hits = useMemo(() => snps.map((s, i) => ({ s, i })).filter((o) => o.s.p <= params.genomeWide).sort((a, b) => a.s.p - b.s.p), [snps, params.genomeWide])
  // lead SNP per signal: the most significant hit within 1 Mb on a chromosome
  const leads = useMemo(() => {
    const out: { s: Snp; i: number }[] = []
    for (const h of hits) if (!out.some((o) => o.s.chr === h.s.chr && Math.abs(o.s.pos - h.s.pos) < 1e6)) out.push(h)
    return out
  }, [hits])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!roleColumn(mapping, 'chr') || !roleColumn(mapping, 'pos') || !roleColumn(mapping, 'p')) return <ChartMessage>염색체, 위치, p 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (!snps.length) return <ChartMessage>염색체(1 이상의 정수), 위치, 0 &lt; p ≤ 1 인 변이가 없습니다.</ChartMessage>
  const gw = -Math.log10(params.genomeWide), sg = -Math.log10(params.suggestive)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`맨해튼 도표: 변이 ${snps.length}개, 유전체 전체 유의 ${hits.length}개`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#e1e6e4" />
          <AxisLeft scale={y} x={0} label="−log₁₀ p" compact={compact} grid={iw} />
          <line x1={0} x2={iw} y1={y(gw)} y2={y(gw)} stroke="#c94b4b" strokeDasharray="5 3" data-testid="manhattan-gw-line" />
          <line x1={0} x2={iw} y1={y(sg)} y2={y(sg)} stroke="#8a9490" strokeDasharray="3 3" />
          <line x1={0} x2={iw} y1={ih} y2={ih} stroke="#111827" strokeOpacity={0.5} />
          {!compact && layout.chrs.map((c, k) => {
            const mid = x(layout.off[k] + layout.len[k] / 2)
            const wide = x(layout.len[k]) > 13
            return wide || k % 2 === 0 ? <text key={c} x={mid} y={ih + 16} fontSize={10.5} textAnchor="middle" fill="#6b7773">{c}</text> : null
          })}
          {!compact && <text x={iw / 2} y={ih + 38} fontSize={12} textAnchor="middle" fill="#374151">염색체</text>}
          {!compact && params.labels && leads.slice(0, 12).map(({ s, i }) => <text key={s.row} x={px(i)} y={y(lp[i]) - 6} fontSize={10.5} textAnchor="middle" fill="#374151">{s.name}</text>)}
          {snps.map((s, i) => linkedSet.has(s.row) ? <circle key={`l${s.row}`} cx={px(i)} cy={y(lp[i])} r={6} fill="none" stroke="#111827" strokeWidth={1.6} /> : null)}
          {!compact && <rect width={iw} height={ih} fill="transparent" onPointerMove={(e) => {
            const l = localPoint(svgRef.current!, e)
            const hit = tree.find(l.x - m.left, l.y - m.top, 14)
            if (hit == null) { hide(); linked?.set(null); return }
            const s = snps[hit]
            linked?.set([s.row])
            show(l.x, l.y, <><b>{s.name}</b><br />염색체 {s.chr}, {fmt(s.pos / 1e6, 2)} Mb<br />p {s.p.toExponential(2)}</>)
          }} />}
        </g>
      </svg>
      <DotLayer dots={dots} width={width} height={height} opacity={0.8} />
      {!compact && <><Legend items={[{ key: `유전체 전체 유의 p ≤ ${params.genomeWide.toExponential(0)}`, color: '#c94b4b' }, { key: `암시적 p ≤ ${params.suggestive.toExponential(0)}`, color: '#8a9490' }]} /><Readout items={[{ label: '변이', value: snps.length }, { label: '유의 신호', value: leads.length }, { label: '인플레이션 λ', value: Number.isFinite(lambda) ? lambda.toFixed(2) : '–' }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function ManhattanControls({ params, setParams }: ControlsProps<ManhattanParams>) {
  return (
    <ControlGroup title="맨해튼 도표">
      <Select label="유의 기준 (유전체 전체)" value={String(params.genomeWide)} onChange={(v) => setParams({ genomeWide: Number(v) })} testId="ctl-manhattan-gw" options={[{ value: '5e-8', label: '5×10⁻⁸ (통상 기준)' }, { value: '1e-8', label: '10⁻⁸' }, { value: '1e-6', label: '10⁻⁶ (느슨함)' }]} />
      <Select label="암시적 기준" value={String(params.suggestive)} onChange={(v) => setParams({ suggestive: Number(v) })} options={[{ value: '1e-5', label: '10⁻⁵' }, { value: '1e-4', label: '10⁻⁴' }, { value: '1e-3', label: '10⁻³' }]} />
      <Segmented label="염색체 색" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={[{ value: 'alt', label: '번갈아 2색' }, { value: 'chrom', label: '염색체별' }]} />
      <Slider label="세로축 상한 (−log₁₀ p)" value={params.cap} min={8} max={60} onChange={(cap) => setParams({ cap })} />
      <Toggle label="대표 변이 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>맨해튼 도표는 염색체를 이어 붙인 가로축 위에 변이마다 −log₁₀ p를 찍어, 질병이나 형질과 연관된 영역이 봉우리(마천루)로 솟는 모습을 보여 줍니다. 수십만 번 검정하므로 유의 기준을 p &lt; 0.05가 아니라 보통 5×10⁻⁸로 잡습니다(독립적인 약 100만 개 검정에 대한 본페로니 보정). 아래 인플레이션 계수 λ는 p 값의 중앙값에서 구하며 1보다 크게 높으면 집단 구조 등으로 전체가 부풀려졌을 수 있습니다. 이 데이터는 합성한 값이며 실제 환자나 유전체 자료가 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const manhattanModule: VizModule<ManhattanParams> = {
  roles: [
    { key: 'snp', label: '변이 이름', type: 'category', auto: true, prefer: 'SNP|rs|변이' },
    { key: 'chr', label: '염색체', type: 'number', required: true, prefer: '염색체|chr' },
    { key: 'pos', label: '염색체 위치', type: 'number', required: true, prefer: '위치|pos|bp' },
    { key: 'p', label: 'p 값', type: 'number', required: true, prefer: 'p값|pval|^p$' },
  ],
  datasets: ['gwas-synth'],
  defaultParams: { genomeWide: 5e-8, suggestive: 1e-5, scheme: 'alt', labels: true, cap: 30 },
  Chart: ManhattanChart,
  Controls: ManhattanControls,
  hint: '점에 포인터를 올리면 변이 이름과 위치 · 유의 기준선(빨간 점선)을 넘는 봉우리가 연관 신호입니다',
}

// ─── sequence logo ──────────────────────────────────────────────────────────────────

export interface LogoParams { alphabet: 'dna' | 'rna' | 'protein'; smallSample: boolean; mode: 'bits' | 'freq' }

const ALPHABETS: Record<LogoParams['alphabet'], string[]> = { dna: ['A', 'C', 'G', 'T'], rna: ['A', 'C', 'G', 'U'], protein: 'ACDEFGHIKLMNPQRSTVWY'.split('') }
const LETTER_COLOR: Record<string, string> = { A: '#3b9a4a', C: '#2f64b5', G: '#e0a21c', T: '#c94b4b', U: '#c94b4b' }
const AA_COLOR = (a: string) => ('GSTYCQN'.includes(a) ? '#4aa04a' : 'KRH'.includes(a) ? '#2f64b5' : 'DE'.includes(a) ? '#c94b4b' : 'AVLIPWFM'.includes(a) ? '#1f2937' : '#7d8794')

function LogoChart({ table, mapping, params, width, height, compact }: ChartProps<LogoParams>) {
  const seqs = useMemo(() => {
    const i = columnIndex(table, roleColumn(mapping, 'seq'))
    return i < 0 ? [] : table.rows.map((r) => toLabel(r[i]).replace(/\s/g, '')).filter(Boolean)
  }, [table, mapping])
  const alpha = ALPHABETS[params.alphabet]
  const cols = useMemo(() => (seqs.length ? sequenceLogo(seqs.map((s) => (params.alphabet === 'rna' ? s.toUpperCase().replace(/T/g, 'U') : s)), alpha, params.smallSample) : []), [seqs, alpha, params.smallSample, params.alphabet])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact, { left: compact ? 10 : 52 })
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  if (!roleColumn(mapping, 'seq')) return <ChartMessage>정렬된 서열(범주형·문자열) 열을 선택하세요.</ChartMessage>
  if (!cols.length) return <ChartMessage>서열이 없습니다.</ChartMessage>
  const maxBits = Math.log2(alpha.length)
  const colW = iw / cols.length
  const y = d3.scaleLinear([0, params.mode === 'bits' ? maxBits : 1], [ih, 0])
  const colorOf = (a: string) => (params.alphabet === 'protein' ? AA_COLOR(a) : LETTER_COLOR[a] ?? '#1f2937')
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`서열 로고: 위치 ${cols.length}개, 서열 ${seqs.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <line x1={0} x2={iw} y1={ih} y2={ih} stroke="#111827" strokeOpacity={0.5} />
          <AxisLeft scale={y} x={0} label={params.mode === 'bits' ? '정보량 (비트)' : '빈도'} compact={compact} ticks={params.mode === 'bits' ? Math.round(maxBits) + 1 : 5} grid={iw} />
          {cols.map((c, i) => {
            const total = params.mode === 'bits' ? c.bits : 1
            const letters = alpha.map((a) => ({ a, f: c.freqs[a] })).filter((l) => l.f > 0).sort((a, b) => a.f - b.f)
            let acc = 0
            return (
              <g key={i} transform={`translate(${i * colW},0)`} data-testid="logo-col" data-bits={c.bits.toFixed(3)}
                onPointerMove={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>위치 {i + 1}</b> (서열 {c.n}개)<br />정보량 {c.bits.toFixed(2)} 비트<br />{alpha.filter((a) => c.counts[a] > 0).sort((a, b) => c.counts[b] - c.counts[a]).slice(0, 4).map((a) => `${a} ${(c.freqs[a] * 100).toFixed(0)}%`).join(' · ')}</>) }}>
                <rect x={0} y={0} width={colW} height={ih} fill="transparent" />
                {letters.map(({ a, f }) => {
                  const h = y(0) - y(total * f)
                  const top = y(acc + total * f)
                  acc += total * f
                  if (h < 0.8) return null
                  // letters are scaled to fill the box exactly: SVG text of height ≈ 0.72·fontSize, so scale vertically from the baseline
                  const fontSize = 100
                  return <text key={a} data-testid="logo-letter" transform={`translate(${colW / 2},${top + h}) scale(${(colW * 0.94) / (fontSize * 0.68)},${h / (fontSize * 0.72)})`} textAnchor="middle" fontSize={fontSize} fontWeight={700} fontFamily="Arial, Helvetica, sans-serif" fill={colorOf(a)}>{a}</text>
                })}
                {!compact && colW > 14 && <text x={colW / 2} y={ih + 16} fontSize={10.5} textAnchor="middle" fill="#6b7773">{i + 1}</text>}
              </g>
            )
          })}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '서열', value: seqs.length }, { label: '길이', value: cols.length }, { label: '총 정보량', value: `${d3.sum(cols, (c) => c.bits).toFixed(1)} 비트` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function LogoControls({ params, setParams }: ControlsProps<LogoParams>) {
  return (
    <ControlGroup title="서열 로고">
      <Segmented label="알파벳" value={params.alphabet} onChange={(alphabet) => setParams({ alphabet })} testId="ctl-logo-alphabet" options={[{ value: 'dna', label: 'DNA' }, { value: 'rna', label: 'RNA' }, { value: 'protein', label: '단백질' }]} />
      <Segmented label="글자 높이" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-logo-mode" options={[{ value: 'bits', label: '정보량 (비트)' }, { value: 'freq', label: '빈도 100% 쌓기' }]} />
      <Toggle label="표본 수가 작을 때의 보정 (Schneider)" checked={params.smallSample} onChange={(smallSample) => setParams({ smallSample })} testId="ctl-logo-corr" />
      <Hint>서열 로고는 정렬된 서열들의 위치마다 각 문자의 빈도를 문자 높이로 쌓은 그림입니다. 한 위치의 전체 높이가 정보량(비트)이며 로그2(알파벳 크기)에서 위치의 엔트로피를 뺀 값입니다: DNA는 한 문자만 쓰이면 2비트, 네 문자가 같은 비율이면 0비트입니다. 서열 수가 적으면 우연한 쏠림만으로도 정보량이 높게 나오므로 표본 수 보정을 켜면 기대되는 편향을 뺍니다. 예시는 합성한 서열이며 모티프 TATAAGCT 위치가 높게 솟습니다.</Hint>
    </ControlGroup>
  )
}

export const sequenceLogoModule: VizModule<LogoParams> = {
  roles: [{ key: 'seq', label: '정렬된 서열 (같은 길이)', type: 'category', required: true, prefer: '서열|seq' }],
  datasets: ['binding-sites'],
  defaultParams: { alphabet: 'dna', smallSample: true, mode: 'bits' },
  Chart: LogoChart,
  Controls: LogoControls,
  hint: '글자 높이는 그 위치에서 그 문자의 빈도 × 정보량 · 표본 수 보정을 껐다 켜며 서열 수가 적을 때의 편향을 확인하세요',
}

// ─── coverage ───────────────────────────────────────────────────────────────────────

export interface CoverageParams { window: number; threshold: number; minLen: number; fill: boolean; logY: boolean }

function CoverageChart({ table, mapping, params, width, height, compact }: ChartProps<CoverageParams>) {
  const data = useMemo(() => {
    const xi = columnIndex(table, roleColumn(mapping, 'pos')), yi = columnIndex(table, roleColumn(mapping, 'depth'))
    if (xi < 0 || yi < 0) return []
    return table.rows.map((r) => ({ x: toNumber(r[xi]), y: toNumber(r[yi]) })).filter((d): d is { x: number; y: number } => d.x != null && d.y != null && d.y >= 0).sort((a, b) => a.x - b.x)
  }, [table, mapping])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  const depth = useMemo(() => data.map((d) => d.y), [data])
  const smooth = useMemo(() => runningMean(depth, Math.max(1, params.window)), [depth, params.window])
  const low = useMemo(() => lowCoverageRegions(depth, params.threshold, params.minLen), [depth, params.threshold, params.minLen])
  const mean = depth.length ? d3.mean(depth)! : 0
  const x = useMemo(() => d3.scaleLinear(d3.extent(data, (d) => d.x) as [number, number], [0, iw]), [data, iw])
  const ymax = Math.max(1, d3.max(depth) ?? 1) * 1.05
  const y = useMemo(() => (params.logY ? d3.scaleSymlog().constant(1).domain([0, ymax]).range([ih, 0]) : d3.scaleLinear([0, ymax], [ih, 0])), [params.logY, ymax, ih])
  if (!roleColumn(mapping, 'pos') || !roleColumn(mapping, 'depth')) return <ChartMessage>위치와 깊이(숫자형) 열을 선택하세요.</ChartMessage>
  if (data.length < 2) return <ChartMessage>위치와 깊이 값이 2개 이상 필요합니다.</ChartMessage>
  const area = d3.area<number>().x((_, i) => x(data[i].x)).y0(ih).y1((v) => y(v)).curve(d3.curveStepAfter)
  const lineP = d3.line<number>().x((_, i) => x(data[i].x)).y((v) => y(v))
  const below = depth.filter((d) => d < params.threshold).length
  const yScaleAxis = params.logY ? d3.scaleLinear([0, ymax], [ih, 0]) : (y as d3.ScaleLinear<number, number>)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`시퀀싱 깊이: 평균 ${mean.toFixed(1)}배, 깊이 부족 구간 ${low.length}곳`} onPointerLeave={hide}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#e1e6e4" />
          {low.map(([a, b], k) => <rect key={k} data-testid="coverage-low" x={x(data[a].x)} width={Math.max(2, x(data[b].x) - x(data[a].x))} y={0} height={ih} fill="#c94b4b" fillOpacity={0.14} />)}
          {params.logY ? <AxisLeft scale={y as unknown as d3.ScaleLinear<number, number>} x={0} label="깊이 (배, 제곱근형 눈금)" compact={compact} grid={iw} ticks={5} /> : <AxisLeft scale={yScaleAxis} x={0} label="깊이 (읽힌 횟수)" compact={compact} grid={iw} />}
          <AxisBottom scale={x} y={ih} label="유전체 위치 (염기)" compact={compact} />
          {params.fill && <path d={area(depth) ?? ''} fill="#2a8c82" fillOpacity={0.22} />}
          <path d={lineP(depth) ?? ''} fill="none" stroke="#2a8c82" strokeWidth={0.9} strokeOpacity={0.85} data-testid="coverage-raw" />
          <path d={lineP(smooth) ?? ''} fill="none" stroke="#e07a3f" strokeWidth={2} data-testid="coverage-smooth" />
          <line x1={0} x2={iw} y1={y(mean)} y2={y(mean)} stroke="#111827" strokeDasharray="5 3" strokeOpacity={0.6} />
          <line x1={0} x2={iw} y1={y(params.threshold)} y2={y(params.threshold)} stroke="#c94b4b" strokeDasharray="3 3" />
          {!compact && <rect width={iw} height={ih} fill="transparent" onPointerMove={(e) => {
            const l = localPoint(svgRef.current!, e)
            const i = Math.max(0, Math.min(data.length - 1, d3.bisector((d: { x: number }) => d.x).center(data, x.invert(l.x - m.left))))
            show(l.x, l.y, <><b>{fmt(data[i].x)}</b><br />깊이 {fmt(data[i].y)}<br />이동 평균 {smooth[i].toFixed(1)}</>)
          }} />}
        </g>
      </svg>
      {!compact && <><Legend items={[{ key: '위치별 깊이', color: '#2a8c82' }, { key: '이동 평균', color: '#e07a3f' }]} /><Readout items={[{ label: '평균 깊이', value: `${mean.toFixed(1)}배` }, { label: '깊이 부족 구간', value: low.length }, { label: `깊이 < ${params.threshold}`, value: `${((below / depth.length) * 100).toFixed(1)}%` }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function CoverageControls({ params, setParams }: ControlsProps<CoverageParams>) {
  return (
    <ControlGroup title="시퀀싱 깊이">
      <Slider label="이동 평균 창 (구간 수)" value={params.window} min={1} max={101} step={2} onChange={(window) => setParams({ window })} testId="ctl-cov-window" />
      <Slider label="깊이 부족 기준" value={params.threshold} min={1} max={30} onChange={(threshold) => setParams({ threshold })} testId="ctl-cov-threshold" />
      <Slider label="연속 최소 길이 (구간 수)" value={params.minLen} min={1} max={30} onChange={(minLen) => setParams({ minLen })} />
      <Toggle label="아래를 채움" checked={params.fill} onChange={(fill) => setParams({ fill })} />
      <Toggle label="제곱근형(symlog) 세로 눈금" checked={params.logY} onChange={(logY) => setParams({ logY })} />
      <Hint>시퀀싱 깊이 그림은 유전체 위치마다 서열 조각이 몇 번 겹쳐 읽혔는지를 보여 줍니다. 깊이가 낮은 곳은 변이를 놓치거나 틀리게 판정할 수 있는 영역이고(붉은 띠), 평균보다 훨씬 높은 곳은 중복 증폭이나 복제수 증가를 의심할 수 있습니다. 위치별 깊이는 들쭉날쭉하므로 이동 평균으로 큰 흐름을 함께 봅니다. 이 데이터는 합성한 값입니다.</Hint>
    </ControlGroup>
  )
}

export const coverageModule: VizModule<CoverageParams> = {
  roles: [{ key: 'pos', label: '위치', type: 'number', required: true, prefer: '위치|pos' }, { key: 'depth', label: '깊이', type: 'number', required: true, prefer: '깊이|depth|coverage' }],
  datasets: ['coverage-synth'],
  defaultParams: { window: 25, threshold: 10, minLen: 3, fill: true, logY: false },
  Chart: CoverageChart,
  Controls: CoverageControls,
  hint: '붉은 띠는 기준 이하로 이어지는 구간 · 이동 평균 창과 기준 깊이를 바꿔 보세요',
}

// ─── distance-matrix helper (PCoA, tree) ────────────────────────────────────────────

interface DistInput { names: string[]; D: number[][]; groups: string[]; asym: number }

function distInput(table: DataTable, mapping: Mapping): DistInput | null {
  const cols = roleColumns(mapping, 'dist')
  const li = columnIndex(table, roleColumn(mapping, 'label')), gi = columnIndex(table, roleColumn(mapping, 'group'))
  const ci = cols.map((c) => columnIndex(table, c)).filter((i) => i >= 0)
  const n = table.rows.length
  if (n < 3 || ci.length < n) return null
  const use = ci.slice(0, n)
  const D = table.rows.map((r) => use.map((c) => toNumber(r[c]) ?? NaN))
  if (D.some((r) => r.some((v) => !Number.isFinite(v) || v < 0))) return null
  let asym = 0
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) asym = Math.max(asym, Math.abs(D[i][j] - D[j][i]))
  // symmetrize and zero the diagonal so mildly asymmetric input still gives a valid dissimilarity
  const S = D.map((r, i) => r.map((v, j) => (i === j ? 0 : (v + D[j][i]) / 2)))
  return { names: table.rows.map((r, i) => (li >= 0 ? toLabel(r[li]) : `행 ${i + 1}`)), D: S, groups: gi >= 0 ? table.rows.map((r) => toLabel(r[gi])) : [], asym }
}

const distRoles = (withGroup: boolean) => [
  { key: 'label', label: '이름', type: 'category' as const, auto: true },
  ...(withGroup ? [{ key: 'group', label: '묶음 (선택, 색)', type: 'category' as const, auto: true, prefer: '환경|묶음|group' }] : []),
  { key: 'dist', label: '거리 열 (행과 같은 개수의 정방 행렬)', type: 'number' as const, required: true, multiple: { min: 3 } },
]

// ─── PCoA ───────────────────────────────────────────────────────────────────────────

export interface PcoaParams { xAxis: number; yAxis: number; labels: boolean; ellipses: boolean }

function PcoaChart({ table, mapping, params, width, height, compact, linked }: ChartProps<PcoaParams>) {
  const inp = useMemo(() => distInput(table, mapping), [table, mapping])
  const res = useMemo(() => (inp ? pcoa(inp.D, 4) : null), [inp])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = margins(compact)
  const iw = Math.max(10, width - m.left - m.right), ih = Math.max(10, height - m.top - m.bottom)
  const groups = useMemo(() => (inp?.groups.length ? [...new Set(inp.groups)] : []), [inp])
  const color = categoryColor(groups)
  const ax = Math.min(params.xAxis, (res?.coords[0].length ?? 1) - 1), ay = Math.min(params.yAxis, (res?.coords[0].length ?? 1) - 1)
  const pts = useMemo(() => (res ? res.coords.map((c) => ({ x: c[ax] ?? 0, y: c[ay] ?? 0 })) : []), [res, ax, ay])
  const x = useMemo(() => d3.scaleLinear(paddedDomainLocal(pts.map((p) => p.x)), [0, iw]), [pts, iw])
  const y = useMemo(() => d3.scaleLinear(paddedDomainLocal(pts.map((p) => p.y)), [ih, 0]), [pts, ih])
  const linkedSet = useMemo(() => new Set(linked?.rows ?? []), [linked?.rows])
  if (!roleColumns(mapping, 'dist').length) return <ChartMessage>거리 열(숫자형)을 행 개수만큼 선택하세요.</ChartMessage>
  if (!inp) return <ChartMessage>거리 행렬이 정방(행 수 = 열 수)이 아니거나 음수·결측 값이 있습니다. 행과 같은 개수의 거리 열을 선택하세요.</ChartMessage>
  if (!res) return <ChartMessage>PCoA를 계산할 수 없습니다 (표본 3개 이상 필요).</ChartMessage>
  const ellipse = (idx: number[]) => {
    if (idx.length < 4) return null
    const mx = d3.mean(idx, (i) => pts[i].x)!, my = d3.mean(idx, (i) => pts[i].y)!
    const sxx = d3.sum(idx, (i) => (pts[i].x - mx) ** 2) / (idx.length - 1), syy = d3.sum(idx, (i) => (pts[i].y - my) ** 2) / (idx.length - 1), sxy = d3.sum(idx, (i) => (pts[i].x - mx) * (pts[i].y - my)) / (idx.length - 1)
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc), ang = Math.atan2(l1 - sxx, sxy || 1e-12)
    const k = Math.sqrt(5.991) // 95% region of a bivariate normal: χ²₂(0.95)
    return { cx: x(mx), cy: y(my), rx: (Math.sqrt(l1) * k * iw) / Math.max(1e-9, x.domain()[1] - x.domain()[0]), ry: (Math.sqrt(l2) * k * ih) / Math.max(1e-9, y.domain()[1] - y.domain()[0]), ang }
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`PCoA: 표본 ${pts.length}개, 축 ${ax + 1}이 ${(res.explained[ax] * 100).toFixed(0)}% 설명`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <rect width={iw} height={ih} fill="none" stroke="#e1e6e4" />
          <AxisBottom scale={x} y={ih} label={`PCo${ax + 1} (${(res.explained[ax] * 100).toFixed(1)}%)`} compact={compact} grid={ih} />
          <AxisLeft scale={y} x={0} label={`PCo${ay + 1} (${(res.explained[ay] * 100).toFixed(1)}%)`} compact={compact} grid={iw} />
          {params.ellipses && groups.map((g) => {
            const e = ellipse(inp.groups.map((gg, i) => (gg === g ? i : -1)).filter((i) => i >= 0))
            return e ? <ellipse key={g} data-testid="pcoa-ellipse" cx={e.cx} cy={e.cy} rx={Math.max(1, e.rx)} ry={Math.max(1, e.ry)} transform={`rotate(${(-e.ang * 180) / Math.PI} ${e.cx} ${e.cy})`} fill={color(g)} fillOpacity={0.1} stroke={color(g)} strokeDasharray="4 3" /> : null
          })}
          {pts.map((p, i) => (
            <g key={i} data-testid="pcoa-point" onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); linked?.set([i]); show(l.x, l.y, <><b>{inp.names[i]}</b>{inp.groups[i] ? ` · ${inp.groups[i]}` : ''}<br />PCo{ax + 1} {fmt(p.x, 3)}, PCo{ay + 1} {fmt(p.y, 3)}</>) }} onPointerLeave={() => { hide(); linked?.set(null) }}>
              <circle cx={x(p.x)} cy={y(p.y)} r={linkedSet.has(i) ? 8 : compact ? 3 : 6} fill={groups.length ? color(inp.groups[i]) : '#2a8c82'} fillOpacity={0.85} stroke={linkedSet.has(i) ? '#111827' : '#fff'} strokeWidth={linkedSet.has(i) ? 2 : 1} />
              {!compact && params.labels && <text x={x(p.x) + 9} y={y(p.y) + 4} fontSize={10.5} fill="#374151">{inp.names[i]}</text>}
            </g>
          ))}
        </g>
      </svg>
      {!compact && <><Legend items={groups.map((g) => ({ key: g, color: color(g) }))} /><Readout items={[{ label: '표본', value: pts.length }, { label: '두 축이 설명', value: `${((res.explained[ax] + (ay === ax ? 0 : res.explained[ay])) * 100).toFixed(0)}%` }, ...(res.negativeShare > 0.02 ? [{ label: '음의 고윳값', value: `${(res.negativeShare * 100).toFixed(0)}%` }] : [])]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function paddedDomainLocal(v: readonly number[]): [number, number] {
  const lo = Math.min(...v), hi = Math.max(...v)
  const pad = (hi - lo || 1) * 0.1
  return [lo - pad, hi + pad]
}

function PcoaControls({ params, setParams }: ControlsProps<PcoaParams>) {
  return (
    <ControlGroup title="PCoA">
      <Segmented label="가로축" value={String(params.xAxis)} onChange={(v) => setParams({ xAxis: Number(v) })} testId="ctl-pcoa-x" options={[{ value: '0', label: 'PCo1' }, { value: '1', label: 'PCo2' }, { value: '2', label: 'PCo3' }]} />
      <Segmented label="세로축" value={String(params.yAxis)} onChange={(v) => setParams({ yAxis: Number(v) })} testId="ctl-pcoa-y" options={[{ value: '0', label: 'PCo1' }, { value: '1', label: 'PCo2' }, { value: '2', label: 'PCo3' }]} />
      <Toggle label="묶음별 95% 타원" checked={params.ellipses} onChange={(ellipses) => setParams({ ellipses })} />
      <Toggle label="시료 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>주좌표분석(PCoA)은 시료 사이의 거리 행렬만 가지고 시료를 평면에 놓는 방법입니다: −½D²를 이중 중심화한 행렬의 고유분해에서 큰 고윳값의 고유벡터를 √고윳값으로 늘려 좌표를 얻습니다. 평면에서 가까운 점은 원래 거리도 가깝지만 멀다고 꼭 그만큼 먼 것은 아니며, 축 옆의 %는 그 축이 설명하는 변동의 몫입니다. Bray–Curtis처럼 유클리드 거리가 아닌 비유사도는 음의 고윳값이 생길 수 있고, 그 비율이 크면 평면 그림이 거리를 잘 보존하지 못한다는 뜻입니다.</Hint>
    </ControlGroup>
  )
}

export const pcoaModule: VizModule<PcoaParams> = {
  roles: distRoles(true),
  datasets: ['microbiome-dist', 'species-dist'],
  defaultParams: { xAxis: 0, yAxis: 1, labels: true, ellipses: true },
  Chart: PcoaChart,
  Controls: PcoaControls,
  hint: '가까운 점일수록 군집 구성이 비슷합니다 · 축을 바꿔 PCo3까지 확인하세요 · 점에 포인터를 올리면 시료 이름',
}

// ─── phylogenetic tree ──────────────────────────────────────────────────────────────

export interface TreeParams { method: 'upgma' | 'nj'; layout: 'rect' | 'radial'; lengths: boolean; labels: boolean; scale: boolean }

function PhyloChart({ table, mapping, params, width, height, compact }: ChartProps<TreeParams>) {
  const inp = useMemo(() => distInput(table, mapping), [table, mapping])
  const tree = useMemo(() => (inp ? (params.method === 'upgma' ? upgma(inp.D, inp.names) : neighborJoining(inp.D, inp.names)) : null), [inp, params.method])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const layoutData = useMemo(() => {
    if (!tree) return null
    // distance from the root for every node; leaves are placed at consecutive slots
    const order = leaves(tree)
    const slot = new Map(order.map((l, i) => [l.id, i]))
    const info = new Map<number, { depth: number; pos: number; node: PhyloNode; parent: number | null }>()
    const walk = (n: PhyloNode, depth: number, parent: number | null): number => {
      const d = depth + n.length
      const pos = n.children.length ? d3.mean(n.children.map((c) => walk(c, d, n.id)))! : slot.get(n.id)!
      info.set(n.id, { depth: d, pos, node: n, parent })
      return pos
    }
    walk(tree, 0, null)
    return { info, order, maxDepth: Math.max(...[...info.values()].map((v) => v.depth)) }
  }, [tree])
  if (!roleColumns(mapping, 'dist').length) return <ChartMessage>거리 열(숫자형)을 행 개수만큼 선택하세요.</ChartMessage>
  if (!inp || !tree || !layoutData) return <ChartMessage>거리 행렬이 정방(행 수 = 열 수)이 아니거나 음수·결측 값이 있습니다.</ChartMessage>
  const { info, order, maxDepth } = layoutData
  const n = order.length
  const radial = params.layout === 'radial'
  const labelPad = compact ? 6 : radial ? 76 : 100
  const W = Math.max(10, width - (compact ? 16 : 40) - (radial ? labelPad : labelPad)), H = Math.max(10, height - (compact ? 16 : 70))
  const R = Math.max(30, Math.min(width, height - 30) / 2 - labelPad)
  const sx = (d: number) => (radial ? (d / (maxDepth || 1)) * R : (d / (maxDepth || 1)) * W)
  const place = (id: number): [number, number] => {
    const v = info.get(id)!
    if (!radial) return [sx(v.depth), ((v.pos + 0.5) / n) * H]
    const a = (v.pos / n) * Math.PI * 2 - Math.PI / 2
    return [sx(v.depth) * Math.cos(a), sx(v.depth) * Math.sin(a)]
  }
  const edges = [...info.values()].filter((v) => v.parent != null)
  const path = (v: (typeof edges)[number]) => {
    const [x2, y2] = place(v.node.id), [x1, y1] = place(v.parent!)
    if (!radial) return `M${x1},${y1}V${y2}H${x2}`
    const pr = info.get(v.parent!)!, a2 = (info.get(v.node.id)!.pos / n) * Math.PI * 2 - Math.PI / 2, a1 = (pr.pos / n) * Math.PI * 2 - Math.PI / 2, r1 = sx(pr.depth)
    // arc along the parent's circle to the child's angle, then straight out
    const [ax, ay] = [r1 * Math.cos(a2), r1 * Math.sin(a2)]
    return `M${x1},${y1}A${r1},${r1} 0 0 ${a2 > a1 ? 1 : 0} ${ax},${ay}L${x2},${y2}`
  }
  const scaleLen = (() => { const raw = maxDepth / 5; const p = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 5].map((k) => k * p).reduce((best, c) => (Math.abs(c - raw) < Math.abs(best - raw) ? c : best), p) })()
  const originX = radial ? width / 2 : 20, originY = radial ? height / 2 : 20
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`계통수: ${n}종, ${params.method === 'upgma' ? 'UPGMA' : '이웃 연결법'}`} onPointerLeave={hide}>
        <g transform={`translate(${originX},${originY})`}>
          {edges.map((v) => <path key={v.node.id} data-testid="tree-branch" d={path(v)} fill="none" stroke="#6b7773" strokeWidth={1.6}
            onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{v.node.name ?? '내부 가지'}</b><br />가지 길이 {v.node.length.toFixed(3)}<br />뿌리에서 {v.depth.toFixed(3)}</>) }} onPointerLeave={hide} />)}
          {edges.filter((v) => !v.node.children.length || params.lengths).map((v) => {
            if (compact || !params.lengths) return null
            const [x2, y2] = place(v.node.id), [x1] = place(v.parent!)
            return !radial ? <text key={`b${v.node.id}`} x={(x1 + x2) / 2} y={y2 - 3} fontSize={9.5} textAnchor="middle" fill="#8a9490">{v.node.length.toFixed(2)}</text> : null
          })}
          {order.map((l) => {
            const [x, y] = place(l.id), a = (info.get(l.id)!.pos / n) * 360 - 90
            return (
              <g key={l.id}>
                <circle cx={x} cy={y} r={compact ? 2.5 : 4} fill="#2a8c82" data-testid="tree-leaf" />
                {!compact && params.labels && (radial
                  ? <text transform={`translate(${x},${y}) rotate(${a > 90 ? a - 180 : a}) translate(${a > 90 ? -9 : 9},0)`} fontSize={11.5} textAnchor={a > 90 ? 'end' : 'start'} dy="0.32em" fill="#111827">{l.name}</text>
                  : <text x={x + 9} y={y + 4} fontSize={11.5} fill="#111827">{l.name}</text>)}
              </g>
            )
          })}
          {!compact && params.scale && <g transform={radial ? `translate(${-width / 2 + 24},${height / 2 - 28})` : `translate(0,${H + 30})`}><line x1={0} x2={sx(scaleLen)} stroke="#111827" strokeWidth={2} /><line x1={0} x2={0} y1={-4} y2={4} stroke="#111827" /><line x1={sx(scaleLen)} x2={sx(scaleLen)} y1={-4} y2={4} stroke="#111827" /><text x={sx(scaleLen) / 2} y={-8} fontSize={11} textAnchor="middle" fill="#374151">{scaleLen} (거리)</text></g>}
        </g>
      </svg>
      {!compact && <><Readout items={[{ label: '종', value: n }, { label: '방법', value: params.method === 'upgma' ? 'UPGMA (뿌리 있음)' : '이웃 연결법' }, { label: '가장 깊은 잎', value: maxDepth.toFixed(2) }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function PhyloControls({ params, setParams }: ControlsProps<TreeParams>) {
  return (
    <ControlGroup title="계통수">
      <Segmented label="나무 만드는 방법" value={params.method} onChange={(method) => setParams({ method })} testId="ctl-tree-method" options={[{ value: 'upgma', label: 'UPGMA' }, { value: 'nj', label: '이웃 연결법' }]} />
      <Segmented label="배치" value={params.layout} onChange={(layout) => setParams({ layout })} testId="ctl-tree-layout" options={[{ value: 'rect', label: '직사각형' }, { value: 'radial', label: '방사형' }]} />
      <Toggle label="가지 길이 숫자" checked={params.lengths} onChange={(lengths) => setParams({ lengths })} />
      <Toggle label="종 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Toggle label="거리 눈금자" checked={params.scale} onChange={(scale) => setParams({ scale })} />
      <Hint>계통수는 종(또는 시료) 사이의 거리 행렬로 진화적 관계를 가지 모양으로 그립니다. UPGMA는 가장 가까운 둘씩 평균 연결하며 모든 종의 진화 속도가 같다(분자시계)고 가정하므로 잎이 뿌리에서 모두 같은 거리에 놓입니다. 이웃 연결법은 그 가정 없이 가지마다 길이를 따로 추정하며 거리가 가지 길이의 합으로 정확히 표현되는 경우 그대로 복원합니다. 두 방법의 결과가 다르면 속도 일정 가정이 깨진 것일 수 있습니다. 가로 길이만 거리를 뜻하고 세로 순서는 의미가 없습니다. 이웃 연결법의 뿌리는 편의상 마지막으로 합친 곳이어서 진화적 뿌리가 아닙니다.</Hint>
    </ControlGroup>
  )
}

export const phyloModule: VizModule<TreeParams> = {
  roles: distRoles(false),
  datasets: ['species-dist', 'microbiome-dist'],
  defaultParams: { method: 'nj', layout: 'rect', lengths: false, labels: true, scale: true },
  Chart: PhyloChart,
  Controls: PhyloControls,
  hint: 'UPGMA와 이웃 연결법을 번갈아 보세요(속도 일정 가정의 차이) · 가로 길이가 거리 · 가지에 포인터를 올리면 길이',
}

// ─── clustered heatmap ──────────────────────────────────────────────────────────────

export interface ClusterHeatParams { linkage: Linkage; scale: 'row' | 'none'; scheme: ColorScheme; cutRows: number; clusterRows: boolean; clusterCols: boolean; values: boolean }

function leafOrder(t: ClusterNode): number[] { return t.children ? t.children.flatMap(leafOrder) : [t.id] }

/** Dendrogram edges (elbow connectors) laid out along one axis; `slot(leafId)` gives the leaf's position, heights are scaled by `h`. */
function dendroEdges(t: ClusterNode, slot: (id: number) => number, h: (height: number) => number) {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [] // x = position along leaf axis, y = height
  const pos = new Map<number, number>()
  const rec = (n: ClusterNode): number => {
    if (!n.children) { const p = slot(n.id); pos.set(n.id, p); return p }
    const ps = n.children.map(rec)
    const p = (ps[0] + ps[1]) / 2
    pos.set(n.id, p)
    n.children.forEach((c, k) => out.push({ x1: ps[k], y1: h(c.height), x2: ps[k], y2: h(n.height) }))
    out.push({ x1: ps[0], y1: h(n.height), x2: ps[1], y2: h(n.height) })
    return p
  }
  rec(t)
  return out
}

function ClusterHeatChart({ table, mapping, params, width, height, compact }: ChartProps<ClusterHeatParams>) {
  const colNames = roleColumns(mapping, 'columns')
  const data = useMemo(() => {
    const li = columnIndex(table, roleColumn(mapping, 'label'))
    const ci = colNames.map((c) => columnIndex(table, c)).filter((i) => i >= 0)
    const names: string[] = [], rows: number[][] = []
    table.rows.forEach((r, i) => {
      const vals = ci.map((c) => toNumber(r[c]))
      if (vals.some((v) => v == null)) return
      names.push(li >= 0 ? toLabel(r[li]) : `행 ${i + 1}`)
      rows.push(vals as number[])
    })
    return { names, rows, cols: ci.map((i) => table.columns[i].name) }
  }, [table, mapping, colNames.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const z = useMemo(() => {
    if (params.scale === 'none') return data.rows
    // row z-score: each gene is centred on its own mean so the pattern, not the level, is compared
    return data.rows.map((r) => { const mu = d3.mean(r)!, sd = Math.sqrt(d3.sum(r, (v) => (v - mu) ** 2) / Math.max(1, r.length - 1)); return r.map((v) => (sd > 0 ? (v - mu) / sd : 0)) })
  }, [data.rows, params.scale])
  const rowTree = useMemo(() => (params.clusterRows && z.length >= 2 ? linkageTree(hclust(z, 'euclidean', params.linkage), data.names) : null), [z, data.names, params.clusterRows, params.linkage])
  const colTree = useMemo(() => {
    if (!params.clusterCols || data.cols.length < 2 || !z.length) return null
    const cols = data.cols.map((_, j) => z.map((r) => r[j]))
    return linkageTree(hclust(cols, 'euclidean', params.linkage), data.cols)
  }, [z, data.cols, params.clusterCols, params.linkage])
  const rowOrder = useMemo(() => (rowTree ? leafOrder(rowTree) : z.map((_, i) => i)), [rowTree, z])
  const colOrder = useMemo(() => (colTree ? leafOrder(colTree) : data.cols.map((_, j) => j)), [colTree, data.cols])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (colNames.length < 2) return <ChartMessage>숫자형 열을 2개 이상 선택하세요.</ChartMessage>
  if (data.rows.length < 2) return <ChartMessage>결측 없는 행이 2개 이상 필요합니다.</ChartMessage>
  const treeW = compact ? 0 : 70, treeH = compact ? 0 : 60
  const labelW = compact ? 0 : Math.min(90, width * 0.16), labelH = compact ? 0 : 54
  const left = compact ? 6 : 12, top = compact ? 6 : 12
  const gw = Math.max(10, width - left - treeW - labelW - 12), gh = Math.max(10, height - top - treeH - (compact ? 8 : 14 + labelH + 22))
  const cw = gw / colOrder.length, ch = gh / rowOrder.length
  const scheme = schemes[params.scheme]
  const lim = params.scale === 'row' ? Math.max(1, d3.max(z, (r) => d3.max(r, Math.abs)) ?? 1) : 0
  const ext = params.scale === 'row' ? [-lim, lim] : (d3.extent(z.flat()) as [number, number])
  const col = (v: number) => scheme.interpolate(Math.max(0, Math.min(1, (v - ext[0]) / (ext[1] - ext[0] || 1))))
  const rowH = rowTree ? rowTree.height || 1 : 1, colH = colTree ? colTree.height || 1 : 1
  const rowPos = new Map(rowOrder.map((id, k) => [id, k]))
  const colPos = new Map(colOrder.map((id, k) => [id, k]))
  const gx = left + treeW, gy = top + treeH
  const rEdges = rowTree ? dendroEdges(rowTree, (id) => gy + (rowPos.get(id)! + 0.5) * ch, (h) => left + treeW - (h / rowH) * (treeW - 4)) : []
  const cEdges = colTree ? dendroEdges(colTree, (id) => gx + (colPos.get(id)! + 0.5) * cw, (h) => top + treeH - (h / colH) * (treeH - 4)) : []
  const flat = params.cutRows > 0 && rowTree ? cutLabels(hclust(z, 'euclidean', params.linkage), z.length, params.cutRows) : null
  const clusterColor = categoryColor(Array.from({ length: params.cutRows }, (_, i) => String(i)))
  const showValues = params.values && !compact && cw > 28 && ch > 14
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`군집화 히트맵: 행 ${data.rows.length}개, 열 ${data.cols.length}개`} onPointerLeave={hide}>
        {!compact && rEdges.map((e, k) => <line key={`r${k}`} data-testid="dendro-row" x1={e.y1} x2={e.y2} y1={e.x1} y2={e.x2} stroke="#6b7773" strokeWidth={1} />)}
        {!compact && cEdges.map((e, k) => <line key={`c${k}`} data-testid="dendro-col" x1={e.x1} x2={e.x2} y1={e.y1} y2={e.y2} stroke="#6b7773" strokeWidth={1} />)}
        <g transform={`translate(${gx},${gy})`}>
          <rect width={gw} height={gh} fill="none" stroke="#e1e6e4" />
          {rowOrder.map((ri, rk) => colOrder.map((cj, ck) => (
            <rect key={`${ri}-${cj}`} data-testid="cluster-cell" x={ck * cw} y={rk * ch} width={Math.max(0.5, cw - (cw > 6 ? 0.6 : 0))} height={Math.max(0.5, ch - (ch > 6 ? 0.6 : 0))} fill={col(z[ri][cj])}
              onPointerEnter={compact ? undefined : (e) => { const l = localPoint(svgRef.current!, e); show(l.x, l.y, <><b>{data.names[ri]}</b> · {data.cols[cj]}<br />값 {fmt(data.rows[ri][cj], 3)}{params.scale === 'row' ? <><br />행 표준점수 {z[ri][cj].toFixed(2)}</> : null}</>) }} onPointerLeave={hide} />
          )))}
          {flat && rowOrder.map((ri, rk) => <rect key={`k${ri}`} x={gw + 3} y={rk * ch} width={6} height={Math.max(0.5, ch)} fill={clusterColor(String(flat[ri]))} data-testid="cluster-cut" />)}
          {showValues && rowOrder.map((ri, rk) => colOrder.map((cj, ck) => <text key={`t${ri}-${cj}`} x={ck * cw + cw / 2} y={rk * ch + ch / 2} dy="0.32em" fontSize={10} textAnchor="middle" fill={d3.hsl(col(z[ri][cj])).l > 0.55 ? '#111827' : '#fff'}>{params.scale === 'row' ? z[ri][cj].toFixed(1) : fmt(data.rows[ri][cj], 1)}</text>))}
          {!compact && ch > 9 && rowOrder.map((ri, rk) => <text key={`rl${ri}`} x={gw + (flat ? 14 : 5)} y={rk * ch + ch / 2} dy="0.32em" fontSize={Math.min(11, ch * 0.9)} fill="#374151">{data.names[ri]}</text>)}
          {!compact && colOrder.map((cj, ck) => <text key={`cl${cj}`} transform={`translate(${ck * cw + cw / 2},${gh + 8}) rotate(50)`} fontSize={10.5} fill="#374151">{data.cols[cj]}</text>)}
        </g>
      </svg>
      {!compact && <><div className="color-legend"><span>{fmt(ext[0], 2)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(v)).join(',')})` }} /><span>{fmt(ext[1], 2)}</span></div><Readout items={[{ label: '행', value: data.rows.length }, { label: '열', value: data.cols.length }, { label: '연결법', value: ({ single: '단일', complete: '완전', average: '평균', ward: 'Ward' } as const)[params.linkage] }]} /><Tooltip tip={tip} width={width} /></>}
    </div>
  )
}

function cutLabels(merges: ReturnType<typeof hclust>, n: number, k: number): number[] {
  // cut the dendrogram so that exactly k clusters remain: merge only the first n−k joins
  const parent = Array.from({ length: 2 * n - 1 }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  merges.slice(0, Math.max(0, n - k)).forEach((m, i) => { parent[find(m.a)] = n + i; parent[find(m.b)] = n + i })
  const ids = new Map<number, number>()
  return Array.from({ length: n }, (_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r)! })
}

function ClusterHeatControls({ params, setParams }: ControlsProps<ClusterHeatParams>) {
  return (
    <ControlGroup title="군집화 히트맵">
      <Segmented label="값 표준화" value={params.scale} onChange={(scale) => setParams({ scale })} testId="ctl-ch-scale" options={[{ value: 'row', label: '행 표준점수' }, { value: 'none', label: '원래 값' }]} />
      <Select label="연결법" value={params.linkage} onChange={(linkage) => setParams({ linkage })} testId="ctl-ch-linkage" options={[{ value: 'average', label: '평균 연결' }, { value: 'complete', label: '완전 연결' }, { value: 'single', label: '단일 연결' }, { value: 'ward', label: 'Ward' }]} />
      <Toggle label="행 군집화" checked={params.clusterRows} onChange={(clusterRows) => setParams({ clusterRows })} testId="ctl-ch-rows" />
      <Toggle label="열 군집화" checked={params.clusterCols} onChange={(clusterCols) => setParams({ clusterCols })} testId="ctl-ch-cols" />
      <Slider label="행을 나눌 군집 수 (0 = 표시 안 함)" value={params.cutRows} min={0} max={8} onChange={(cutRows) => setParams({ cutRows })} testId="ctl-ch-cut" />
      <Select label="팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={[...div, ...seq]} />
      <Toggle label="칸에 값 표시" checked={params.values} onChange={(values) => setParams({ values })} />
      <Hint>군집화 히트맵은 행렬을 색으로 칠하되 행과 열을 계층적 군집화 순서로 다시 배열해, 비슷한 패턴의 행(유전자)과 열(시료)이 이웃하도록 합니다. 가장자리의 덴드로그램은 가지가 합쳐지는 높이로 얼마나 비슷한지를 나타냅니다. 행 표준점수로 바꾸면 발현 수준이 아니라 변하는 모양이 비교되어 같은 패턴의 유전자가 묶이고, 연결법에 따라 묶이는 모양이 달라질 수 있습니다. 덴드로그램에서 가로 위치의 좌우 순서는 의미가 없고 높이만 거리를 뜻합니다. 데이터는 합성한 값입니다.</Hint>
    </ControlGroup>
  )
}

export const clusterHeatModule: VizModule<ClusterHeatParams> = {
  roles: [
    { key: 'label', label: '행 이름 (유전자)', type: 'category', auto: true },
    { key: 'columns', label: '열 (시료, 숫자형)', type: 'number', required: true, multiple: { min: 2, max: 30 } },
  ],
  datasets: ['expression-matrix'],
  defaultParams: { linkage: 'average', scale: 'row', scheme: 'rdbu', cutRows: 3, clusterRows: true, clusterCols: true, values: false },
  Chart: ClusterHeatChart,
  Controls: ClusterHeatControls,
  hint: '행 표준점수와 연결법을 바꿔 묶음이 어떻게 달라지는지 보세요 · 칸에 포인터를 올리면 값 · 행 군집 수를 지정하면 오른쪽에 색 띠',
}

