import * as d3 from 'd3'
import { useMemo } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt, pct } from '../../lib/format'
import { alignmentColumns, distanceMatrix, enrichmentTest, phiPsi, ramaRegion, type BackboneAtom, type RamaRegion, type V3 } from '../../stats/applied'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { HeatGrid, Panels, Stage, XYPlot, useStage, type Layer } from './kit'

/** Bioinformatics charts: gene-set enrichment, alignment with sequence logo, protein contact map and Ramachandran plot (all example data are synthetic). */

const col = (table: DataTable, mapping: Mapping, key: string) => columnIndex(table, roleColumn(mapping, key))

// ─── gene-set enrichment (GSEA) ─────────────────────────────────────────────────────

export interface GseaParams { weight: 0 | 1 | 2; perms: number; seed: number }

const gseaRoles: RoleSpec[] = [
  { key: 'score', label: '순위 점수 (예: 발현 변화 통계량)', type: 'number', required: true, prefer: '점수|score|stat|logfc|fc' },
  { key: 'member', label: '집합 소속 (1 = 속함)', type: 'number', required: true },
  { key: 'gene', label: '유전자 이름 (선택)', type: 'category', auto: true, prefer: '유전자|gene|id' },
]
const margin = { left: 62, right: 24 }

function GseaChart({ table, mapping, params, width, height, compact }: ChartProps<GseaParams>) {
  const m = useMemo(() => {
    const si = col(table, mapping, 'score'), mi = col(table, mapping, 'member'), gi = col(table, mapping, 'gene')
    if (si < 0 || mi < 0) return null
    const rows = table.rows.map((r, i) => ({ s: toNumber(r[si]), h: toNumber(r[mi]), g: gi >= 0 ? toLabel(r[gi]) : `행 ${i + 1}` })).filter((r): r is { s: number; h: number; g: string } => r.s != null && r.h != null)
    rows.sort((a, b) => b.s - a.s)
    if (rows.length < 20) return null
    const inSet = rows.map((r) => r.h > 0), res = enrichmentTest(rows.map((r) => r.s), inSet, params.weight, compact ? 60 : params.perms, params.seed)
    return res ? { rows, inSet, res } : null
  }, [table, mapping, params.weight, params.perms, params.seed, compact])
  if (!m) return <ChartMessage>점수 열과 집합 소속(0/1) 열을 고르세요. 유전자 20개 이상, 집합에 속한 것이 1개 이상 필요합니다.</ChartMessage>
  const { rows, inSet, res } = m
  const n = rows.length, xs = rows.map((_, i) => i + 1)
  const hitRanks = xs.filter((_, i) => inSet[i])
  const lead = hitRanks.filter((r) => (res.es >= 0 ? r <= res.at + 1 : r >= res.at + 1)).length
  const common = { width, margin, xDomain: [1, n] as [number, number], compact }
  const es = (h: number) => (
    <XYPlot {...common} height={h} hover={false} title={`농축 점수 ES = ${fmt(res.es, 3)}`} yLabel="누적 농축 점수" xLabel={compact ? undefined : ''}
      layers={[{ kind: 'hline', v: 0, color: '#9aa1a9' }, { kind: 'line', x: [0, ...xs], y: [0, ...res.run], color: '#2a8c82', width: 2.4 }, { kind: 'vline', v: res.at + 1, color: '#e11d48', dash: '5 4', label: `최대 편차 (순위 ${res.at + 1})` }]}
      readout={[{ label: 'ES', value: fmt(res.es, 3) }, { label: 'NES', value: fmt(res.nes, 2) }, { label: '순열 p값', value: res.pValue < 0.001 ? '< 0.001' : fmt(res.pValue, 3) }, { label: '집합 크기 / 핵심 유전자', value: `${res.hits} / ${lead}` }]} />
  )
  if (compact) return es(height)
  const bar = (h: number) => <XYPlot {...common} height={h} hover={false} title="집합 유전자 위치" margin={{ ...margin, top: 4, bottom: 4 }} yDomain={[0, 1]} layers={[{ kind: 'stem', x: hitRanks, y: hitRanks.map(() => 1), color: '#4c6fb5' }]} yFormat={() => ''} />
  const sc = (h: number) => <XYPlot {...common} height={h} hover title="순위 점수" xLabel="순위 (왼쪽 = 상향 · 오른쪽 = 하향)" yLabel="점수" layers={[{ kind: 'line', x: xs, y: rows.map((r) => r.s), color: '#6b7280', width: 1.6 }, { kind: 'hline', v: 0, color: '#9aa1a9', dash: '4 4' }]} />
  return <Panels width={width} height={height} parts={[2.6, 0.7, 1.4]}>{[es, bar, sc]}</Panels>
}

