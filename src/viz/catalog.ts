import type { CategoryId, VizMeta } from './types'

export interface CategoryDef {
  id: CategoryId
  name: string
  description: string
}

export const categories: CategoryDef[] = [
  { id: 'distribution', name: '분포', description: '값이 어떻게 퍼져 있는지' },
  { id: 'relationship', name: '관계', description: '두 변수 이상이 함께 변하는 방식' },
  { id: 'comparison', name: '비교', description: '범주 사이의 크기 비교' },
  { id: 'timeseries', name: '시계열', description: '시간에 따른 변화' },
  { id: 'composition', name: '비율·구성', description: '전체를 이루는 부분의 비율' },
  { id: 'multivariate', name: '다변량', description: '여러 변수를 한 화면에' },
  { id: 'hierarchy', name: '계층·흐름', description: '부모·자식 구조와 노드 사이의 흐름·연결' },
  { id: 'uncertainty', name: '통계·불확실성', description: '추정값의 불확실성과 분포 가정 점검' },
]

export const categoryById = new Map(categories.map((c) => [c.id, c]))

/** Metadata registry. Adding a chart = one entry here + a module in charts/ + content/. */
export const catalog: VizMeta[] = [
  // 관계
  { id: 'scatter', name: '산점도', nameEn: 'Scatter Plot', category: 'relationship', keywords: ['상관', '회귀', '두 변수', 'correlation', 'regression', '점'], summary: '두 숫자형 변수를 가로·세로 좌표로 삼아 관측값 하나하나를 점으로 찍습니다.', related: ['bubble', 'hexbin', 'pairplot'] },
  { id: 'bubble', name: '버블 차트', nameEn: 'Bubble Chart', category: 'relationship', keywords: ['크기', '세 변수', '원', 'size'], summary: '산점도에 원의 크기라는 세 번째 변수를 더해 세 변수의 관계를 함께 보여줍니다.', related: ['scatter', 'hexbin'] },
  { id: 'hexbin', name: '헥스빈 플롯', nameEn: 'Hexbin Plot', category: 'relationship', alsoIn: ['distribution'], keywords: ['밀도', '육각형', '대용량', '겹침', 'density', 'hexagon', '2d histogram'], summary: '평면을 육각형 칸으로 나누고 칸마다 들어간 점의 개수를 색으로 표현합니다.', related: ['scatter', 'heatmap', 'histogram'] },
  { id: 'pairplot', name: '페어 플롯', nameEn: 'Pair Plot', category: 'relationship', alsoIn: ['multivariate'], keywords: ['산점도 행렬', 'scatterplot matrix', 'splom', '변수 쌍'], summary: '여러 변수의 모든 쌍을 산점도 행렬로 늘어놓고 대각선에는 각 변수의 분포를 그립니다.', related: ['scatter', 'parallel', 'heatmap'] },
  // 분포
  { id: 'histogram', name: '히스토그램', nameEn: 'Histogram', category: 'distribution', keywords: ['구간', '도수', 'bin', '빈도', 'frequency', '밀도'], summary: '값의 범위를 같은 폭의 구간(bin)으로 나누고 구간마다 들어간 관측 수를 막대로 그립니다.', related: ['kde', 'ecdf', 'box'] },
  { id: 'kde', name: 'KDE 플롯', nameEn: 'Kernel Density Estimate', category: 'distribution', keywords: ['커널', '밀도 추정', 'bandwidth', '대역폭', 'density'], summary: '각 관측값에 작은 커널 곡선을 얹고 모두 더해 매끄러운 확률밀도 곡선을 추정합니다.', related: ['histogram', 'violin', 'ecdf'] },
  { id: 'ecdf', name: 'ECDF 플롯', nameEn: 'Empirical CDF', category: 'distribution', keywords: ['누적', '경험분포', '누적분포함수', 'cumulative', '백분위'], summary: '각 값 이하인 관측의 비율을 계단 모양으로 누적해, 분포 전체를 구간 설정 없이 보여줍니다.', related: ['histogram', 'kde', 'box'] },
  { id: 'box', name: '박스 플롯', nameEn: 'Box Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['사분위수', '이상치', 'IQR', '수염', 'whisker', 'quartile', 'outlier', '상자 수염'], summary: '사분위수로 상자를 만들고 수염과 이상치로 분포의 중심·퍼짐·극단값을 요약합니다.', related: ['violin', 'strip', 'histogram'] },
  { id: 'violin', name: '바이올린 플롯', nameEn: 'Violin Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['밀도', '커널', 'kde', '그룹 비교'], summary: '그룹마다 커널 밀도 곡선을 좌우 대칭으로 그려 분포의 모양을 비교합니다.', related: ['box', 'kde', 'strip'] },
  { id: 'strip', name: '스트립 플롯', nameEn: 'Strip Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['지터', 'jitter', '점', '도트', 'dot plot'], summary: '그룹별로 모든 관측값을 점으로 늘어놓아 개별 값과 분포를 함께 보여줍니다.', related: ['beeswarm', 'box', 'violin'] },
  // 비교
  { id: 'bar', name: '막대그래프', nameEn: 'Bar Chart', category: 'comparison', keywords: ['막대', '범주', '순위', 'bar', 'column'], summary: '범주마다 하나의 값을 막대의 길이로 나타내 크기를 비교합니다.', related: ['grouped-bar', 'stacked-bar', 'pie'] },
  { id: 'grouped-bar', name: '그룹 막대그래프', nameEn: 'Grouped Bar Chart', category: 'comparison', keywords: ['묶음 막대', 'clustered', '두 범주', 'side by side'], summary: '두 범주형 변수의 조합마다 막대를 나란히 세워 그룹 안과 그룹 사이를 비교합니다.', related: ['bar', 'stacked-bar', 'heatmap'] },
  { id: 'stacked-bar', name: '누적 막대그래프', nameEn: 'Stacked Bar Chart', category: 'comparison', alsoIn: ['composition'], keywords: ['쌓기', '구성', 'stacked'], summary: '한 막대 안에 하위 그룹의 값을 차례로 쌓아 전체 크기와 구성을 함께 보여줍니다.', related: ['stacked-bar-100', 'grouped-bar', 'waffle'] },
  // 시계열
  { id: 'line', name: '선그래프', nameEn: 'Line Chart', category: 'timeseries', keywords: ['추세', '시간', 'trend', '이동평균', 'line'], summary: '순서가 있는 x값(주로 시간)에 따라 값을 점으로 찍고 선으로 이어 변화의 흐름을 보여줍니다.', related: ['area', 'scatter', 'bar'] },
  { id: 'area', name: '영역 그래프', nameEn: 'Area Chart', category: 'timeseries', alsoIn: ['composition'], keywords: ['채우기', 'area', '면적'], summary: '선그래프 아래를 채워 양을 강조하며, 여러 계열을 쌓아 전체와 부분의 변화를 함께 보여줍니다.', related: ['line', 'stacked-area', 'streamgraph'] },
  // 비율·구성
  { id: 'pie', name: '원·도넛 차트', nameEn: 'Pie / Donut Chart', category: 'composition', keywords: ['파이', '도넛', '비율', '백분율', 'pie', 'donut', '부채꼴'], summary: '전체를 하나의 원으로 두고 각 범주가 차지하는 비율을 부채꼴의 각도로 나타냅니다.', related: ['treemap', 'stacked-bar', 'bar'] },
  { id: 'treemap', name: '트리맵', nameEn: 'Treemap', category: 'composition', alsoIn: ['hierarchy'], keywords: ['계층', '사각형', 'hierarchy', 'squarify', '면적'], summary: '계층 구조의 각 항목을 값에 비례하는 넓이의 사각형으로 나누어 채웁니다.', related: ['sunburst', 'pack', 'pie'] },
  // 다변량
  { id: 'heatmap', name: '히트맵', nameEn: 'Heatmap', category: 'multivariate', keywords: ['행렬', '색상', '상관 행렬', 'matrix', 'correlation'], summary: '행렬의 각 칸을 값에 대응하는 색으로 칠해 패턴과 군집을 한눈에 보여줍니다.', related: ['hexbin', 'pairplot', 'grouped-bar'] },
  { id: 'parallel', name: '평행좌표 그래프', nameEn: 'Parallel Coordinates', category: 'multivariate', keywords: ['평행 좌표', '다차원', '브러시', 'parallel coordinates'], summary: '여러 변수를 나란한 세로축으로 세우고 각 관측을 축을 가로지르는 꺾은선으로 그립니다.', related: ['pairplot', 'radar', 'heatmap'] },
  { id: 'radar', name: '레이더 차트', nameEn: 'Radar Chart', category: 'multivariate', alsoIn: ['comparison'], keywords: ['방사형', '거미줄', 'spider', 'star', '능력치'], summary: '여러 변수를 원형으로 배치한 축 위에 값을 찍고 이어 하나의 다각형으로 비교합니다.', related: ['parallel', 'bar'] },

  // ── 분포 (v0.2) ──
  { id: 'ridgeline', name: '릿지라인 플롯', nameEn: 'Ridgeline Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['조이플롯', 'joyplot', '능선', '밀도', 'kde', '그룹 비교', '겹친 밀도'], summary: '여러 그룹의 커널 밀도 곡선을 세로로 조금씩 겹쳐 쌓아 분포의 변화를 한 화면에서 비교합니다.', related: ['kde', 'violin', 'raincloud'] },
  { id: 'raincloud', name: '레인클라우드 플롯', nameEn: 'Raincloud Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['반쪽 바이올린', 'half violin', '구름', '비', '박스', '원자료'], summary: '반쪽 바이올린(구름), 박스 플롯, 개별 관측점(비)을 나란히 그려 요약과 원자료를 함께 보여줍니다.', related: ['violin', 'box', 'beeswarm'] },
  { id: 'beeswarm', name: '스웜 플롯', nameEn: 'Beeswarm Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['비스웜', '벌떼', 'swarm', '충돌 회피', '점 배치'], summary: '관측값마다 점을 찍되 점끼리 겹치지 않도록 옆으로 밀어내 배치해, 개별 값과 분포 모양을 함께 보여줍니다.', related: ['strip', 'raincloud', 'histogram'] },
  { id: 'qq', name: 'Q-Q 플롯', nameEn: 'Q-Q Plot', category: 'distribution', alsoIn: ['uncertainty'], keywords: ['분위수', 'quantile', '정규성', '정규 확률 그림', 'normal probability', 'qq'], summary: '표본의 분위수를 기준 분포의 이론적 분위수와 짝지어 찍어, 데이터가 그 분포를 따르는지 점검합니다.', related: ['ecdf', 'histogram', 'kde'] },
  // ── 비교 (v0.2) ──
  { id: 'lollipop', name: '롤리팝 차트', nameEn: 'Lollipop Chart', category: 'comparison', keywords: ['막대 사탕', '점 막대', 'stem', '순위'], summary: '막대 대신 가는 선과 끝점으로 범주별 값을 표시해, 범주가 많을 때도 깔끔하게 크기를 비교합니다.', related: ['bar', 'dumbbell', 'slope'] },
  { id: 'dumbbell', name: '덤벨 차트', nameEn: 'Dumbbell Chart', category: 'comparison', keywords: ['아령', '두 값', '차이', 'gap', '전후 비교', 'connected dot'], summary: '항목마다 두 값을 점으로 찍고 선으로 이어, 두 시점·조건 사이의 차이와 방향을 비교합니다.', related: ['slope', 'lollipop', 'grouped-bar'] },
  { id: 'slope', name: '슬로프 차트', nameEn: 'Slope Chart', category: 'comparison', alsoIn: ['timeseries'], keywords: ['기울기', '전후', '변화', 'before after', '두 시점'], summary: '두 시점(조건)의 값을 양쪽 축에 찍고 직선으로 이어, 기울기로 증가·감소와 순위 변화를 보여줍니다.', related: ['dumbbell', 'bump', 'line'] },
  { id: 'waterfall', name: '워터폴 차트', nameEn: 'Waterfall Chart', category: 'comparison', alsoIn: ['composition'], keywords: ['폭포', '증감', '누적 변화', 'bridge', '손익'], summary: '시작값에 양·음의 변화를 차례로 더해 가며 떠 있는 막대로 그려, 최종값이 만들어진 과정을 보여줍니다.', related: ['bar', 'stacked-bar', 'lollipop'] },
  // ── 비율·구성 (v0.2) ──
  { id: 'stacked-bar-100', name: '100% 누적 막대그래프', nameEn: '100% Stacked Bar Chart', category: 'composition', alsoIn: ['comparison'], keywords: ['백분율', '구성비', '비율', 'percent', 'normalized', '100%'], summary: '막대마다 합계를 100%로 맞추고 하위 그룹의 비율을 쌓아, 범주 사이의 구성 비율을 비교합니다.', related: ['stacked-bar', 'waffle', 'pie'] },
  { id: 'waffle', name: '와플 차트', nameEn: 'Waffle Chart', category: 'composition', keywords: ['격자', '100칸', '단위 차트', '정사각 비율', 'unit chart'], summary: '전체를 같은 크기의 칸(보통 10×10)으로 나누고 범주의 비율만큼 칸을 칠해 구성 비율을 셀 수 있게 보여줍니다.', related: ['pie', 'stacked-bar-100', 'treemap'] },
  // ── 시계열 (v0.2) ──
  { id: 'stacked-area', name: '누적 영역 그래프', nameEn: 'Stacked Area Chart', category: 'timeseries', alsoIn: ['composition'], keywords: ['누적 영역', 'stacked area', '쌓기', '합계 추세'], summary: '여러 계열의 값을 시점마다 차례로 쌓아 영역으로 채워, 전체 합계의 추세와 계열별 기여를 함께 보여줍니다.', related: ['area', 'streamgraph', 'stacked-bar'] },
  { id: 'streamgraph', name: '스트림그래프', nameEn: 'Streamgraph', category: 'timeseries', alsoIn: ['composition'], keywords: ['스트림', 'stream', 'wiggle', '실루엣', 'silhouette', '흐름', 'themeriver'], summary: '누적 영역의 기준선을 가운데로 옮기고 흔들림을 최소화해, 여러 계열의 흐름을 물줄기처럼 보여줍니다.', related: ['stacked-area', 'area', 'bump'] },
  { id: 'bump', name: '범프 차트', nameEn: 'Bump Chart', category: 'timeseries', alsoIn: ['comparison'], keywords: ['순위', 'rank', '등수', '순위 변화', '랭킹'], summary: '시점마다 항목의 순위를 매기고 순위끼리 선으로 이어 시간에 따른 순위 변화를 보여줍니다.', related: ['slope', 'line', 'streamgraph'] },
  { id: 'calendar', name: '캘린더 히트맵', nameEn: 'Calendar Heatmap', category: 'timeseries', keywords: ['달력', '날짜', '일별', 'github', '잔디', 'calendar'], summary: '날짜마다 하나의 칸을 달력처럼 주·요일 격자에 배치하고 값을 색으로 칠해 일별 패턴을 보여줍니다.', related: ['heatmap', 'line', 'bump'] },
  // ── 계층·흐름 ──
  { id: 'sunburst', name: '선버스트 차트', nameEn: 'Sunburst Chart', category: 'hierarchy', alsoIn: ['composition'], keywords: ['동심원', '방사형 트리맵', '계층', '부채꼴', 'partition', 'radial'], summary: '계층의 깊이를 동심원 고리로, 각 항목의 크기를 부채꼴의 각도로 나타내는 방사형 계층 그래프입니다.', related: ['treemap', 'pack', 'pie'] },
  { id: 'pack', name: '원 패킹', nameEn: 'Circle Packing', category: 'hierarchy', alsoIn: ['composition'], keywords: ['서클 패킹', '원 채우기', '버블 계층', 'circle packing', '중첩 원'], summary: '계층 구조를 원 안에 원을 겹치지 않게 채워 넣어 표현하며, 가장 안쪽 원의 넓이가 값에 비례합니다.', related: ['treemap', 'sunburst', 'bubble'] },
  { id: 'sankey', name: '생키 다이어그램', nameEn: 'Sankey Diagram', category: 'hierarchy', keywords: ['흐름', 'flow', '에너지 흐름', '유입', '전환', '경로', 'alluvial'], summary: '노드 사이의 흐름을 폭이 양에 비례하는 띠로 이어, 무엇이 어디로 얼마나 흘러가는지 보여줍니다.', related: ['chord', 'treemap', 'waterfall'] },
  { id: 'chord', name: '코드 다이어그램', nameEn: 'Chord Diagram', category: 'hierarchy', alsoIn: ['relationship'], keywords: ['현', '관계 행렬', '원형 연결', 'matrix', '이동', '네트워크'], summary: '그룹을 원 둘레의 호로 놓고 관계 행렬의 값을 두 호를 잇는 리본의 폭으로 나타내 상호 관계를 보여줍니다.', related: ['sankey', 'heatmap', 'dendrogram'] },
  { id: 'dendrogram', name: '덴드로그램', nameEn: 'Dendrogram', category: 'hierarchy', alsoIn: ['multivariate'], keywords: ['계통수', '군집', '계층적 군집화', 'hierarchical clustering', '트리', 'linkage', 'cluster'], summary: '계층적 군집화가 관측을 하나씩 병합한 순서와 병합 거리를 나무 구조로 그립니다.', related: ['heatmap', 'pairplot', 'chord'] },
  // ── 통계·불확실성 ──
  { id: 'ci', name: '신뢰구간 그래프', nameEn: 'Confidence Interval Plot', category: 'uncertainty', alsoIn: ['comparison'], keywords: ['신뢰구간', '오차 막대', 'error bar', 't 분포', '추정', 'confidence interval', '표준오차', '부트스트랩'], summary: '그룹별 평균 같은 추정값과 그 신뢰구간을 함께 그려, 추정의 불확실성을 비교합니다.', related: ['box', 'raincloud', 'qq'] },
]

export const vizById = new Map(catalog.map((v) => [v.id, v]))

export const inCategory = (meta: VizMeta, category: CategoryId) => meta.category === category || !!meta.alsoIn?.includes(category)

const normalize = (s: string) => s.toLowerCase().replace(/[\s·/()-]/g, '')

/** Search Korean/English names and keywords; every whitespace-separated term must match. */
export function searchCatalog(query: string, category: CategoryId | 'all' = 'all', list: readonly VizMeta[] = catalog) {
  const terms = query.split(/\s+/).map(normalize).filter(Boolean)
  return list.filter((meta) => {
    if (category !== 'all' && !inCategory(meta, category)) return false
    if (!terms.length) return true
    const hay = [meta.name, meta.nameEn, ...meta.keywords, meta.id].map(normalize).join('|')
    return terms.every((t) => hay.includes(t))
  })
}
