import { toNumber, toTime, type DataTable } from '../data/table'
import type { DatasetId } from '../data/datasets'
import { autoMapping, incompatibility, mappingErrors, roleTypes } from '../viz/mapping'
import type { Mapping, VizModule } from '../viz/types'

export const MAX_PANES = 3

export interface Preset {
  id: string
  name: string
  /** What the combination is for, in one line. */
  note: string
  datasetId: DatasetId
  n?: number
  charts: string[]
}

/** Recommended combinations. Each one needs a single dataset that every chart in it can use directly (no conversion). */
export const presets: Preset[] = [
  { id: 'distribution', name: '히스토그램 · KDE · ECDF', note: '같은 표본을 구간, 밀도, 누적으로 본 모습', datasetId: 'bimodal', n: 240, charts: ['histogram', 'kde', 'ecdf'] },
  { id: 'groups', name: '박스 · 바이올린 · 레인클라우드', note: '그룹 분포를 요약, 모양, 원자료로 비교', datasetId: 'groups', n: 160, charts: ['box', 'violin', 'raincloud'] },
  { id: 'xy', name: '산점도 · 헥스빈 · 2D KDE', note: '두 변수의 점, 칸 집계, 밀도 추정', datasetId: 'dense', n: 1200, charts: ['scatter', 'hexbin', 'kde2d'] },
  { id: 'bars', name: '막대 · 롤리팝 · 불릿', note: '같은 지표를 막대, 점, 목표 구간과 함께', datasetId: 'kpi', charts: ['bar', 'lollipop', 'bullet'] },
  { id: 'time', name: '선 · 영역 · 스텝', note: '날짜형 시계열을 세 가지 방식으로', datasetId: 'visits-dated', n: 90, charts: ['line', 'area', 'step'] },
  { id: 'hierarchy', name: '트리맵 · 선버스트 · 아이시클', note: '같은 계층 데이터의 세 가지 분할', datasetId: 'budget', charts: ['treemap', 'sunburst', 'icicle'] },
  { id: 'classifier', name: 'ROC · Precision–Recall', note: '불균형 데이터에서 두 곡선의 차이', datasetId: 'scores-imbalanced', n: 1000, charts: ['roc', 'pr'] },
  { id: 'calibration', name: 'ROC · PR · 보정 곡선', note: '구분 능력(ROC·PR)과 확률의 보정(과신)을 같은 예측으로 비교', datasetId: 'risk-model', n: 1000, charts: ['roc', 'pr', 'calibration'] },
  { id: 'geo-symbol', name: '코로플레스 · 비례 심벌 · 막대', note: '시도별 값을 경계 색, 위치의 원 크기, 막대로 — 지도에서 가리킨 지역이 막대에서도 강조됩니다', datasetId: 'kr-regions', charts: ['choropleth', 'symbol-map', 'bar'] },
  { id: 'geo-tile', name: '코로플레스 · 타일 그리드 · 도를링', note: '같은 지역 값을 실제 면적, 같은 크기 타일, 값 비례 원으로 — 면적 왜곡의 차이', datasetId: 'kr-regions', charts: ['choropleth', 'tile-grid', 'dorling'] },
  { id: 'agreement', name: '산점도 · 블랜드-알트만', note: '두 측정법의 상관(산점도)과 일치도(차이 플롯)는 다른 질문입니다', datasetId: 'paired', n: 60, charts: ['scatter', 'bland-altman'] },
  { id: 'network-matrix', name: '네트워크 · 인접 행렬', note: '같은 간선 목록을 노드 링크와 행렬로 — 노드를 가리키면 행과 열, 칸을 가리키면 간선이 강조됩니다', datasetId: 'network', n: 30, charts: ['network', 'adjacency'] },
  { id: 'bipartite', name: '네트워크 · 이분 그래프', note: '사람–모임 관계를 일반 네트워크와 두 집합 배치로', datasetId: 'affiliations', n: 14, charts: ['network', 'bipartite'] },
  { id: 'mekko', name: '모자이크 · 마리메코', note: '같은 (지역, 제품군, 매출)을 빈도 모자이크와 값 기반 마리메코로', datasetId: 'market', charts: ['mosaic', 'marimekko'] },
  { id: 'terrain', name: '음영기복 · 경사·사면 · 등고선', note: '같은 지형을 빛과 그림자, 경사와 방향, 같은 높이 선으로 — 표고 한 장에서 파생한 세 가지 표면 표현', datasetId: 'terrain-hills', charts: ['hillshade', 'slope-aspect', 'isoline'] },
  { id: 'vector', name: '벡터장 · 유선 · 입자 흐름', note: '같은 바람장을 방향 화살표, 흐름선, 움직이는 입자로', datasetId: 'wind-sources', charts: ['vector-field', 'streamline', 'particle-flow'] },
  { id: 'cartogram', name: '코로플레스 · 연속 카토그램 · 데머스', note: '같은 지역 값을 면적 그대로, 값에 비례해 왜곡한 지도, 값 비례 정사각형으로', datasetId: 'kr-regions', charts: ['choropleth', 'cartogram-contiguous', 'demers'] },
  { id: 'regression-diagnostics', name: '잔차 · 척도-위치 · 영향력', note: '같은 회귀 적합의 세 가지 진단: 모형 형태, 등분산성, 영향이 큰 관측', datasetId: 'regression-demo', n: 80, charts: ['residual-plot', 'scale-location', 'influence-plot'] },
  { id: 'survival', name: '카플란–마이어 · 넬슨–알렌', note: '같은 생존 자료를 생존 확률과 누적 위험으로', datasetId: 'survival-trial', charts: ['kaplan-meier', 'nelson-aalen'] },
  { id: 'price-bricks', name: '캔들 · 하이킨 아시 · 렌코', note: '같은 시세를 시간 기준 봉, 평균 봉, 가격 기준 벽돌로 — 잡음을 걸러내는 방식의 차이', datasetId: 'ohlc', n: 120, charts: ['candlestick', 'heikin-ashi', 'renko'] },
  { id: 'spectral', name: '스펙트로그램 · 스칼로그램 · 재귀 도표', note: '같은 신호를 시간–주파수(STFT), 시간–스케일(웨이블릿), 상태 재방문으로', datasetId: 'signal-chirp', charts: ['spectrogram', 'scalogram', 'recurrence-plot'] },
  { id: 'differential-expression', name: '화산 도표 · MA 도표', note: '같은 유전자 결과를 효과 크기와 유의성, 발현량과 배수 변화로 — 한쪽에서 가리킨 유전자가 다른 쪽에서도 강조됩니다', datasetId: 'de-genes', n: 1500, charts: ['volcano', 'ma-plot'] },
  { id: 'set-overlap', name: '벤·오일러 · UpSet · 하이퍼그래프', note: '같은 소속 데이터를 원의 겹침, 조합 막대, 집합 영역으로 — 한쪽에서 고른 조합의 항목이 다른 쪽에서도 강조됩니다', datasetId: 'set-members', charts: ['venn', 'upset', 'hypergraph'] },
  { id: 'community-distance', name: 'PCoA · 계통수', note: '같은 거리 행렬을 평면 배치와 가지 모양으로', datasetId: 'microbiome-dist', charts: ['pcoa', 'phylogenetic-tree'] },
]