function GseaControls({ params, setParams }: ControlsProps<GseaParams>) {
  return (
    <ControlGroup title="유전자 집합 농축 분석">
      <Segmented label="가중 지수 p" value={String(params.weight)} onChange={(v) => setParams({ weight: Number(v) as 0 | 1 | 2 })} testId="ctl-weight" options={[{ value: '0', label: '0 (KS)' }, { value: '1', label: '1 (표준)' }, { value: '2', label: '2' }]} />
      <Slider label="순열 횟수" value={params.perms} min={100} max={2000} step={100} onChange={(perms) => setParams({ perms })} testId="ctl-perms" />
      <Slider label="난수 시드" value={params.seed} min={1} max={50} onChange={(seed) => setParams({ seed })} />
      <Hint>순위가 매겨진 유전자 목록을 위에서부터 걸으며 집합에 속한 유전자를 만나면 |r|^p / N_R만큼 올리고, 아니면 1/(N − N_H)만큼 내립니다. 누적 합의 가장 큰 편차가 농축 점수 ES이며 집합이 목록의 한쪽 끝에 몰릴수록 큽니다. 같은 크기의 무작위 집합을 순열로 뽑은 ES 분포로 정규화(NES)하고 p값을 셉니다. 여러 집합을 동시에 검정하면 다중 검정 보정이 필요하며, 집합 소속 열을 바꿔(경로 A·B·C) 비교하세요.</Hint>
    </ControlGroup>
  )
}

export const gseaModule: VizModule<GseaParams> = {
  roles: gseaRoles, datasets: ['gsea-expr'], defaultParams: { weight: 1, perms: 500, seed: 1 },
  Chart: GseaChart, Controls: GseaControls, hint: '집합 소속 열을 경로 A → B → C로 바꿔 보세요 · A는 위쪽, B는 아래쪽에 몰려 ES의 부호가 달라집니다 · 가중 지수 0은 고전적인 KS 통계량입니다 (합성 데이터)',
}

// ─── multiple sequence alignment with sequence logo ────────────────────────────────

export interface MsaParams { alphabet: 'auto' | 'protein' | 'dna'; smallSample: boolean; logo: boolean }

const msaRoles: RoleSpec[] = [
  { key: 'seq', label: '정렬된 서열 (갭 −)', type: 'category', required: true, prefer: '서열|seq|align' },
  { key: 'name', label: '서열 이름 (선택)', type: 'category', auto: true, prefer: '이름|name|id' },
]
const PCLASS: Record<string, string> = { A: '#4c6fb5', V: '#4c6fb5', L: '#4c6fb5', I: '#4c6fb5', M: '#4c6fb5', C: '#4c6fb5', F: '#7a5aa6', W: '#7a5aa6', Y: '#7a5aa6', S: '#2a8c82', T: '#2a8c82', N: '#2a8c82', Q: '#2a8c82', K: '#d64550', R: '#d64550', H: '#d64550', D: '#e07a3f', E: '#e07a3f', G: '#b08a2e', P: '#b08a2e' }
const DCLASS: Record<string, string> = { A: '#2a8c82', C: '#4c6fb5', G: '#b08a2e', T: '#d64550' }

