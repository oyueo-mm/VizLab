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
  { id: 'other', name: '기타', description: '특수한 목적의 시각화' },
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
  { id: 'strip', name: '스트립 플롯', nameEn: 'Strip Plot', category: 'distribution', alsoIn: ['comparison'], keywords: ['지터', 'jitter', '스웜', 'beeswarm', '점', '도트'], summary: '그룹별로 모든 관측값을 점으로 늘어놓아 개별 값과 분포를 함께 보여줍니다.', related: ['box', 'violin', 'scatter'] },
  // 비교
  { id: 'bar', name: '막대그래프', nameEn: 'Bar Chart', category: 'comparison', keywords: ['막대', '범주', '순위', 'bar', 'column'], summary: '범주마다 하나의 값을 막대의 길이로 나타내 크기를 비교합니다.', related: ['grouped-bar', 'stacked-bar', 'pie'] },
  { id: 'grouped-bar', name: '그룹 막대그래프', nameEn: 'Grouped Bar Chart', category: 'comparison', keywords: ['묶음 막대', 'clustered', '두 범주', 'side by side'], summary: '두 범주형 변수의 조합마다 막대를 나란히 세워 그룹 안과 그룹 사이를 비교합니다.', related: ['bar', 'stacked-bar', 'heatmap'] },
  { id: 'stacked-bar', name: '누적 막대그래프', nameEn: 'Stacked Bar Chart', category: 'comparison', alsoIn: ['composition'], keywords: ['쌓기', '100%', '구성비', 'stacked'], summary: '한 막대 안에 하위 그룹의 값을 차례로 쌓아 전체 크기와 구성을 함께 보여줍니다.', related: ['grouped-bar', 'area', 'pie'] },
  // 시계열
  { id: 'line', name: '선그래프', nameEn: 'Line Chart', category: 'timeseries', keywords: ['추세', '시간', 'trend', '이동평균', 'line'], summary: '순서가 있는 x값(주로 시간)에 따라 값을 점으로 찍고 선으로 이어 변화의 흐름을 보여줍니다.', related: ['area', 'scatter', 'bar'] },
  { id: 'area', name: '영역 그래프', nameEn: 'Area Chart', category: 'timeseries', alsoIn: ['composition'], keywords: ['누적 영역', 'stacked area', '스트림그래프', 'streamgraph'], summary: '선그래프 아래를 채워 양을 강조하며, 여러 계열을 쌓아 전체와 부분의 변화를 함께 보여줍니다.', related: ['line', 'stacked-bar'] },
  // 비율·구성
  { id: 'pie', name: '원·도넛 차트', nameEn: 'Pie / Donut Chart', category: 'composition', keywords: ['파이', '도넛', '비율', '백분율', 'pie', 'donut', '부채꼴'], summary: '전체를 하나의 원으로 두고 각 범주가 차지하는 비율을 부채꼴의 각도로 나타냅니다.', related: ['treemap', 'stacked-bar', 'bar'] },
  { id: 'treemap', name: '트리맵', nameEn: 'Treemap', category: 'composition', keywords: ['계층', '사각형', 'hierarchy', 'squarify', '면적'], summary: '계층 구조의 각 항목을 값에 비례하는 넓이의 사각형으로 나누어 채웁니다.', related: ['pie', 'stacked-bar'] },
  // 다변량
  { id: 'heatmap', name: '히트맵', nameEn: 'Heatmap', category: 'multivariate', keywords: ['행렬', '색상', '상관 행렬', 'matrix', 'correlation'], summary: '행렬의 각 칸을 값에 대응하는 색으로 칠해 패턴과 군집을 한눈에 보여줍니다.', related: ['hexbin', 'pairplot', 'grouped-bar'] },
  { id: 'parallel', name: '평행좌표 그래프', nameEn: 'Parallel Coordinates', category: 'multivariate', keywords: ['평행 좌표', '다차원', '브러시', 'parallel coordinates'], summary: '여러 변수를 나란한 세로축으로 세우고 각 관측을 축을 가로지르는 꺾은선으로 그립니다.', related: ['pairplot', 'radar', 'heatmap'] },
  { id: 'radar', name: '레이더 차트', nameEn: 'Radar Chart', category: 'multivariate', alsoIn: ['comparison'], keywords: ['방사형', '거미줄', 'spider', 'star', '능력치'], summary: '여러 변수를 원형으로 배치한 축 위에 값을 찍고 이어 하나의 다각형으로 비교합니다.', related: ['parallel', 'bar'] },
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
