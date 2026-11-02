import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor, schemes, type SequentialScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { hclust, linkageTree, standardizeColumns, type Linkage } from '../../stats/cluster'
import { buildTree } from '../../stats/hierarchy'
import {
  curveCell, curveSide, leafOrder, parallelSets, tangleCrossings, untangle, voronoiTreemap, wordCloud, wordFrequencies, wordTree, type CurveKind, type P2, type WordNode,
} from '../../stats/struct7'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

const ACCENT = '#2a8c82'
const paletteOptions = [{ value: 'viridis', label: 'Viridis' }, { value: 'blues', label: '파랑' }, { value: 'magma', label: 'Magma' }, { value: 'ylorrd', label: '노랑–빨강' }] as { value: SequentialScheme; label: string }[]

// ───────────────────────────── Parallel Sets ─────────────────────────────

export interface PSParams { gap: number; opacity: number; colorDim: number; curve: number }

function PSChart({ table, mapping, params, width, height, compact }: ChartProps<PSParams>) {
  const dims = roleColumns(mapping, 'dims'), wcol = roleColumn(mapping, 'weight')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const ps = useMemo(() => {
    const di = dims.map((d) => columnIndex(table, d)), wi = columnIndex(table, wcol)
    if (di.length < 2 || di.some((i) => i < 0)) return null
    const rows = table.rows.map((r) => ({ cats: di.map((i) => toLabel(r[i]) || '(빈 값)'), w: wi >= 0 ? toNumber(r[wi]) ?? 0 : 1 })).filter((r) => r.w > 0)
    return rows.length ? parallelSets(rows, di.length, params.gap, Math.min(params.colorDim, di.length - 1)) : null
  }, [table, dims.join('|'), wcol, params.gap, params.colorDim]) // eslint-disable-line react-hooks/exhaustive-deps
  if (dims.length < 2) return <ChartMessage>Parallel Sets에는 범주형 열이 2개 이상 필요합니다.</ChartMessage>
  if (!ps) return <ChartMessage>양수 가중치가 있는 행이 없습니다.</ChartMessage>
  const m = compact ? { l: 6, r: 6, t: 6, b: 6 } : { l: 24, r: 24, t: 36, b: 20 }
  const w = width - m.l - m.r, h = height - m.t - m.b
  const barW = compact ? 6 : 14
  const xAt = (d: number) => (dims.length === 1 ? 0 : (d * (w - barW)) / (dims.length - 1))
  const cd = Math.min(params.colorDim, dims.length - 1)
  const color = categoryColor(ps.segments.filter((s) => s.dim === cd).map((s) => s.key))
  const colorOfRibbon = (r: (typeof ps.ribbons)[number]) => color(r.color)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Parallel Sets: 범주형 축 ${dims.length}개 사이의 흐름 리본 ${ps.ribbons.length}개`} onPointerLeave={hide}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ps.ribbons.map((r, i) => {
            const x0 = xAt(r.dim) + barW, x1 = xAt(r.dim + 1)
            const c = (x1 - x0) * (0.2 + 0.6 * params.curve) / 1
            const p = `M${x0},${r.ya0 * h} C${x0 + c},${r.ya0 * h} ${x1 - c},${r.yb0 * h} ${x1},${r.yb0 * h} L${x1},${r.yb1 * h} C${x1 - c},${r.yb1 * h} ${x0 + c},${r.ya1 * h} ${x0},${r.ya1 * h} Z`
            return <path key={i} d={p} fill={colorOfRibbon(r)} fillOpacity={params.opacity} stroke="#fff" strokeWidth={0.4} data-testid="ps-ribbon"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{dims[r.dim]}: {r.a}</b> → <b>{dims[r.dim + 1]}: {r.b}</b><br />가중치 {fmt(r.weight)} ({((r.weight / ps.total) * 100).toFixed(1)}%)</>) }} onPointerLeave={hide} />
          })}
          {ps.segments.map((s) => (
            <g key={`${s.dim}-${s.key}`}>
              <rect x={xAt(s.dim)} y={s.y0 * h} width={barW} height={Math.max(0.5, (s.y1 - s.y0) * h)} fill="#3b4752" data-testid="ps-segment"
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{dims[s.dim]}: {s.key}</b><br />합계 {fmt(s.total)} ({((s.total / ps.total) * 100).toFixed(1)}%)</>) }} onPointerLeave={hide} />
              {!compact && (s.y1 - s.y0) * h > 11 && <text x={s.dim === dims.length - 1 ? xAt(s.dim) - 5 : xAt(s.dim) + barW + 5} y={((s.y0 + s.y1) / 2) * h} dy="0.35em" textAnchor={s.dim === dims.length - 1 ? 'end' : 'start'} className="radar-level" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{s.key}</text>}
            </g>
          ))}
          {!compact && dims.map((d, i) => <text key={d} x={xAt(i) + barW / 2} y={-14} textAnchor="middle" className="radar-axis-label">{d}</text>)}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PSControls({ params, setParams, mapping }: ControlsProps<PSParams>) {
  const dims = roleColumns(mapping, 'dims')
  return (
    <ControlGroup title="리본">
      <Select label="색을 정하는 축" value={String(Math.min(params.colorDim, Math.max(0, dims.length - 1)))} onChange={(v) => setParams({ colorDim: Number(v) })} options={dims.map((d, i) => ({ value: String(i), label: d }))} testId="ctl-colordim" />
      <Slider label="범주 사이 간격" value={params.gap} min={0} max={0.06} step={0.005} onChange={(gap) => setParams({ gap })} format={(v) => `${(v * 100).toFixed(1)}%`} testId="ctl-gap" />
      <Slider label="리본 불투명도" value={params.opacity} min={0.15} max={0.95} step={0.05} onChange={(opacity) => setParams({ opacity })} format={(v) => v.toFixed(2)} />
      <Slider label="곡률" value={params.curve} min={0} max={1} step={0.05} onChange={(curve) => setParams({ curve })} format={(v) => v.toFixed(2)} />
      <Hint>축의 순서는 위 ‘범주형 축’ 선택 순서입니다. 축마다 범주를 크기순으로 쌓고, 리본의 두께는 두 범주를 모두 가진 레코드의 가중치입니다. 올루비얼과 달리 데이터의 시간 변화가 아니라 같은 레코드의 서로 다른 범주 속성을 잇습니다.</Hint>
    </ControlGroup>
  )
}

export const psModule: VizModule<PSParams> = {
  roles: [
    { key: 'dims', label: '범주형 축 (왼쪽 → 오른쪽)', type: 'category', required: true, multiple: { min: 2, max: 5 } },
    { key: 'weight', label: '가중치 (선택)', type: 'number', auto: true, prefer: '응답|수|건|인원' },
  ],
  datasets: ['survey-cats', 'survey', 'stage-flow'],
  defaultParams: { gap: 0.02, opacity: 0.55, colorDim: 0, curve: 0.5 },
  Chart: PSChart,
  Controls: PSControls,
  hint: '축 선택 순서를 바꾸면 리본 구조가 바뀝니다 · 리본에 올려 가중치 확인',
}

// ───────────────────────────── Word Cloud ─────────────────────────────

export interface CloudParams { minSize: number; maxSize: number; maxWords: number; minCount: number; rotate: boolean; stop: string; scheme: SequentialScheme; seed: number }

const parseStop = (s: string) => new Set(s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))

function useTexts(table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']) {
  const col = roleColumn(mapping, 'text')
  return useMemo(() => { const i = columnIndex(table, col); return i < 0 ? [] : table.rows.map((r) => toLabel(r[i])).filter(Boolean) }, [table, col])
}

function CloudChart({ table, mapping, params, width, height, compact }: ChartProps<CloudParams>) {
  const texts = useTexts(table, mapping)
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const freq = useMemo(() => wordFrequencies(texts, parseStop(params.stop)).filter((w) => w.count >= params.minCount).slice(0, params.maxWords), [texts, params.stop, params.minCount, params.maxWords])
  const layout = useMemo(() => (freq.length ? wordCloud(freq, width, height, { minSize: compact ? 7 : params.minSize, maxSize: compact ? 22 : params.maxSize, rotate: params.rotate, seed: params.seed }) : null), [freq, width, height, compact, params.minSize, params.maxSize, params.rotate, params.seed])
  if (!freq.length || !layout) return <ChartMessage>단어가 없습니다. 문장 열을 선택하거나 최소 빈도를 낮추세요.</ChartMessage>
  const ramp = schemes[params.scheme].interpolate
  const max = freq[0].count, min = freq[freq.length - 1].count
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Word Cloud: 단어 ${layout.placed.length}개, 가장 많은 단어 ‘${freq[0].word}’ ${freq[0].count}회`} onPointerLeave={hide}>
        <rect width={width} height={height} fill="#fff" />
        {layout.placed.map((p) => (
          <g key={p.word}>
          <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} fill="#f6f8f9" fillOpacity={compact ? 0 : 0.7} rx={3} />
          <text x={p.x} y={p.y} dy="0.34em" textAnchor="middle" fontSize={p.size} fontWeight={600} fill={ramp(0.25 + 0.7 * (max > min ? (p.count - min) / (max - min) : 1))}
            transform={p.rotated ? `rotate(-90 ${p.x} ${p.y})` : undefined} data-testid="cloud-word"
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{p.word}</b><br />{p.count}회 · 글자 크기 {p.size.toFixed(0)}px</>) }} onPointerLeave={hide}>{p.word}</text>
          </g>
        ))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && layout.skipped.length > 0 && <div className="chart-note">공간이 부족해 배치하지 못한 단어 {layout.skipped.length}개: 글자 크기나 단어 수를 줄여 보세요.</div>}
    </div>
  )
}