function MsaChart({ table, mapping, params, width, height, compact }: ChartProps<MsaParams>) {
  const stage = useStage()
  const m = useMemo(() => {
    const si = col(table, mapping, 'seq'), ni = col(table, mapping, 'name')
    if (si < 0) return null
    const seqs = table.rows.map((r) => toLabel(r[si]).replace(/\s+/g, '').toUpperCase()).filter(Boolean)
    if (seqs.length < 2) return null
    const alpha = params.alphabet === 'auto' ? (seqs.every((s) => /^[ACGTUN-]+$/.test(s)) ? 'dna' : 'protein') : params.alphabet
    const clean = seqs.map((s) => s.replace(/U/g, 'T'))
    const names = table.rows.filter((r) => toLabel(r[si]).trim()).map((r, i) => (ni >= 0 ? toLabel(r[ni]) : `서열 ${i + 1}`))
    return { seqs: clean, names, alpha, cols: alignmentColumns(clean, alpha, params.smallSample) }
  }, [table, mapping, params.alphabet, params.smallSample])
  if (!m) return <ChartMessage>정렬된 서열 열을 고르세요(서열 2개 이상, 길이는 같게).</ChartMessage>
  const { seqs, names, alpha, cols } = m, L = cols.cols.length, maxIc = Math.log2(alpha === 'dna' ? 4 : 20)
  const cls = alpha === 'dna' ? DCLASS : PCLASS
  const left = compact ? 6 : 78, right = 12, cw = (width - left - right) / L
  const logoH = compact ? Math.min(60, height * 0.45) : params.logo ? Math.min(130, height * 0.3) : 0, rh = Math.max(compact ? 3 : 9, Math.min(18, (height - logoH - 70) / seqs.length)), top = logoH + (logoH ? 26 : 8)
  const font = Math.min(12, cw * 0.95)
  const meanIc = cols.cols.reduce((a, c) => a + c.ic, 0) / L, conserved = cols.cols.filter((c) => c.n >= 2 && c.entropy < 0.2 && c.gapFrac < 0.5).length
  return (
    <Stage stage={stage} width={width} height={height} label={`다중 서열 정렬: 서열 ${seqs.length}개, 길이 ${L}`} compact={compact} readout={[{ label: '정렬 길이', value: String(L) }, { label: '평균 정보량(bits)', value: fmt(meanIc, 3) }, { label: '거의 완전 보존 위치(엔트로피 < 0.2)', value: String(conserved) }]} note={`정보량 최대 ${fmt(maxIc, 2)} bits (${alpha === 'dna' ? 'DNA' : '단백질'})`}>
      {logoH > 0 && (
        <g transform={`translate(${left},8)`}>
          {!compact && <><text x={-6} y={logoH / 2} textAnchor="end" fontSize={10.5} fill="#6b7280" dy="0.34em">정보량</text><line x1={0} x2={L * cw} y1={logoH} y2={logoH} stroke="#9aa1a9" /></>}
          {cols.cols.map((c, j) => {
            let y = logoH
            const order = c.counts.map((v, k) => ({ v, k })).filter((o) => o.v > 0).sort((a, b) => a.v - b.v)
            return (
              <g key={j} data-testid="logo-col" onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>위치 {j + 1}</b><br />정보량 {fmt(c.ic, 3)} bits · 엔트로피 {fmt(c.entropy, 3)}<br />보존 잔기 {c.consensus} · 갭 {pct(c.gapFrac, 0)}</>)}>
                {order.map(({ v, k }) => {
                  const h = (v / c.n) * (c.ic / maxIc) * logoH
                  if (h < 0.8) return null
                  y -= h
                  return compact ? <rect key={k} x={j * cw} y={y} width={Math.max(0.5, cw)} height={h} fill={cls[cols.letters[k]] ?? '#9aa1a9'} /> : <text key={k} transform={`translate(${j * cw + cw / 2},${y + h}) scale(1,${h / (font * 0.75)})`} textAnchor="middle" fontSize={font} fontWeight={700} fill={cls[cols.letters[k]] ?? '#9aa1a9'}>{cols.letters[k]}</text>
                })}
              </g>
            )
          })}
        </g>
      )}
      <g transform={`translate(${left},${top})`}>
        {seqs.map((s, i) => (
          <g key={i} transform={`translate(0,${i * rh})`}>
            {!compact && <text x={-6} y={rh / 2} dy="0.34em" textAnchor="end" fontSize={10.5} fill="#374151">{names[i].length > 9 ? `${names[i].slice(0, 8)}…` : names[i]}</text>}
            {[...s].map((ch, j) => {
              const base = cls[ch], gap = !base
              return (
                <g key={j}>
                  <rect x={j * cw} width={Math.max(0.5, cw - (cw > 6 ? 0.6 : 0))} height={rh - (rh > 8 ? 1 : 0)} fill={gap ? '#f3f4f6' : base} fillOpacity={gap ? 1 : cols.cols[j].consensus === ch ? 0.88 : 0.38} />
                  {!compact && cw >= 8 && rh >= 10 && !gap && <text x={j * cw + cw / 2} y={rh / 2} dy="0.34em" textAnchor="middle" fontSize={Math.min(11, cw * 0.9)} fill={cols.cols[j].consensus === ch ? '#fff' : '#111827'} pointerEvents="none">{ch}</text>}
                </g>
              )
            })}
          </g>
        ))}
        {!compact && <g transform={`translate(0,${seqs.length * rh + 14})`}>
          <text x={-6} y={0} textAnchor="end" fontSize={10.5} fill="#6b7280">합의 서열</text>
          {cols.cols.map((c, j) => cw >= 8 ? <text key={j} x={j * cw + cw / 2} y={0} textAnchor="middle" fontSize={Math.min(11, cw * 0.9)} fontWeight={700} fill={cls[c.consensus] ?? '#9aa1a9'}>{c.consensus}</text> : <rect key={j} x={j * cw} y={-8} width={Math.max(0.5, cw)} height={8} fill={cls[c.consensus] ?? '#e5e7eb'} />)}
        </g>}
      </g>
    </Stage>
  )
}

