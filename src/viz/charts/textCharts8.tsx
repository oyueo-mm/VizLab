import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { arcPoint, parallelTags, phraseNet, phrasePatterns, textArc } from '../../stats/text8'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, RoleSpec, VizModule } from '../types'

const textRole: RoleSpec = { key: 'text', label: '문장 (텍스트 열)', type: 'category', required: true, prefer: '문장|text' }
const sentences = (table: ChartProps<unknown>['table'], mapping: ChartProps<unknown>['mapping']) => {
  const i = columnIndex(table, roleColumn(mapping, 'text'))
  return i < 0 ? [] : table.rows.map((r) => toLabel(r[i]).trim()).filter(Boolean)
}

// ───────────────────────────── TextArc ─────────────────────────────

export interface TextArcParams { minCount: number; maxWords: number; relax: number; rays: boolean }

function TextArcChart({ table, mapping, params, width, height, compact }: ChartProps<TextArcParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState('')
  const S = useMemo(() => sentences(table, mapping), [table, mapping])
  const words = useMemo(() => textArc(S, { minCount: params.minCount, maxWords: params.maxWords, relax: params.relax }), [S, params.minCount, params.maxWords, params.relax])
  if (S.length < 2) return <ChartMessage>문장이 두 개 이상 있는 텍스트 열을 선택하세요.</ChartMessage>
  const R = Math.max(60, Math.min(width, height) / 2 - (compact ? 8 : 30))
  const cx = width / 2, cy = height / 2
  const P = (p: [number, number]): [number, number] => [cx + p[0] * R, cy + p[1] * R]
  const maxC = Math.max(1, ...words.map((w) => w.count))
  const active = words.find((w) => w.word === hover)
  const onRing = new Set(active?.occ ?? [])
  const size = (c: number) => (compact ? 6 : 9) + (compact ? 6 : 15) * Math.sqrt(c / maxC)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={() => { hide(); setHover('') }}
        aria-label={`TextArc: 문장 ${S.length}개를 원 둘레에 순서대로 놓고 ${words.length}개 단어를 등장 위치의 평균에 배치`}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#e1e5e9" />
        {S.map((s, i) => {
          const a = P(arcPoint(i, S.length)), b = P([arcPoint(i, S.length)[0] * 1.04, arcPoint(i, S.length)[1] * 1.04])
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={onRing.has(i) ? '#d4452f' : '#9aa3ad'} strokeWidth={onRing.has(i) ? 2.4 : 1} data-testid="textarc-tick"
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>문장 {i + 1}</b><br />{s}</>) }} onPointerLeave={hide} />
        })}
        {active && params.rays && active.occ.map((i) => { const a = P([active.x, active.y]), b = P(arcPoint(i, S.length)); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#d4452f" strokeWidth={0.8} opacity={0.6} data-testid="textarc-ray" /> })}
        {words.map((w) => {
          const [x, y] = P([w.x, w.y])
          const hot = w.word === hover
          return (
            <text key={w.word} x={x} y={y} textAnchor="middle" dy="0.34em" fontSize={size(w.count)} fill={hot ? '#d4452f' : '#2f3a45'} fontWeight={hot ? 700 : 400} opacity={hover && !hot ? 0.45 : 1} data-testid="textarc-word" style={{ cursor: compact ? undefined : 'pointer' }}
              onPointerEnter={compact ? undefined : (e) => { setHover(w.word); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{w.word}</b> · {w.count}개 문장<br />문장 {w.occ.map((i) => i + 1).join(', ')}</>) }} onPointerLeave={() => { hide(); setHover('') }}>{w.word}</text>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TextArcControls({ params, setParams }: ControlsProps<TextArcParams>) {
  return (
    <ControlGroup title="단어 배치">
      <Slider label="표시할 최소 등장 문장 수" value={params.minCount} min={1} max={6} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
      <Slider label="단어 수 상한" value={params.maxWords} min={10} max={120} step={5} onChange={(maxWords) => setParams({ maxWords })} testId="ctl-maxwords" />
      <Slider label="겹침 완화 반복 (0 = 정확한 평균 위치)" value={params.relax} min={0} max={80} step={5} onChange={(relax) => setParams({ relax })} testId="ctl-relax" />
      <Toggle label="단어에서 등장 문장으로 선 긋기" checked={params.rays} onChange={(rays) => setParams({ rays })} testId="ctl-rays" />
      <Hint>문장이 읽는 순서대로 원 둘레에 놓이고(12시 방향에서 시계 방향), 단어는 그 단어가 나오는 문장들의 위치의 평균 지점에 놓입니다. 글 전체에 고루 나오는 단어는 중앙, 한 부분에 몰린 단어는 그 부분 쪽에 놓이며 글자 크기는 등장 문장 수에 비례합니다. 단어에 올리면 등장 문장으로 선이 이어집니다. 원 논문은 둘레에 문장 글자 자체를 그리지만 여기서는 문장을 눈금으로 표시하고 올려서 읽습니다. 한국어 조사는 한 글자만 떼는 단순한 규칙입니다.</Hint>
    </ControlGroup>
  )
}

export const textArcModule: VizModule<TextArcParams> = {
  roles: [textRole],
  datasets: ['corpus-articles', 'text-corpus'],
  defaultParams: { minCount: 2, maxWords: 60, relax: 40, rays: true },
  Chart: TextArcChart,
  Controls: TextArcControls,
  hint: '단어에 올려 등장하는 문장 위치 확인 · 문장 눈금에 올려 내용 읽기',
}

// ───────────────────────────── Parallel Tag Clouds ─────────────────────────────

export interface ParallelTagParams { top: number; metric: 'count' | 'distinct'; links: boolean }

function ParallelTagChart({ table, mapping, params, width, height, compact }: ChartProps<ParallelTagParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState('')
  const groups = useMemo(() => {
    const gi = columnIndex(table, roleColumn(mapping, 'group')), ti = columnIndex(table, roleColumn(mapping, 'text'))
    if (gi < 0 || ti < 0) return []
    const m = new Map<string, string[]>()
    for (const r of table.rows) { const g = toLabel(r[gi]).trim(), t = toLabel(r[ti]).trim(); if (g && t) m.set(g, [...(m.get(g) ?? []), t]) }
    return [...m.entries()].map(([name, texts]) => ({ name, texts }))
  }, [table, mapping])
  const result = useMemo(() => parallelTags(groups, { top: compact ? 8 : params.top, metric: params.metric }), [groups, params.top, params.metric, compact])
  if (groups.length < 2) return <ChartMessage>문서(범주) 열과 문장 열을 선택하세요. 두 문서 이상이 필요합니다.</ChartMessage>
  const color = categoryColor(groups.map((g) => g.name))
  const m = compact ? { l: 4, r: 4, t: 14, b: 4 } : { l: 20, r: 20, t: 38, b: 14 }
  const colW = (width - m.l - m.r) / groups.length
  const maxScore = Math.max(...result.columns.flatMap((c) => c.words.map((w) => w.score)), 1e-9)
  const fs = (s: number) => (compact ? 7 : 11) + (compact ? 7 : 20) * Math.sqrt(s / maxScore)
  // vertical centre of every word: stacked from the top with a line height of 1.18 × size, every column scaled to fit the height
  const place = result.columns.map((c) => {
    const heights = c.words.map((w) => fs(w.score) * 1.18)
    const total = heights.reduce((a, b) => a + b, 0)
    const k = Math.min(1, (height - m.t - m.b) / Math.max(1, total))
    let y = m.t
    return c.words.map((w, i) => { const h = heights[i] * k; const cy = y + h / 2; y += h; return { w, cy, size: fs(w.score) * k } })
  })
  const cxOf = (c: number) => m.l + (c + 0.5) * colW
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={() => { hide(); setHover('') }}
        aria-label={`Parallel Tag Clouds: 문서 ${groups.length}개의 단어를 열마다 순위대로 쌓고 같은 단어를 선으로 연결`}>
        {result.columns.map((c, k) => <g key={c.name}>{!compact && <text x={cxOf(k)} y={20} textAnchor="middle" className="radar-axis-label" fill={color(c.name)}>{c.name}</text>}<line x1={cxOf(k) - colW / 2 + 8} x2={cxOf(k) + colW / 2 - 8} y1={m.t - 8} y2={m.t - 8} stroke={color(c.name)} strokeWidth={compact ? 1 : 2} /><rect x={cxOf(k) - colW / 2 + 3} y={m.t - 4} width={colW - 6} height={height - m.t - m.b + 8} rx={4} fill={color(c.name)} fillOpacity={0.05} /></g>)}
        {params.links && !compact && result.links.map((l, k) => {
          const a = place[l.col][l.a], b = place[l.col + 1][l.b]
          const wa = a.w.word.length * a.size * 0.5, wb = b.w.word.length * b.size * 0.5
          const hot = hover === l.word
          return <path key={k} d={`M${cxOf(l.col) + wa},${a.cy}C${(cxOf(l.col) + cxOf(l.col + 1)) / 2},${a.cy} ${(cxOf(l.col) + cxOf(l.col + 1)) / 2},${b.cy} ${cxOf(l.col + 1) - wb},${b.cy}`} fill="none" stroke={hot ? '#d4452f' : '#9aa3ad'} strokeWidth={hot ? 1.8 : 0.8} opacity={hover && !hot ? 0.1 : 0.55} data-testid="tag-link" />
        })}
        {place.map((col, k) => col.map(({ w, cy, size }) => {
          const hot = hover === w.word
          return (
            <text key={`${k}-${w.word}`} x={cxOf(k)} y={cy} textAnchor="middle" dy="0.34em" fontSize={size} fill={hot ? '#d4452f' : color(groups[k].name)} fontWeight={hot ? 700 : 500} opacity={hover && !hot ? 0.35 : 1} data-testid="tag-word" style={{ cursor: compact ? undefined : 'pointer' }}
              onPointerEnter={compact ? undefined : (e) => { setHover(w.word); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{w.word}</b> ({groups[k].name})<br />빈도 {w.count} · 점수 {w.score.toFixed(2)}</>) }} onPointerLeave={() => { hide(); setHover('') }}>{w.word}</text>
          )
        }))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function ParallelTagControls({ params, setParams }: ControlsProps<ParallelTagParams>) {
  return (
    <ControlGroup title="단어 선정">
      <Segmented label="순위·크기의 기준" value={params.metric} onChange={(metric) => setParams({ metric })} options={[{ value: 'count', label: '빈도' }, { value: 'distinct', label: '문서 고유도 (TF-IDF식)' }]} testId="ctl-metric" />
      <Slider label="열마다 표시할 단어 수" value={params.top} min={5} max={24} onChange={(top) => setParams({ top })} testId="ctl-top" />
      <Toggle label="같은 단어를 이웃 열 사이에서 선으로 연결" checked={params.links} onChange={(links) => setParams({ links })} testId="ctl-links" />
      <Hint>문서(범주)마다 한 열이고, 열 안에서 점수가 높은 단어가 위에 쌓이며 글자 크기도 점수에 비례합니다. 이웃한 열에 같은 단어가 있으면 선으로 이어 그 단어의 순위가 문서마다 어떻게 달라지는지 보입니다. ‘문서 고유도’는 빈도에 그 단어가 적은 문서에만 나오는 정도를 곱해 한 문서를 특징짓는 단어가 위로 오게 합니다. 단어 구름과 달리 위치에 순위의 의미가 있고 열끼리 비교됩니다. 단어를 가리키면 모든 열에서 같은 단어가 강조됩니다.</Hint>
    </ControlGroup>
  )
}

export const parallelTagModule: VizModule<ParallelTagParams> = {
  roles: [{ key: 'group', label: '문서 (범주)', type: 'category', required: true, prefer: '문서|doc' }, { ...textRole }],
  datasets: ['corpus-articles'],
  defaultParams: { top: 12, metric: 'distinct', links: true },
  Chart: ParallelTagChart,
  Controls: ParallelTagControls,
  hint: '단어에 올려 모든 문서에서 같은 단어를 강조 · 빈도와 문서 고유도 비교',
}

// ───────────────────────────── Phrase Net ─────────────────────────────

export interface PhraseParams { pattern: string; minCount: number; arrows: boolean }

function PhraseChart({ table, mapping, params, width, height, compact }: ChartProps<PhraseParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState('')
  const S = useMemo(() => sentences(table, mapping), [table, mapping])
  const net = useMemo(() => phraseNet(S, params.pattern, { minCount: params.minCount }), [S, params.pattern, params.minCount])
  const pos = useMemo(() => {
    const nodes = net.nodes.map((n, i) => ({ id: n.word, count: n.count, x: width / 2 + Math.cos(i * 2.4) * (16 + 9 * Math.sqrt(i)), y: height / 2 + Math.sin(i * 2.4) * (16 + 9 * Math.sqrt(i)) }))
    if (!nodes.length) return new Map<string, { x: number; y: number }>()
    const links = net.edges.map((e) => ({ source: e.a, target: e.b, count: e.count }))
    const maxC = Math.max(...nodes.map((n) => n.count))
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<(typeof nodes)[number], (typeof links)[number]>(links).id((d) => d.id).distance(70).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-160))
      .force('collide', d3.forceCollide<(typeof nodes)[number]>().radius((d) => 22 + 14 * Math.sqrt(d.count / maxC)))
      .force('x', d3.forceX(width / 2).strength(0.06)).force('y', d3.forceY(height / 2).strength(0.08)).stop()
    for (let t = 0; t < 260; t++) { sim.tick(); for (const n of nodes) { n.x = Math.max(30, Math.min(width - 30, n.x)); n.y = Math.max(20, Math.min(height - 20, n.y)) } }
    return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  }, [net, width, height])
  if (S.length < 2) return <ChartMessage>문장이 두 개 이상 있는 텍스트 열을 선택하세요.</ChartMessage>
  if (!net.edges.length) return <ChartMessage>이 패턴({phrasePatterns.find((p) => p.id === params.pattern)?.label})에 맞는 쌍이 없습니다. 최소 횟수를 낮추거나 다른 패턴을 고르세요.</ChartMessage>
  const maxC = Math.max(...net.nodes.map((n) => n.count)), maxE = Math.max(...net.edges.map((e) => e.count))
  const neighbors = new Set(hover ? net.edges.filter((e) => e.a === hover || e.b === hover).flatMap((e) => [e.a, e.b]) : [])
  const color = categoryColor(net.nodes.map((n) => n.word))
  void color
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" onPointerLeave={() => { hide(); setHover('') }}
        aria-label={`Phrase Net: 패턴 ${phrasePatterns.find((p) => p.id === params.pattern)?.label}에 맞는 단어 쌍 ${net.edges.length}개`}>
        <defs><marker id="ph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L8,4L0,8z" fill="#7d8791" /></marker></defs>
        {net.edges.map((e, k) => {
          const a = pos.get(e.a)!, b = pos.get(e.b)!
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const rb = 8 + 10 * Math.sqrt((net.nodes.find((n) => n.word === e.b)?.count ?? 1) / maxC)
          const hot = hover === e.a || hover === e.b
          return <line key={k} x1={a.x} y1={a.y} x2={b.x - ((b.x - a.x) / d) * (params.arrows ? rb : 0)} y2={b.y - ((b.y - a.y) / d) * (params.arrows ? rb : 0)} stroke={hot ? '#d4452f' : '#9aa3ad'} strokeWidth={0.8 + (4 * e.count) / maxE} opacity={hover && !hot ? 0.12 : 0.7} markerEnd={params.arrows && !compact ? 'url(#ph-arrow)' : undefined} data-testid="phrase-edge"
            onPointerEnter={compact ? undefined : (ev) => { const lp = localPoint(svgRef.current!, ev); show(lp.x, lp.y, <><b>{e.a} → {e.b}</b><br />{e.count}회</>) }} onPointerLeave={hide} />
        })}
        {net.nodes.map((n) => {
          const p = pos.get(n.word)!
          const hot = hover === n.word || neighbors.has(n.word)
          return (
            <text key={n.word} x={p.x} y={p.y} textAnchor="middle" dy="0.34em" fontSize={(compact ? 8 : 11) + (compact ? 4 : 11) * Math.sqrt(n.count / maxC)} fill={hot ? '#d4452f' : '#2f3a45'} fontWeight={hot ? 700 : 500} opacity={hover && !hot ? 0.35 : 1} data-testid="phrase-word" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 4, cursor: compact ? undefined : 'pointer' }}
              onPointerEnter={compact ? undefined : () => setHover(n.word)} onPointerLeave={() => setHover('')}>{n.word}</text>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function PhraseControls({ params, setParams }: ControlsProps<PhraseParams>) {
  return (
    <ControlGroup title="관계 패턴">
      <Select label="패턴" value={params.pattern} options={phrasePatterns.map((p) => ({ value: p.id, label: `${p.label} (예: ${p.example})` }))} onChange={(pattern) => setParams({ pattern })} testId="ctl-pattern" />
      <Slider label="최소 등장 횟수" value={params.minCount} min={1} max={6} onChange={(minCount) => setParams({ minCount })} testId="ctl-mincount" />
      <Toggle label="화살표 표시" checked={params.arrows} onChange={(arrows) => setParams({ arrows })} testId="ctl-arrows" />
      <Hint>고른 패턴(예: “X와 Y”)에서 앞 단어가 그 조사를 달고 있고 바로 뒤에 다음 단어가 오는 쌍을 찾아 앞 → 뒤 화살표로 잇습니다. 글자 크기는 연결에 참여한 횟수, 선 굵기는 그 쌍이 나온 횟수입니다. 같은 문장에 함께 나오기만 하면 잇는 공기어 네트워크와 달리 ‘어떤 관계로’ 이어졌는지를 패턴으로 정합니다. 단어에 올리면 연결된 단어가 강조됩니다. 원 논문의 영어 정규식 패턴과 달리 한국어 조사 기반의 간단한 규칙이며, 서술어는 제외합니다.</Hint>
    </ControlGroup>
  )
}

export const phraseNetModule: VizModule<PhraseParams> = {
  roles: [textRole],
  datasets: ['corpus-articles', 'text-corpus'],
  defaultParams: { pattern: 'and', minCount: 1, arrows: true },
  Chart: PhraseChart,
  Controls: PhraseControls,
  hint: '패턴을 바꿔 다른 관계를 찾기 · 단어에 올려 연결된 단어 강조',
}