function CloudControls({ params, setParams }: ControlsProps<CloudParams>) {
  return (
    <>
      <ControlGroup title="단어">
        <Slider label="최대 단어 수" value={params.maxWords} min={10} max={150} onChange={(maxWords) => setParams({ maxWords })} testId="ctl-maxwords" />
        <Slider label="최소 빈도" value={params.minCount} min={1} max={10} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
        <div className="field"><label className="field-label" htmlFor="cloud-stop">제외할 단어 (쉼표·공백으로 구분)</label>
          <input id="cloud-stop" className="text-input" value={params.stop} onChange={(e) => setParams({ stop: e.target.value })} data-testid="ctl-stop" /></div>
      </ControlGroup>
      <ControlGroup title="모양">
        <Slider label="가장 작은 글자" value={params.minSize} min={8} max={24} onChange={(minSize) => setParams({ minSize })} testId="ctl-minsize" />
        <Slider label="가장 큰 글자" value={params.maxSize} min={24} max={96} onChange={(maxSize) => setParams({ maxSize })} testId="ctl-maxsize" />
        <Toggle label="일부 단어 세로 배치" checked={params.rotate} onChange={(rotate) => setParams({ rotate })} testId="ctl-rotate" />
        <Slider label="배치 시드" value={params.seed} min={1} max={30} onChange={(seed) => setParams({ seed })} />
        <Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={paletteOptions} />
        <Hint>글자 크기는 √빈도에 비례합니다. 가장 큰 단어부터 중앙에서 나선을 따라 겹치지 않는 자리를 찾습니다. 문장은 ‘데이터’ 탭에서 직접 고칠 수 있습니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const cloudModule: VizModule<CloudParams> = {
  roles: [{ key: 'text', label: '문장 (텍스트 열)', type: 'category', required: true, prefer: '문장|text' }],
  datasets: ['text-corpus'],
  defaultParams: { minSize: 13, maxSize: 54, maxWords: 70, minCount: 1, rotate: false, stop: '', scheme: 'viridis', seed: 3 },
  Chart: CloudChart,
  Controls: CloudControls,
  hint: '문장을 고치거나 제외 단어를 입력하면 단어 크기와 배치가 다시 계산됩니다',
}

// ───────────────────────────── Word Tree ─────────────────────────────

export interface WordTreeParams { root: string; depth: number; minCount: number; stop: string }

function WordTreeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<WordTreeParams>) {
  const texts = useTexts(table, mapping)
  const stop = useMemo(() => parseStop(params.stop), [params.stop])
  const freq = useMemo(() => wordFrequencies(texts, stop), [texts, stop])
  const root = params.root && freq.some((f) => f.word === params.root) ? params.root : freq[0]?.word ?? ''
  const t = useMemo(() => (root ? wordTree(texts, root, compact ? 2 : params.depth, params.minCount, stop) : null), [texts, root, params.depth, params.minCount, stop, compact])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  if (!t || !t.occurrences) return <ChartMessage>선택한 단어가 문장에 없습니다.</ChartMessage>
  const half = width / 2
  const m = compact ? 6 : 24
  const levelW = Math.max(50, (half - m - 40) / Math.max(1, compact ? 2 : params.depth))
  const layoutSide = (side: WordNode, dir: 1 | -1) => {
    const h = d3.hierarchy(side, (d) => d.children)
    const leaves = h.leaves().length
    const rowH = Math.max(compact ? 8 : 15, (height - m * 2) / Math.max(1, leaves))
    d3.tree<WordNode>().size([Math.min(height - m * 2, rowH * leaves), levelW * Math.max(1, h.height)])(h)
    const offY = (height - Math.min(height - m * 2, rowH * leaves)) / 2
    return h.descendants().map((n) => ({ n, x: half + dir * (n.y as number), y: (n.x as number) + offY, parent: n.parent ? { x: half + dir * (n.parent.y as number), y: (n.parent.x as number) + offY } : null }))
  }
  const right = layoutSide(t.right, 1), left = layoutSide(t.left, -1)
  const fs = (c: number) => Math.max(compact ? 6 : 10, Math.min(compact ? 12 : 22, (compact ? 6 : 10) + Math.sqrt(c / t.occurrences) * (compact ? 6 : 12)))
  const draw = (nodes: typeof right, dir: 1 | -1) => nodes.map(({ n, x, y, parent }, i) => (
    <g key={`${dir}-${i}`}>
      {parent && <path d={`M${parent.x},${parent.y} C${(parent.x + x) / 2},${parent.y} ${(parent.x + x) / 2},${y} ${x},${y}`} fill="none" stroke="#c3cad1" strokeWidth={Math.max(0.8, 6 * (n.data.count / t.occurrences))} />}
      {n.depth > 0 && <text x={x + dir * 4} y={y} dy="0.34em" textAnchor={dir === 1 ? 'start' : 'end'} fontSize={fs(n.data.count)} fill="#111" data-testid="wt-word"
        onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.data.word}</b><br />{n.data.count}개 문장</>) }} onPointerLeave={hide}>{n.data.word}</text>}
    </g>
  ))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Word Tree: ‘${root}’가 나오는 문장 ${t.occurrences}개의 앞뒤 문맥`} onPointerLeave={hide}>
        {draw(left, -1)}
        {draw(right, 1)}
        <text x={half} y={height / 2} textAnchor="middle" dy="0.34em" fontSize={compact ? 12 : 20} fontWeight={700} fill={ACCENT} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 5 }} data-testid="wt-root">{root}</text>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
      {!compact && <div className="chart-note">‘{root}’가 {t.occurrences}번 나옵니다. 가운데에서 오른쪽은 뒤따르는 단어, 왼쪽은 앞선 단어입니다. {freq.slice(0, 6).map((f) => <button key={f.word} type="button" className="link-btn" onClick={() => setParams({ root: f.word })}>{f.word}</button>)}</div>}
    </div>
  )
}

function WordTreeControls({ params, setParams, table, mapping }: ControlsProps<WordTreeParams>) {
  const col = roleColumn(mapping, 'text')
  const words = useMemo(() => { const i = columnIndex(table, col); return wordFrequencies(i < 0 ? [] : table.rows.map((r) => toLabel(r[i])), parseStop(params.stop)).slice(0, 40) }, [table, col, params.stop])
  return (
    <ControlGroup title="단어 트리">
      <Select label="기준 단어" value={params.root || words[0]?.word || ''} onChange={(root) => setParams({ root })} options={words.map((w) => ({ value: w.word, label: `${w.word} (${w.count})` }))} testId="ctl-root" />
      <Slider label="앞뒤 단어 깊이" value={params.depth} min={1} max={6} onChange={(depth) => setParams({ depth })} testId="ctl-depth" />
      <Slider label="가지의 최소 문장 수" value={params.minCount} min={1} max={5} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
      <div className="field"><label className="field-label" htmlFor="wt-stop">제외할 단어</label><input id="wt-stop" className="text-input" value={params.stop} onChange={(e) => setParams({ stop: e.target.value })} /></div>
      <Hint>기준 단어가 들어 있는 모든 문장을 그 단어에서 정렬하고, 같은 단어열로 이어지는 문장을 하나의 가지로 합칩니다. 두께는 지나가는 문장 수입니다.</Hint>
    </ControlGroup>
  )
}

export const wordTreeModule: VizModule<WordTreeParams> = {
  roles: [{ key: 'text', label: '문장 (텍스트 열)', type: 'category', required: true }],
  datasets: ['text-corpus'],
  defaultParams: { root: '', depth: 3, minCount: 1, stop: '' },
  Chart: WordTreeChart,
  Controls: WordTreeControls,
  hint: '기준 단어를 바꿔 문맥의 가지를 비교 · 아래 단어를 눌러도 바뀝니다',
}

// ───────────────────────────── Space-filling curve pixel visualization ─────────────────────────────

export interface CurveParams { curve: CurveKind; sort: 'none' | 'asc' | 'desc'; scheme: SequentialScheme; trace: boolean }
const CURVE_CAP = 4096

function CurveChart({ table, mapping, params, width, height, compact }: ChartProps<CurveParams>) {
  const vcol = roleColumn(mapping, 'value')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const data = useMemo(() => {
    const i = columnIndex(table, vcol)
    if (i < 0) return null
    let v = table.rows.map((r, row) => ({ row, v: toNumber(r[i]) })).filter((x): x is { row: number; v: number } => x.v != null)
    if (v.length > CURVE_CAP) { const step = v.length / CURVE_CAP; v = Array.from({ length: CURVE_CAP }, (_, k) => v[Math.floor(k * step)]) }
    if (params.sort !== 'none') v = [...v].sort((a, b) => (params.sort === 'asc' ? a.v - b.v : b.v - a.v))
    return v
  }, [table, vcol, params.sort])
  if (!data || data.length < 2) return <ChartMessage>값이 2개 이상 필요합니다.</ChartMessage>
  const side = curveSide(data.length, params.curve)
  const m = compact ? 4 : 28
  const px = Math.max(1, Math.floor(Math.min(width - 2 * m, height - 2 * m) / side * 10) / 10)
  const [lo, hi] = d3.extent(data, (d) => d.v) as [number, number]
  const ramp = schemes[params.scheme].interpolate
  const ox = (width - px * side) / 2, oy = (height - px * side) / 2
  const cells = data.map((d, k) => ({ ...d, k, c: curveCell(params.curve, side, k) }))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Space-Filling Curve Pixel Visualization: ${data.length}개 레코드를 ${params.curve} 곡선 순서로 ${side}×${side} 격자에 배치`} onPointerLeave={hide}>
        <g transform={`translate(${ox},${oy})`}>
          <rect width={px * side} height={px * side} fill="#fafbfc" stroke="#d6dbe0" />
          {cells.map((d) => (
            <rect key={d.k} x={d.c[0] * px} y={d.c[1] * px} width={px} height={px} fill={ramp(hi > lo ? (d.v - lo) / (hi - lo) : 0.5)} data-testid="curve-pixel"
              onPointerEnter={compact || px < 3 ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>순서 {d.k + 1}번 (행 {d.row + 1})</b><br />값 {fmt(d.v)}</>) }} onPointerLeave={hide} />
          ))}
          {params.trace && !compact && px >= 4 && <path d={d3.line<(typeof cells)[number]>().x((d) => (d.c[0] + 0.5) * px).y((d) => (d.c[1] + 0.5) * px)(cells.slice(0, 600)) ?? ''} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1} />}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CurveControls({ params, setParams }: ControlsProps<CurveParams>) {
  return (
    <>
      <ControlGroup title="곡선과 순서">
        <Segmented label="곡선" value={params.curve} onChange={(curve) => setParams({ curve })} options={[{ value: 'hilbert', label: 'Hilbert' }, { value: 'zorder', label: 'Z-order' }, { value: 'snake', label: '뱀 모양' }, { value: 'row', label: '행 순서' }]} testId="ctl-curve" />
        <Segmented label="데이터 순서" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'none', label: '원래 순서' }, { value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }]} testId="ctl-sort" />
        <Toggle label="곡선 경로 표시 (앞 600개)" checked={params.trace} onChange={(trace) => setParams({ trace })} />
        <Hint>Hilbert 곡선은 데이터 순서에서 가까운 레코드가 2차원에서도 가깝게 놓이도록 하는 공간충전곡선입니다. 행 순서는 줄바꿈 경계에서 이웃이 멀어지지만 Hilbert는 그렇지 않아 구간별 패턴이 덩어리로 보입니다. 최대 4,096개까지 표시합니다.</Hint>
      </ControlGroup>
      <ControlGroup title="색"><Select label="색 구성" value={params.scheme} onChange={(scheme) => setParams({ scheme })} options={paletteOptions} /></ControlGroup>
    </>
  )
}