function MsaControls({ params, setParams }: ControlsProps<MsaParams>) {
  return (
    <ControlGroup title="서열 정렬과 보존도">
      <Segmented label="알파벳" value={params.alphabet} onChange={(alphabet) => setParams({ alphabet })} testId="ctl-alphabet" options={[{ value: 'auto', label: '자동' }, { value: 'protein', label: '단백질' }, { value: 'dna', label: 'DNA' }]} />
      <Toggle label="작은 표본 보정 (eₙ)" checked={params.smallSample} onChange={(smallSample) => setParams({ smallSample })} />
      <Toggle label="서열 로고 표시" checked={params.logo} onChange={(logo) => setParams({ logo })} />
      <Hint>각 열에서 잔기 빈도 p로 섀넌 엔트로피 H = −Σ p log₂ p를 구하고 정보량 R = log₂ s − (H + eₙ)를 계산합니다(s는 알파벳 크기, 단백질 20·DNA 4). 보정항 eₙ = (s − 1)/(2 ln2 · n)은 서열 수 n이 작을 때 엔트로피가 과소 추정되는 것을 바로잡습니다. 로고에서 글자 높이는 빈도 × 정보량이며 높을수록 그 위치가 보존되어 기능적으로 중요하다고 추정할 수 있습니다. 갭은 빈도에서 제외하므로 갭이 많은 열은 서열 수가 적게 계산됩니다.</Hint>
    </ControlGroup>
  )
}

export const msaModule: VizModule<MsaParams> = {
  roles: msaRoles, datasets: ['msa-kinase'], defaultParams: { alphabet: 'auto', smallSample: true, logo: true },
  Chart: MsaChart, Controls: MsaControls, hint: '위쪽 로고에서 높은 글자가 보존된 위치입니다 · 진한 칸은 합의 서열과 같은 잔기 · 표에서 서열을 고쳐 보존도가 바뀌는 것을 확인하세요 (합성 서열)',
}