export const presetById = new Map(presets.map((p) => [p.id, p]))

/**
 * Why a shared table cannot drive a chart, or null when it can. Checks, in order: the data's structure (enough columns of each
 * type for the required roles), the current column mapping, and that every required numeric / date column has at least one usable value.
 * The table is never reshaped or coerced to make an unsuitable chart appear to work.
 */
export function compareIssue(mod: Pick<VizModule, 'roles'>, table: DataTable, mapping: Mapping): string | null {
  const structural = incompatibility(mod.roles, table)
  if (structural) return structural
  const errors = mappingErrors(mod.roles, table, mapping)
  if (errors.length) return errors[0]
  for (const role of mod.roles) {
    if (!role.required) continue
    const names = role.multiple ? (Array.isArray(mapping[role.key]) ? (mapping[role.key] as string[]) : []) : typeof mapping[role.key] === 'string' ? [mapping[role.key] as string] : []
    for (const name of names) {
      const ci = table.columns.findIndex((c) => c.name === name)
      if (ci < 0) continue
      const type = table.columns[ci].type
      if (type === 'category' && !roleTypes(role).includes('category')) continue
      const usable = table.rows.filter((r) => (type === 'number' ? toNumber(r[ci]) != null : type === 'date' ? toTime(r[ci]) != null : r[ci] != null && r[ci] !== '')).length
      if (usable === 0) return `‘${name}’ 열에 사용할 수 있는 값이 없습니다 (결측값뿐입니다).`
    }
  }
  return null
}

/** A pane's effective mapping: its remembered choices where still valid, otherwise filled from the shared table. */
export const paneMapping = (mod: Pick<VizModule, 'roles'>, table: DataTable, remembered?: Mapping) => autoMapping(mod.roles, table, remembered)