export const curveModule: VizModule<CurveParams> = {
  roles: [{ key: 'value', label: '값 (색)', type: 'number', required: true }],
  datasets: ['daily', 'sensors', 'normal'],
  defaultParams: { curve: 'hilbert', sort: 'none', scheme: 'viridis', trace: false },
  Chart: CurveChart,
  Controls: CurveControls,
  hint: '곡선 종류를 바꿔 같은 데이터가 어떻게 다른 덩어리로 보이는지 비교',
}

// ───────────────────────────── Voronoi Treemap ─────────────────────────────

export interface VTParams { depth: number; iters: number; labels: boolean }

function VTChart({ table, mapping, params, width, height, compact }: ChartProps<VTParams>) {
  const levels = roleColumns(mapping, 'levels'), vcol = roleColumn(mapping, 'value')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const m = compact ? 4 : 10
  const poly = useMemo<P2[]>(() => {
    // a regular polygon (convex) inscribed in the frame: the Voronoi treemap needs a convex outer boundary
    const cx = width / 2, cy = height / 2, rx = width / 2 - m, ry = height / 2 - m
    return Array.from({ length: 36 }, (_, k) => [cx + Math.cos((k / 36) * Math.PI * 2) * rx, cy + Math.sin((k / 36) * Math.PI * 2) * ry] as P2)
  }, [width, height, m])
  const result = useMemo(() => {
    if (!levels.length) return null
    const { tree } = buildTree(table, levels, vcol)
    if (!tree.children?.length) return null
    const total = (n: typeof tree): number => (n.children?.length ? n.children.reduce((s, c) => s + total(c), 0) : n.value ?? 0)
    return { tree, cells: voronoiTreemap(tree, poly, Math.min(params.depth, levels.length), compact ? 40 : params.iters), total: total(tree) }
  }, [table, levels.join('|'), vcol, poly, params.depth, params.iters, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!result) return <ChartMessage>계층 열과 양수 값 열이 필요합니다.</ChartMessage>
  const top = result.tree.children!.map((c) => c.name)
  const color = categoryColor(top)
  const topName = (cell: (typeof result.cells)[number]) => {
    // a cell belongs to the top-level group whose polygon contains its centroid
    const cx = d3.mean(cell.polygon, (p) => p[0])!, cy = d3.mean(cell.polygon, (p) => p[1])!
    const tops = result.cells.filter((c) => c.depth === 1)
    return tops.find((t) => d3.polygonContains(t.polygon, [cx, cy]))?.node.name ?? top[0]
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Voronoi Treemap: ${result.cells.filter((c) => c.leaf).length}개 잎 항목을 면적이 값에 비례하는 보로노이 셀로 분할`} onPointerLeave={hide}>
        {[...result.cells].sort((a, b) => a.depth - b.depth).map((c, i) => {
          const t = topName(c)
          const cx = d3.mean(c.polygon, (p) => p[0])!, cy = d3.mean(c.polygon, (p) => p[1])!
          const area = Math.abs(d3.polygonArea(c.polygon))
          return (
            <g key={i}>
              <path d={`M${c.polygon.map((p) => p.join(',')).join('L')}Z`} fill={c.leaf ? d3.color(color(t))!.brighter(c.depth * 0.18 - 0.1).formatHex() : 'none'} fillOpacity={c.leaf ? 0.82 : 0} stroke="#fff" strokeWidth={c.depth === 1 ? 3 : 1.2} data-testid={c.leaf ? 'vt-leaf' : 'vt-group'}
                onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{c.node.name}</b><br />값 {fmt(c.value)} ({((c.value / result.total) * 100).toFixed(1)}%)<br />셀 면적 {((area / Math.abs(d3.polygonArea(poly))) * 100).toFixed(1)}%</>) }} onPointerLeave={hide} />
              {!compact && params.labels && c.leaf && area > 1800 && <text x={cx} y={cy} textAnchor="middle" dy="0.34em" className="radar-level" fill="#111" style={{ pointerEvents: 'none' }}>{c.node.name}</text>}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function VTControls({ params, setParams }: ControlsProps<VTParams>) {
  return (
    <ControlGroup title="계산">
      <Slider label="표시 계층 깊이" value={params.depth} min={1} max={3} onChange={(depth) => setParams({ depth })} testId="ctl-depth" />
      <Slider label="면적 맞춤 반복 횟수" value={params.iters} min={20} max={300} step={10} onChange={(iters) => setParams({ iters })} testId="ctl-iters" />
      <Toggle label="항목 이름" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>직사각형 대신 보로노이(파워 다이어그램) 셀로 나눕니다. 셀 위치와 가중치를 반복 조정해 면적이 값에 가까워지게 하고, 각 셀 안에서 하위 계층을 같은 방식으로 다시 나눕니다. 값이 달라지면 셀의 모양까지 새로 계산됩니다.</Hint>
    </ControlGroup>
  )
}

export const vtModule: VizModule<VTParams> = {
  roles: [
    { key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 3 } },
    { key: 'value', label: '값 (면적)', type: 'number', required: true },
  ],
  datasets: ['budget', 'categorical'],
  defaultParams: { depth: 2, iters: 150, labels: true },
  Chart: VTChart,
  Controls: VTControls,
  hint: '값을 고치면 셀 면적이 다시 계산됩니다 · 셀에 올려 값과 면적 비율 확인',
}

// ───────────────────────────── Tanglegram ─────────────────────────────

export interface TangleParams { left: Linkage; right: Linkage; untangle: boolean; standardize: boolean }

const linkageOptions = [{ value: 'single', label: '단일' }, { value: 'complete', label: '완전' }, { value: 'average', label: '평균' }, { value: 'ward', label: 'Ward' }] as { value: Linkage; label: string }[]

function TangleChart({ table, mapping, params, width, height, compact }: ChartProps<TangleParams>) {
  const vars = roleColumns(mapping, 'vars'), lcol = roleColumn(mapping, 'label')
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const trees = useMemo(() => {
    const vi = vars.map((v) => columnIndex(table, v)), li = columnIndex(table, lcol)
    const rows: { label: string; v: number[] }[] = []
    table.rows.forEach((r, i) => { const v = vi.map((k) => toNumber(r[k])); if (v.every((x) => x != null)) rows.push({ label: li >= 0 ? toLabel(r[li]) || `행 ${i + 1}` : `행 ${i + 1}`, v: v as number[] }) })
    const used = rows.slice(0, 60)
    if (used.length < 3 || vars.length < 2) return null
    const pts = params.standardize ? standardizeColumns(used.map((r) => r.v)) : used.map((r) => r.v)
    const labels = used.map((r) => r.label)
    const a = linkageTree(hclust(pts, 'euclidean', params.left), labels), b = linkageTree(hclust(pts, 'euclidean', params.right), labels)
    return { labels, a, b, ...(params.untangle ? untangle(a, b) : { before: tangleCrossings(leafOrder(a), leafOrder(b)), after: tangleCrossings(leafOrder(a), leafOrder(b)) }) }
  }, [table, vars.join('|'), lcol, params.left, params.right, params.untangle, params.standardize]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!trees) return <ChartMessage>Tanglegram에는 숫자형 변수 2개 이상과 3개 이상의 행이 필요합니다.</ChartMessage>
  const A = params.untangle ? (trees as unknown as { a: typeof trees.a }).a : trees.a
  const B = params.untangle ? (trees as unknown as { b: typeof trees.b }).b : trees.b
  const orderA = leafOrder(A), orderB = leafOrder(B)
  const n = orderA.length
  const labelW = compact ? 0 : 90
  const m = compact ? 6 : 24
  const treeW = (width - 2 * m - 2 * labelW) / 2 * 0.55
  const rowH = (height - 2 * m) / n
  const yOf = (order: number[]) => new Map(order.map((id, i) => [id, m + (i + 0.5) * rowH]))
  const yA = yOf(orderA), yB = yOf(orderB)
  const hMaxA = A.height || 1, hMaxB = B.height || 1
  type Placed = { id: number; x: number; y: number; kids?: Placed[] }
  const place = (t: typeof A, side: 'L' | 'R', hMax: number, yMap: Map<number, number>): Placed => {
    const x0 = side === 'L' ? m : width - m
    const dir = side === 'L' ? 1 : -1
    const rec = (nd: typeof A): Placed => {
      if (!nd.children?.length) return { id: nd.id, x: x0 + dir * treeW, y: yMap.get(nd.id)! }
      const kids = nd.children.map(rec)
      return { id: nd.id, x: x0 + dir * treeW * (1 - nd.height / hMax), y: d3.mean(kids, (k) => k.y)!, kids }
    }
    return rec(t)
  }
  const pa = place(A, 'L', hMaxA, yA), pb = place(B, 'R', hMaxB, yB)
  const links = (p: Placed): string[] => (p.kids ? p.kids.flatMap((k) => [`M${p.x},${p.y}V${k.y}H${k.x}`, ...links(k)]) : [])
  const lab = new Map(trees.labels.map((l, i) => [i, l]))
  const color = categoryColor(trees.labels)
  const xLeaf = m + treeW, xLeafR = width - m - treeW
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Tanglegram: 같은 ${n}개 개체를 두 군집화 트리로 마주 놓고 대응 잎을 연결, 교차 ${trees.after}회`} onPointerLeave={hide}>
        <path d={links(pa).join('')} fill="none" stroke="#6b7280" strokeWidth={1.2} />
        <path d={links(pb).join('')} fill="none" stroke="#6b7280" strokeWidth={1.2} />
        {orderA.map((id) => (
          <g key={id}>
            <path d={`M${xLeaf},${yA.get(id)}C${xLeaf + (xLeafR - xLeaf) * 0.4},${yA.get(id)} ${xLeafR - (xLeafR - xLeaf) * 0.4},${yB.get(id)} ${xLeafR},${yB.get(id)}`} fill="none" stroke={color(lab.get(id)!)} strokeOpacity={0.8} strokeWidth={compact ? 1 : 1.6} data-testid="tangle-link"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <b>{lab.get(id)}</b>) }} onPointerLeave={hide} />
            {!compact && <text x={xLeaf + 4} y={yA.get(id)} dy="0.34em" className="radar-level" style={{ display: 'none' }}>{lab.get(id)}</text>}
          </g>
        ))}
        {!compact && orderA.map((id) => <text key={`a${id}`} x={xLeaf + 6} y={yA.get(id)} dy="0.34em" className="radar-level" fill="#111" style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{lab.get(id)}</text>)}
        {!compact && orderB.map((id) => <text key={`b${id}`} x={xLeafR - 6} y={yB.get(id)} dy="0.34em" textAnchor="end" className="radar-level" fill="#111" style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{lab.get(id)}</text>)}
        {!compact && <text x={width / 2} y={16} textAnchor="middle" className="radar-axis-label" data-testid="tangle-readout">교차 {trees.after}회{params.untangle ? ` (정렬 전 ${trees.before}회)` : ''} · 왼쪽 {params.left} / 오른쪽 {params.right} 연결법</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TangleControls({ params, setParams }: ControlsProps<TangleParams>) {
  return (
    <ControlGroup title="두 트리">
      <Segmented label="왼쪽 연결법" value={params.left} onChange={(left) => setParams({ left })} options={linkageOptions} testId="ctl-left" />
      <Segmented label="오른쪽 연결법" value={params.right} onChange={(right) => setParams({ right })} options={linkageOptions} testId="ctl-right" />
      <Toggle label="교차가 줄도록 가지 순서 정렬" checked={params.untangle} onChange={(u) => setParams({ untangle: u })} testId="ctl-untangle" />
      <Toggle label="변수 표준화" checked={params.standardize} onChange={(standardize) => setParams({ standardize })} />
      <Hint>같은 개체를 서로 다른 방법으로 군집화한 두 트리를 마주 놓고 같은 개체끼리 선으로 잇습니다. 선이 많이 엇갈릴수록 두 군집 구조가 다릅니다. 정렬은 가지의 좌우만 뒤집어(군집 구성은 그대로) 교차를 줄입니다. 최대 60개 개체를 비교합니다.</Hint>
    </ControlGroup>
  )
}

export const tangleModule: VizModule<TangleParams> = {
  roles: [
    { key: 'label', label: '개체 이름', type: 'category', auto: true },
    { key: 'vars', label: '변수 (숫자형)', type: 'number', required: true, multiple: { min: 2, max: 10 } },
  ],
  datasets: ['cars', 'flowers'],
  defaultParams: { left: 'average', right: 'ward', untangle: true, standardize: true },
  Chart: TangleChart,
  Controls: TangleControls,
  hint: '두 연결법의 트리를 비교 · 가지 정렬을 끄면 원래 순서의 교차를 볼 수 있습니다',
}