// ─── protein geometry: contact map and Ramachandran ────────────────────────────────

const coordRoles = (needAtom: boolean): RoleSpec[] => [
  { key: 'residue', label: '잔기 번호', type: 'number', required: true, prefer: '잔기|residue|res' },
  { key: 'atom', label: needAtom ? '원자 이름 (N / CA / C)' : '원자 이름 (선택, CA만 사용)', type: 'category', required: needAtom, auto: true, prefer: '원자|atom' },
  { key: 'x', label: 'x (Å)', type: 'number', required: true, prefer: '^x$' },
  { key: 'y', label: 'y (Å)', type: 'number', required: true, prefer: '^y$' },
  { key: 'z', label: 'z (Å)', type: 'number', required: true, prefer: '^z$' },
]

function atomsOf(table: DataTable, mapping: Mapping): BackboneAtom[] {
  const [ri, ai, xi, yi, zi] = ['residue', 'atom', 'x', 'y', 'z'].map((k) => col(table, mapping, k))
  if (ri < 0 || xi < 0 || yi < 0 || zi < 0) return []
  const out: BackboneAtom[] = []
  for (const r of table.rows) {
    const res = toNumber(r[ri]), x = toNumber(r[xi]), y = toNumber(r[yi]), z = toNumber(r[zi])
    const at = ai >= 0 ? toLabel(r[ai]).toUpperCase() : 'CA'
    if (res == null || x == null || y == null || z == null) continue
    if (at === 'N' || at === 'CA' || at === 'C') out.push({ residue: res, atom: at, xyz: [x, y, z] })
  }
  return out
}

export interface ContactParams { cutoff: number; minSep: number; mode: 'contact' | 'distance' }

function ContactChart({ table, mapping, params, width, height, compact }: ChartProps<ContactParams>) {
  const m = useMemo(() => {
    const ca = atomsOf(table, mapping).filter((a) => a.atom === 'CA').sort((a, b) => a.residue - b.residue)
    if (ca.length < 6 || ca.length > 400) return null
    return { ids: ca.map((a) => a.residue), D: distanceMatrix(ca.map((a) => a.xyz as V3)) }
  }, [table, mapping])
  if (!m) return <ChartMessage>잔기 번호와 x·y·z 열을 고르세요. Cα 원자가 6~400개 필요합니다.</ChartMessage>
  const { ids, D } = m, n = ids.length
  const contact = (i: number, j: number) => i !== j && Math.abs(i - j) >= params.minSep && D[i][j] <= params.cutoff
  let total = 0, long = 0
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (contact(i, j)) { total++; if (j - i >= 12) long++ }
  const values = D.map((row, i) => row.map((d, j) => (params.mode === 'distance' ? d : contact(i, j) ? d : NaN)))
  const labels = ids.map(String)
  return (
    <HeatGrid rows={labels} cols={labels} values={values} width={width} height={height} compact={compact} square title={`잔기 접촉 지도: 잔기 ${n}개, 접촉 ${total}개`} rowTitle="잔기" colTitle="잔기" labelEvery={Math.max(1, Math.ceil(n / 24))}
      color={(v) => (params.mode === 'distance' ? d3.interpolateViridis(1 - Math.min(1, v / 30)) : d3.interpolateBlues(0.95 - (0.6 * v) / Math.max(1, params.cutoff)))}
      tip={(i, j, v) => <><b>잔기 {ids[i]} – {ids[j]}</b><br />Cα 거리 {fmt(v, 3)} Å · 서열 간격 {Math.abs(j - i)}</>}
      readout={[{ label: '접촉 수', value: String(total) }, { label: '장거리 접촉(간격 ≥ 12)', value: String(long) }, { label: '접촉 차수', value: total ? fmt([...Array(n).keys()].reduce((s, i) => s + [...Array(n).keys()].reduce((a, j) => a + (j > i && contact(i, j) ? j - i : 0), 0), 0) / (total * n), 3) : '-' }]}
      note={params.mode === 'contact' ? '진할수록 가까운 접촉 · 대각선에 나란한 띠 = 나선, 대각선에 수직인 띠 = 가닥 쌍' : 'Cα 사이 거리(Å)'} />
  )
}

