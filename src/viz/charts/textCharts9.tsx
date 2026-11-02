import { useId, useMemo, useRef, useState } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber } from '../../data/table'
import { categoryColor, schemes } from '../../lib/colors'
import { edgeAt, parseQuery, tileBars, wordStream, type WordRow } from '../../stats/text9'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

const TEXT_INPUT = { width: '100%', padding: '6px 8px', border: '1px solid #cfd6d6', borderRadius: 6, fontSize: 13, background: '#fff' } as const

// ───────────────────────────── WordStream ─────────────────────────────

export interface WordStreamParams { topWords: number; minSize: number; maxSize: number; from: number; to: number; selTopic: string; selWord: string; bands: boolean }

function readWords(table: ChartProps<WordStreamParams>['table'], mapping: ChartProps<WordStreamParams>['mapping']): WordRow[] | null {
  const ti = columnIndex(table, roleColumn(mapping, 'time')), pi = columnIndex(table, roleColumn(mapping, 'topic')), wi = columnIndex(table, roleColumn(mapping, 'word')), fi = columnIndex(table, roleColumn(mapping, 'freq'))
  if ([ti, pi, wi, fi].some((i) => i < 0)) return null
  const out: WordRow[] = []
  for (const r of table.rows) { const t = toNumber(r[ti]), f = toNumber(r[fi]); if (t != null && f != null && f > 0) out.push({ time: t, topic: toLabel(r[pi]), word: toLabel(r[wi]), freq: f }) }
  return out
}

function WordStreamChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<WordStreamParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const rows = useMemo(() => readWords(table, mapping), [table, mapping])
  const range = useMemo(() => { const t = rows?.map((r) => r.time) ?? []; return t.length ? ([Math.min(...t), Math.max(...t)] as [number, number]) : null }, [rows])
  const H = height - (compact ? 14 : 58), W = width
  const layout = useMemo(() => (rows && range ? wordStream(rows, W, H, { topWords: compact ? 2 : params.topWords, minSize: compact ? 6 : params.minSize, maxSize: compact ? 12 : params.maxSize, range: [params.from || range[0], params.to || range[1]] }) : null), [rows, range, W, H, params.topWords, params.minSize, params.maxSize, params.from, params.to, compact])
  if (!rows || !layout || layout.times.length < 2) return <ChartMessage>시점·토픽·단어·빈도 열을 고르세요. 시점이 둘 이상이어야 합니다.</ChartMessage>
  const color = categoryColor(layout.topics)
  const top0 = compact ? 6 : 8
  const outline = (k: number) => {
    const xs = Array.from({ length: 120 }, (_, i) => layout.xs[0] + (i * (layout.xs[layout.xs.length - 1] - layout.xs[0])) / 119)
    const up = xs.map((x) => `${x},${edgeAt(layout.xs, layout.top[k], x) + top0}`)
    const dn = xs.map((x) => `${x},${edgeAt(layout.xs, layout.bottom[k], x) + top0}`).reverse()
    return `M${up.join('L')}L${dn.join('L')}Z`
  }
  const dim = (topic: number, word?: string) => (params.selTopic && layout.topics[topic] !== params.selTopic) || (params.selWord && word !== undefined && word !== params.selWord)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`WordStream: 토픽 ${layout.topics.length}개, 시점 ${layout.times.length}개, 단어 ${layout.words.length}개`} onPointerLeave={hide}>
        {layout.topics.map((tp, k) => (
          <path key={tp} d={outline(k)} fill={color(tp)} fillOpacity={params.bands ? (dim(k) ? 0.06 : 0.2) : 0.04} stroke={color(tp)} strokeOpacity={dim(k) ? 0.15 : 0.7} strokeWidth={1} data-testid="stream-band" data-topic={tp} style={{ cursor: compact ? undefined : 'pointer' }}
            onClick={compact ? undefined : () => setParams({ selTopic: params.selTopic === tp ? '' : tp, selWord: '' })} />
        ))}
        {layout.words.map((w, i) => (
          <text key={i} x={w.x} y={w.y + top0} textAnchor="middle" dy="0.34em" fontSize={w.size} fontWeight={w.size > 16 ? 700 : 500} fill={color(layout.topics[w.topic])} opacity={dim(w.topic, w.text) ? 0.12 : 1} data-testid="stream-word" data-word={w.text} style={{ cursor: compact ? undefined : 'pointer' }}
            onClick={compact ? undefined : () => setParams({ selWord: params.selWord === w.text ? '' : w.text })}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{w.text}</b><br />{layout.topics[w.topic]} · {w.time}: 빈도 {w.freq}</>) }} onPointerLeave={hide}>{w.text}</text>
        ))}
        {!compact && layout.times.map((t, i) => <text key={t} x={layout.xs[i]} y={height - 36} textAnchor="middle" fontSize={11} fill="#6b7280">{t}</text>)}
        {!compact && (
          <g transform={`translate(12,${height - 16})`} pointerEvents="none">
            {layout.topics.map((tp, k) => <g key={tp} transform={`translate(${k * 112},0)`}><rect width={14} height={8} y={-2} rx={2} fill={color(tp)} /><text x={19} y={6} fontSize={11} fill="#4b5563">{tp}</text></g>)}
          </g>
        )}
        {!compact && layout.unplaced > 0 && <text x={width - 8} y={height - 14} textAnchor="end" fontSize={10} fill="#9aa6a6" data-testid="stream-unplaced">자리가 없어 못 놓은 단어 {layout.unplaced}개</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function WordStreamControls({ params, setParams, table, mapping }: ControlsProps<WordStreamParams>) {
  const rows = useMemo(() => readWords(table, mapping), [table, mapping])
  const ts = rows?.map((r) => r.time) ?? []
  const lo = ts.length ? Math.min(...ts) : 0, hi = ts.length ? Math.max(...ts) : 1
  const topics = [...new Set(rows?.map((r) => r.topic) ?? [])]
  const color = categoryColor(topics)
  return (
    <ControlGroup title="단어와 시간 범위">
      <Slider label="토픽·시점당 단어 수" value={params.topWords} min={1} max={8} onChange={(topWords) => setParams({ topWords })} testId="ctl-topwords" />
      <Slider label="가장 작은 글자 크기" value={params.minSize} min={7} max={14} onChange={(minSize) => setParams({ minSize })} testId="ctl-minsize" />
      <Slider label="가장 큰 글자 크기" value={params.maxSize} min={16} max={40} onChange={(maxSize) => setParams({ maxSize })} testId="ctl-maxsize" />
      <Slider label="시작 시점" value={params.from || lo} min={lo} max={Math.max(lo, hi - 1)} onChange={(from) => setParams({ from: Math.min(from, (params.to || hi) - 1) })} testId="ctl-from" />
      <Slider label="끝 시점" value={params.to || hi} min={Math.min(hi, lo + 1)} max={hi} onChange={(to) => setParams({ to: Math.max(to, (params.from || lo) + 1) })} testId="ctl-to" />
      <Toggle label="토픽 띠 칠하기" checked={params.bands} onChange={(bands) => setParams({ bands })} testId="ctl-bands" />
      <div className="field">
        <label>토픽 강조</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" aria-pressed={!params.selTopic} onClick={() => setParams({ selTopic: '', selWord: '' })}>전체</button>
          {topics.map((t) => <button key={t} type="button" className="btn btn-secondary btn-sm" aria-pressed={params.selTopic === t} data-testid={`topic-${t}`} style={{ borderColor: color(t) }} onClick={() => setParams({ selTopic: params.selTopic === t ? '' : t, selWord: '' })}>{t}</button>)}
        </div>
      </div>
      <Hint>토픽은 쌓인 띠(스트림)이고 두께가 그 시점 단어 빈도의 합입니다. 띠 안쪽 시점 위치에 그 토픽의 상위 단어를 놓고, 빈도가 클수록 큰 글자로 쓰며, 글자가 띠 밖으로 나가거나 다른 단어와 겹치지 않는 자리를 중앙에서 위아래로 찾습니다. 자리를 못 찾으면 글자를 줄여 다시 시도하고 그래도 안 되면 생략합니다. 단어를 누르면 같은 단어를 모든 시점에서 강조합니다. 이 구현의 띠 윤곽은 시점 사이를 부드러운 보간으로 잇고, 원 논문의 글자 곡선 변형 배치 대신 가로 글자를 놓습니다.</Hint>
    </ControlGroup>
  )
}

export const wordStreamModule: VizModule<WordStreamParams> = {
  roles: [
    { key: 'time', label: '시점', type: 'number', required: true, prefer: '월|시점|time' },
    { key: 'topic', label: '토픽', type: 'category', required: true, prefer: '토픽|topic' },
    { key: 'word', label: '단어', type: 'category', required: true, prefer: '단어|word' },
    { key: 'freq', label: '빈도', type: 'number', required: true, prefer: '빈도|freq' },
  ],
  datasets: ['topic-words'],
  defaultParams: { topWords: 4, minSize: 9, maxSize: 26, from: 0, to: 0, selTopic: '', selWord: '', bands: true },
  Chart: WordStreamChart,
  Controls: WordStreamControls,
  hint: '단어를 눌러 같은 단어를 모든 시점에서 따라갑니다 · 토픽 띠를 눌러 강조 · 시간 범위와 단어 수를 조절',
}

// ───────────────────────────── TileBars ─────────────────────────────

export interface TileParams { query: string; mode: 'fixed' | 'topic'; size: number; sort: 'order' | 'hits' | 'together'; selDoc: string; selTile: number; normalize: boolean }

function TileBarsChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<TileParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const docsAll = useMemo(() => {
    const di = columnIndex(table, roleColumn(mapping, 'doc')), si = columnIndex(table, roleColumn(mapping, 'text'))
    if (di < 0 || si < 0) return null
    const map = new Map<string, string[]>()
    for (const r of table.rows) { const d = toLabel(r[di]); map.set(d, [...(map.get(d) ?? []), toLabel(r[si])]) }
    return [...map].map(([name, sentences]) => ({ name, sentences }))
  }, [table, mapping])
  const groups = useMemo(() => parseQuery(params.query), [params.query])
  const bars = useMemo(() => (docsAll && groups.length ? tileBars(docsAll, groups, params.mode, params.size) : null), [docsAll, groups, params.mode, params.size])
  if (!docsAll) return <ChartMessage>문서 열과 문장(본문) 열을 고르세요. 한 행이 한 문장이어야 합니다.</ChartMessage>
  if (!bars) return <ChartMessage>검색어를 입력하세요. 쉼표로 줄을 나누고 | 로 같은 줄의 대체어를 적습니다(예: 지도|맵, 네트워크).</ChartMessage>
  const order = [...bars].sort((a, b) => (params.sort === 'hits' ? b.hits - a.hits : params.sort === 'together' ? b.together - a.together || b.hits - a.hits : 0))
  const left = compact ? 6 : 92, top = compact ? 6 : 36, right = compact ? 6 : 16
  const longest = Math.max(...bars.map((b) => b.sentences.length))
  const rowH = groups.length * (compact ? 6 : 13) + (compact ? 6 : 14)
  const unitW = (width - left - right) / Math.max(1, longest)
  const maxCount = Math.max(1, ...bars.flatMap((b) => b.counts.flat()))
  const ramp = schemes.teal.interpolate
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`TileBars: 문서 ${bars.length}편, 검색어 ${groups.length}개`} onPointerLeave={hide}>
        {!compact && <text x={left} y={22} fontSize={10} fill="#6b7280">검색어 줄(위→아래): {groups.map((x) => x.label).join(' / ')}</text>}
        {order.map((b, di) => {
          const y0 = top + di * (rowH + (compact ? 3 : 8))
          const sel = params.selDoc === b.name
          return (
            <g key={b.name} data-testid="tilebar" data-doc={b.name} data-hits={b.hits} opacity={params.selDoc && !sel ? 0.45 : 1}>
              {!compact && <text x={left - 8} y={y0 + (groups.length * 13) / 2 + 4} textAnchor="end" fontSize={11} fontWeight={sel ? 700 : 500} fill="#374151" style={{ cursor: 'pointer' }} onClick={() => setParams({ selDoc: sel ? '' : b.name, selTile: -1 })}>{b.name}</text>}
              {!compact && <text x={left + b.sentences.length * unitW + 6} y={y0 + (groups.length * 13) / 2 + 4} fontSize={10} fill="#6b7280">{b.hits}회{b.together ? ` · 모두 ${b.together}칸` : ''}</text>}
              {b.tiles.map((t, ti) => {
                const x0 = left + t.start * unitW, w = (t.end - t.start) * unitW
                return groups.map((_, k) => {
                  const c = b.counts[k][ti]
                  const v = params.normalize ? Math.min(1, c / Math.max(1, Math.max(...b.counts[k]))) : Math.min(1, c / maxCount)
                  const ch = compact ? 5 : 12
                  return (
                    <rect key={`${ti}-${k}`} x={x0 + 0.5} y={y0 + k * (ch + 1)} width={Math.max(1, w - 1)} height={ch} rx={1.5} fill={c ? ramp(0.25 + 0.7 * v) : '#f0f3f3'} stroke={sel && params.selTile === ti ? '#d4452f' : 'none'} strokeWidth={1.6} data-testid="tile" data-count={c} data-term={k}
                      style={{ cursor: compact ? undefined : 'pointer' }}
                      onClick={compact ? undefined : () => setParams({ selDoc: b.name, selTile: sel && params.selTile === ti ? -1 : ti })}
                      onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{b.name}</b> · 문장 {t.start + 1}–{t.end}<br />‘{groups[k].label}’ {c}회</>) }} onPointerLeave={hide} />
                  )
                })
              })}
            </g>
          )
        })}
        {!compact && (() => {
          const b = bars.find((x) => x.name === params.selDoc)
          if (!b || params.selTile < 0 || !b.tiles[params.selTile]) return null
          const t = b.tiles[params.selTile]
          return <text x={left} y={height - 10} fontSize={11} fill="#374151" data-testid="tile-text">{b.name} 문장 {t.start + 1}–{t.end}: {b.sentences.slice(t.start, t.end).join(' ').slice(0, 90)}</text>
        })()}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function TileBarsControls({ params, setParams }: ControlsProps<TileParams>) {
  const id = useId()
  const [draft, setDraft] = useState(params.query)
  return (
    <ControlGroup title="검색어와 조각">
      <div className="field">
        <label htmlFor={id}>검색어 (쉼표로 줄 나눔, | 로 대체어)</label>
        <input id={id} type="text" style={TEXT_INPUT} value={draft} data-testid="tile-query" onChange={(e) => { setDraft(e.target.value); setParams({ query: e.target.value }) }} />
      </div>
      <Segmented label="문서 나누기" value={params.mode} onChange={(mode) => setParams({ mode, selTile: -1 })} options={[{ value: 'fixed', label: '고정 길이' }, { value: 'topic', label: '화제 전환 기준' }]} testId="ctl-mode" />
      <Slider label={params.mode === 'fixed' ? '조각당 문장 수' : '비교 창 크기 (문장)'} value={params.size} min={2} max={8} onChange={(size) => setParams({ size, selTile: -1 })} testId="ctl-size" />
      <Segmented label="문서 정렬" value={params.sort} onChange={(sort) => setParams({ sort })} options={[{ value: 'order', label: '원래 순서' }, { value: 'hits', label: '적중 횟수' }, { value: 'together', label: '모두 함께 나온 조각' }]} testId="ctl-sort" />
      <Toggle label="줄마다 최댓값 기준으로 진하기 정하기" checked={params.normalize} onChange={(normalize) => setParams({ normalize })} testId="ctl-normalize" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selDoc: '', selTile: -1 })} data-testid="tile-clear">선택 해제</button>
      <Hint>문서 하나가 막대 하나이고 길이는 문서 길이(문장 수)에 비례합니다. 막대는 문서를 나눈 조각들의 칸이며, 검색어 줄마다 그 조각에 검색어가 몇 번 나왔는지가 칸의 진하기입니다. 같은 조각에서 여러 줄이 함께 진하면 검색어들이 한 대목에서 함께 쓰인 문서입니다. ‘화제 전환 기준’은 인접한 문장 묶음의 단어 겹침이 낮아지는 곳에서 나누는 단순한 TextTiling이며, 원 논문의 TextTiling을 완전히 재현하지 않습니다. 검색어는 형태소 분석 없이 글자 그대로(부분 문자열) 셉니다.</Hint>
    </ControlGroup>
  )
}

export const tileBarsModule: VizModule<TileParams> = {
  roles: [
    { key: 'doc', label: '문서', type: 'category', required: true, prefer: '문서|doc' },
    { key: 'text', label: '문장(본문)', type: 'category', required: true, prefer: '문장|text' },
  ],
  datasets: ['search-docs', 'corpus-articles'],
  defaultParams: { query: '지도, 네트워크, 시간', mode: 'fixed', size: 4, sort: 'order', selDoc: '', selTile: -1, normalize: false },
  Chart: TileBarsChart,
  Controls: TileBarsControls,
  hint: '검색어를 바꿔 문서마다 분포를 비교 · 칸을 눌러 그 조각의 문장 확인',
}