function ContactControls({ params, setParams }: ControlsProps<ContactParams>) {
  return (
    <ControlGroup title="접촉 지도">
      <Slider label="접촉 거리 기준 (Å)" value={params.cutoff} min={4} max={15} step={0.5} onChange={(cutoff) => setParams({ cutoff })} testId="ctl-cutoff" />
      <Slider label="최소 서열 간격" value={params.minSep} min={1} max={12} onChange={(minSep) => setParams({ minSep })} testId="ctl-minsep" />
      <Segmented label="표시" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'contact', label: '접촉만' }, { value: 'distance', label: '거리 전체' }]} />
      <Hint>모든 잔기 쌍의 Cα 사이 유클리드 거리 d_ij = |r_i − r_j|를 계산해 기준(보통 8 Å) 이하인 쌍을 접촉으로 표시합니다. 이웃 잔기는 항상 가까우므로 서열 간격 기준으로 가려 구조적으로 의미 있는 접촉만 봅니다. 나선은 i → i+3·4 접촉이 대각선 옆 평행한 띠로, 서로 마주 보는 나선이나 β 가닥은 대각선에서 먼 곳의 띠로 나타납니다. 접촉 차수는 접촉한 잔기 사이 평균 서열 간격을 길이로 나눈 값으로 접힘 속도와 관련이 있다고 알려져 있습니다.</Hint>
    </ControlGroup>
  )
}

export const contactModule: VizModule<ContactParams> = {
  roles: coordRoles(false), datasets: ['backbone-bundle'], defaultParams: { cutoff: 8, minSep: 3, mode: 'contact' },
  Chart: ContactChart, Controls: ContactControls, hint: '대각선과 나란한 띠는 나선(i → i+3, i+4 접촉)입니다 · 접촉 거리를 키우면 더 먼 접촉이 나타납니다 · 합성 골격 좌표입니다',
}

export interface RamaParams { color: 'region' | 'order'; regions: boolean; labels: boolean }

const REGION_COLOR: Record<RamaRegion, string> = { 'α-나선': '#2a8c82', 'β-가닥': '#4c6fb5', '왼손 나선': '#e07a3f', 기타: '#9aa1a9' }

function RamaChart({ table, mapping, params, width, height, compact }: ChartProps<RamaParams>) {
  const pp = useMemo(() => phiPsi(atomsOf(table, mapping)).filter((p) => Number.isFinite(p.phi) && Number.isFinite(p.psi)), [table, mapping])
  if (pp.length < 3) return <ChartMessage>잔기 번호, 원자 이름(N·CA·C), x·y·z 열을 고르세요. 이웃 잔기까지 이어진 골격이 필요합니다.</ChartMessage>
  const reg = pp.map((p) => ramaRegion(p.phi, p.psi)), counts = new Map<RamaRegion, number>()
  reg.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1))
  const order = d3.scaleSequential(d3.interpolateViridis).domain([0, pp.length - 1])
  const names = [...counts.keys()]
  const layers: Layer[] = params.color === 'region'
    ? names.map((nm) => ({ kind: 'points', color: REGION_COLOR[nm], r: compact ? 3 : 6, stroke: '#fff', label: `${nm} ${counts.get(nm)}`, pts: pp.map((p, i) => ({ p, i })).filter(({ i }) => reg[i] === nm).map(({ p }) => ({ x: p.phi, y: p.psi, key: String(p.residue), tip: <><b>잔기 {p.residue}</b><br />φ = {fmt(p.phi, 4)}°, ψ = {fmt(p.psi, 4)}°<br />{nm}</> })) }) as Layer)
    : [{ kind: 'points', color: '#2a8c82', r: compact ? 3 : 6, stroke: '#fff', pts: pp.map((p, i) => ({ x: p.phi, y: p.psi, color: order(i), key: String(p.residue), tip: <><b>잔기 {p.residue}</b><br />φ = {fmt(p.phi, 4)}°, ψ = {fmt(p.psi, 4)}°</> })) }]
  if (params.labels && !compact && pp.length <= 60) pp.forEach((p) => layers.push({ kind: 'text', x: p.phi, y: p.psi, text: String(p.residue), size: 9, color: '#374151', anchor: 'start' }))
  const fav = ((counts.get('α-나선') ?? 0) + (counts.get('β-가닥') ?? 0) + (counts.get('왼손 나선') ?? 0)) / pp.length
  return (
    <XYPlot hover={false} layers={layers} width={width} height={height} compact={compact} square xDomain={[-180, 180]} yDomain={[-180, 180]} pad={0} xLabel="φ (도)" yLabel="ψ (도)" title={`라마찬드란 도표: 잔기 ${pp.length}개`} xTicks={8} legend={params.color === 'region'}
      extra={params.regions ? ({ x, y }) => (
        <g fillOpacity={0.09} stroke="none">
          <rect x={x(-160)} y={y(10)} width={x(-20) - x(-160)} height={y(-80) - y(10)} fill={REGION_COLOR['α-나선']} />
          <rect x={x(-180)} y={y(180)} width={x(-45) - x(-180)} height={y(90) - y(180)} fill={REGION_COLOR['β-가닥']} />
          <rect x={x(-180)} y={y(-150)} width={x(-45) - x(-180)} height={y(-180) - y(-150)} fill={REGION_COLOR['β-가닥']} />
          <rect x={x(30)} y={y(90)} width={x(100) - x(30)} height={y(-20) - y(90)} fill={REGION_COLOR['왼손 나선']} />
        </g>
      ) : undefined}
      readout={[{ label: '허용 영역 비율', value: pct(fav, 0) }, ...names.map((nm) => ({ label: nm, value: String(counts.get(nm)) }))]} note="φ = C(i−1)–N–Cα–C, ψ = N–Cα–C–N(i+1) (IUPAC 부호) · 영역은 대략적 상자" />
  )
}

function RamaControls({ params, setParams }: ControlsProps<RamaParams>) {
  return (
    <ControlGroup title="라마찬드란 도표">
      <Segmented label="색" value={params.color} onChange={(color) => setParams({ color })} testId="ctl-color" options={[{ value: 'region', label: '영역' }, { value: 'order', label: '서열 순서' }]} />
      <Toggle label="영역 상자 표시" checked={params.regions} onChange={(regions) => setParams({ regions })} />
      <Toggle label="잔기 번호 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
      <Hint>펩타이드 골격의 N, Cα, C 원자 좌표에서 이면각(네 원자가 이루는 두 평면 사이의 각)을 계산합니다: φ는 앞 잔기의 C, N, Cα, C로, ψ는 N, Cα, C, 다음 잔기의 N으로 정의됩니다. 입체 장애 때문에 허용되는 (φ, ψ)가 제한되어 α 나선(−57°, −47° 부근), β 가닥(−120°, +130° 부근), 왼손 나선(+60°, +45° 부근) 영역에 모입니다. 영역 상자는 눈으로 보기 위한 대략적인 구분이며 검증된 힘장 지도가 아닙니다. 사슬 양 끝 잔기는 φ 또는 ψ가 정의되지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const ramaModule: VizModule<RamaParams> = {
  roles: coordRoles(true), datasets: ['backbone-bundle'], defaultParams: { color: 'region', regions: true, labels: false },
  Chart: RamaChart, Controls: RamaControls, hint: '나선 구간(청록)은 한 점 근처에 뭉치고 가닥(파랑)은 왼쪽 위에 놓입니다 · 점에 마우스를 올리면 잔기 번호가 보입니다 · 합성 골격 좌표입니다',
}

