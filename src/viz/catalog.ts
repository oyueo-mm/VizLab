import type { CategoryId, DataKind, VizMeta } from './types'

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
  { id: 'geo', name: '지리공간', description: '지도 위에 값과 위치를 올리는 시각화' },
  { id: 'network', name: '관계·네트워크', description: '노드와 연결 관계를 여러 방식으로 배치' },
  { id: 'special', name: '특수·응용', description: '일정, 전환, 프로파일처럼 목적이 정해진 시각화' },
]

export interface DataKindDef {
  id: DataKind
  name: string
  description: string
}

export const dataKinds: DataKindDef[] = [
  { id: 'numeric', name: '수치형', description: '연속적인 숫자 값의 분포·관계' },
  { id: 'categorical', name: '범주형', description: '범주별 값과 비율' },
  { id: 'timeseries', name: '시계열', description: '날짜·시간에 따른 변화' },
  { id: 'multivariate', name: '다변량', description: '세 개 이상의 변수' },
  { id: 'hierarchical', name: '계층형', description: '부모–자식 구조' },
  { id: 'network', name: '네트워크·흐름형', description: '노드 사이의 연결과 흐름' },
  { id: 'geospatial', name: '지리공간', description: '위도·경도와 지역 경계' },
]

export const dataKindById = new Map(dataKinds.map((k) => [k.id, k]))

export const categoryById = new Map(categories.map((c) => [c.id, c]))

/** Metadata registry. Adding a chart = one entry here + a module in charts/ + content/. */
export const catalog: VizMeta[] = [
  // 관계
  { id: 'scatter', name: '산점도', nameEn: 'Scatter Plot', category: 'relationship', dataKinds: ['numeric'], keywords: ['상관', '회귀', '두 변수', 'correlation', 'regression', '점'], summary: '두 숫자형 변수를 가로·세로 좌표로 삼아 관측값 하나하나를 점으로 찍습니다.', related: ['bubble', 'hexbin', 'pairplot'] },
  { id: 'bubble', name: '버블 차트', nameEn: 'Bubble Chart', category: 'relationship', dataKinds: ['numeric', 'multivariate'], keywords: ['크기', '세 변수', '원', 'size'], summary: '산점도에 원의 크기라는 세 번째 변수를 더해 세 변수의 관계를 함께 보여줍니다.', related: ['scatter', 'hexbin'] },
  { id: 'hexbin', name: '헥스빈 플롯', nameEn: 'Hexbin Plot', category: 'relationship', alsoIn: ['distribution'], dataKinds: ['numeric'], keywords: ['밀도', '육각형', '대용량', '겹침', 'density', 'hexagon', '2d histogram'], summary: '평면을 육각형 칸으로 나누고 칸마다 들어간 점의 개수를 색으로 표현합니다.', related: ['scatter', 'heatmap', 'histogram'] },
  { id: 'pairplot', name: '페어 플롯', nameEn: 'Pair Plot', category: 'relationship', alsoIn: ['multivariate'], dataKinds: ['numeric', 'multivariate'], keywords: ['산점도 행렬', 'scatterplot matrix', 'splom', '변수 쌍'], summary: '여러 변수의 모든 쌍을 산점도 행렬로 늘어놓고 대각선에는 각 변수의 분포를 그립니다.', related: ['scatter', 'parallel', 'heatmap'] },
  // 분포
  { id: 'histogram', name: '히스토그램', nameEn: 'Histogram', category: 'distribution', dataKinds: ['numeric'], keywords: ['구간', '도수', 'bin', '빈도', 'frequency', '밀도'], summary: '값의 범위를 같은 폭의 구간(bin)으로 나누고 구간마다 들어간 관측 수를 막대로 그립니다.', related: ['kde', 'ecdf', 'box'] },
  { id: 'kde', name: 'KDE 플롯', nameEn: 'Kernel Density Estimate', category: 'distribution', dataKinds: ['numeric'], keywords: ['커널', '밀도 추정', 'bandwidth', '대역폭', 'density'], summary: '각 관측값에 작은 커널 곡선을 얹고 모두 더해 매끄러운 확률밀도 곡선을 추정합니다.', related: ['histogram', 'violin', 'ecdf'] },
  { id: 'ecdf', name: 'ECDF 플롯', nameEn: 'Empirical CDF', category: 'distribution', dataKinds: ['numeric'], keywords: ['누적', '경험분포', '누적분포함수', 'cumulative', '백분위'], summary: '각 값 이하인 관측의 비율을 계단 모양으로 누적해, 분포 전체를 구간 설정 없이 보여줍니다.', related: ['histogram', 'kde', 'box'] },
  { id: 'box', name: '박스 플롯', nameEn: 'Box Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['사분위수', '이상치', 'IQR', '수염', 'whisker', 'quartile', 'outlier', '상자 수염'], summary: '사분위수로 상자를 만들고 수염과 이상치로 분포의 중심·퍼짐·극단값을 요약합니다.', related: ['violin', 'strip', 'histogram'] },
  { id: 'violin', name: '바이올린 플롯', nameEn: 'Violin Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['밀도', '커널', 'kde', '그룹 비교'], summary: '그룹마다 커널 밀도 곡선을 좌우 대칭으로 그려 분포의 모양을 비교합니다.', related: ['box', 'kde', 'strip'] },
  { id: 'strip', name: '스트립 플롯', nameEn: 'Strip Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['지터', 'jitter', '점', '도트', 'dot plot'], summary: '그룹별로 모든 관측값을 점으로 늘어놓아 개별 값과 분포를 함께 보여줍니다.', related: ['beeswarm', 'box', 'violin'] },
  // 비교
  { id: 'bar', name: '막대그래프', nameEn: 'Bar Chart', category: 'comparison', dataKinds: ['categorical'], keywords: ['막대', '범주', '순위', 'bar', 'column'], summary: '범주마다 하나의 값을 막대의 길이로 나타내 크기를 비교합니다.', related: ['grouped-bar', 'stacked-bar', 'pie'] },
  { id: 'grouped-bar', name: '그룹 막대그래프', nameEn: 'Grouped Bar Chart', category: 'comparison', dataKinds: ['categorical'], keywords: ['묶음 막대', 'clustered', '두 범주', 'side by side'], summary: '두 범주형 변수의 조합마다 막대를 나란히 세워 그룹 안과 그룹 사이를 비교합니다.', related: ['bar', 'stacked-bar', 'heatmap'] },
  { id: 'stacked-bar', name: '누적 막대그래프', nameEn: 'Stacked Bar Chart', category: 'comparison', alsoIn: ['composition'], dataKinds: ['categorical'], keywords: ['쌓기', '구성', 'stacked'], summary: '한 막대 안에 하위 그룹의 값을 차례로 쌓아 전체 크기와 구성을 함께 보여줍니다.', related: ['stacked-bar-100', 'grouped-bar', 'waffle'] },
  // 시계열
  { id: 'line', name: '선그래프', nameEn: 'Line Chart', category: 'timeseries', dataKinds: ['timeseries', 'numeric'], keywords: ['추세', '시간', 'trend', '이동평균', 'line'], summary: '순서가 있는 x값(주로 시간)에 따라 값을 점으로 찍고 선으로 이어 변화의 흐름을 보여줍니다.', related: ['area', 'scatter', 'bar'] },
  { id: 'area', name: '영역 그래프', nameEn: 'Area Chart', category: 'timeseries', alsoIn: ['composition'], dataKinds: ['timeseries'], keywords: ['채우기', 'area', '면적'], summary: '선그래프 아래를 채워 양을 강조하며, 여러 계열을 쌓아 전체와 부분의 변화를 함께 보여줍니다.', related: ['line', 'stacked-area', 'streamgraph'] },
  // 비율·구성
  { id: 'pie', name: '원·도넛 차트', nameEn: 'Pie / Donut Chart', category: 'composition', dataKinds: ['categorical'], keywords: ['파이', '도넛', '비율', '백분율', 'pie', 'donut', '부채꼴'], summary: '전체를 하나의 원으로 두고 각 범주가 차지하는 비율을 부채꼴의 각도로 나타냅니다.', related: ['treemap', 'stacked-bar', 'bar'] },
  { id: 'treemap', name: '트리맵', nameEn: 'Treemap', category: 'composition', alsoIn: ['hierarchy'], dataKinds: ['hierarchical', 'categorical'], keywords: ['계층', '사각형', 'hierarchy', 'squarify', '면적'], summary: '계층 구조의 각 항목을 값에 비례하는 넓이의 사각형으로 나누어 채웁니다.', related: ['sunburst', 'pack', 'pie'] },
  // 다변량
  { id: 'heatmap', name: '히트맵', nameEn: 'Heatmap', category: 'multivariate', dataKinds: ['multivariate', 'categorical'], keywords: ['행렬', '색상', '상관 행렬', 'matrix', 'correlation'], summary: '행렬의 각 칸을 값에 대응하는 색으로 칠해 패턴과 군집을 한눈에 보여줍니다.', related: ['hexbin', 'pairplot', 'grouped-bar'] },
  { id: 'parallel', name: '평행좌표 그래프', nameEn: 'Parallel Coordinates', category: 'multivariate', dataKinds: ['multivariate'], keywords: ['평행 좌표', '다차원', '브러시', 'parallel coordinates'], summary: '여러 변수를 나란한 세로축으로 세우고 각 관측을 축을 가로지르는 꺾은선으로 그립니다.', related: ['pairplot', 'radar', 'heatmap'] },
  { id: 'radar', name: '레이더 차트', nameEn: 'Radar Chart', category: 'multivariate', alsoIn: ['comparison'], dataKinds: ['multivariate'], keywords: ['방사형', '거미줄', 'spider', 'star', '능력치'], summary: '여러 변수를 원형으로 배치한 축 위에 값을 찍고 이어 하나의 다각형으로 비교합니다.', related: ['parallel', 'bar'] },

  // ── 분포 (v0.2) ──
  { id: 'ridgeline', name: '릿지라인 플롯', nameEn: 'Ridgeline Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['조이플롯', 'joyplot', '능선', '밀도', 'kde', '그룹 비교', '겹친 밀도'], summary: '여러 그룹의 커널 밀도 곡선을 세로로 조금씩 겹쳐 쌓아 분포의 변화를 한 화면에서 비교합니다.', related: ['kde', 'violin', 'raincloud'] },
  { id: 'raincloud', name: '레인클라우드 플롯', nameEn: 'Raincloud Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['반쪽 바이올린', 'half violin', '구름', '비', '박스', '원자료'], summary: '반쪽 바이올린(구름), 박스 플롯, 개별 관측점(비)을 나란히 그려 요약과 원자료를 함께 보여줍니다.', related: ['violin', 'box', 'beeswarm'] },
  { id: 'beeswarm', name: '스웜 플롯', nameEn: 'Beeswarm Plot', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['비스웜', '벌떼', 'swarm', '충돌 회피', '점 배치'], summary: '관측값마다 점을 찍되 점끼리 겹치지 않도록 옆으로 밀어내 배치해, 개별 값과 분포 모양을 함께 보여줍니다.', related: ['strip', 'raincloud', 'histogram'] },
  { id: 'qq', name: 'Q-Q 플롯', nameEn: 'Q-Q Plot', category: 'distribution', alsoIn: ['uncertainty'], dataKinds: ['numeric'], keywords: ['분위수', 'quantile', '정규성', '정규 확률 그림', 'normal probability', 'qq'], summary: '표본의 분위수를 기준 분포의 이론적 분위수와 짝지어 찍어, 데이터가 그 분포를 따르는지 점검합니다.', related: ['ecdf', 'histogram', 'kde'] },
  // ── 비교 (v0.2) ──
  { id: 'lollipop', name: '롤리팝 차트', nameEn: 'Lollipop Chart', category: 'comparison', dataKinds: ['categorical'], keywords: ['막대 사탕', '점 막대', 'stem', '순위'], summary: '막대 대신 가는 선과 끝점으로 범주별 값을 표시해, 범주가 많을 때도 깔끔하게 크기를 비교합니다.', related: ['bar', 'dumbbell', 'slope'] },
  { id: 'dumbbell', name: '덤벨 차트', nameEn: 'Dumbbell Chart', category: 'comparison', dataKinds: ['categorical'], keywords: ['아령', '두 값', '차이', 'gap', '전후 비교', 'connected dot'], summary: '항목마다 두 값을 점으로 찍고 선으로 이어, 두 시점·조건 사이의 차이와 방향을 비교합니다.', related: ['slope', 'lollipop', 'grouped-bar'] },
  { id: 'slope', name: '슬로프 차트', nameEn: 'Slope Chart', category: 'comparison', alsoIn: ['timeseries'], dataKinds: ['categorical'], keywords: ['기울기', '전후', '변화', 'before after', '두 시점'], summary: '두 시점(조건)의 값을 양쪽 축에 찍고 직선으로 이어, 기울기로 증가·감소와 순위 변화를 보여줍니다.', related: ['dumbbell', 'bump', 'line'] },
  { id: 'waterfall', name: '워터폴 차트', nameEn: 'Waterfall Chart', category: 'comparison', alsoIn: ['composition'], dataKinds: ['categorical'], keywords: ['폭포', '증감', '누적 변화', 'bridge', '손익'], summary: '시작값에 양·음의 변화를 차례로 더해 가며 떠 있는 막대로 그려, 최종값이 만들어진 과정을 보여줍니다.', related: ['bar', 'stacked-bar', 'lollipop'] },
  // ── 비율·구성 (v0.2) ──
  { id: 'stacked-bar-100', name: '100% 누적 막대그래프', nameEn: '100% Stacked Bar Chart', category: 'composition', alsoIn: ['comparison'], dataKinds: ['categorical'], keywords: ['백분율', '구성비', '비율', 'percent', 'normalized', '100%'], summary: '막대마다 합계를 100%로 맞추고 하위 그룹의 비율을 쌓아, 범주 사이의 구성 비율을 비교합니다.', related: ['stacked-bar', 'waffle', 'pie'] },
  { id: 'waffle', name: '와플 차트', nameEn: 'Waffle Chart', category: 'composition', dataKinds: ['categorical'], keywords: ['격자', '100칸', '단위 차트', '정사각 비율', 'unit chart'], summary: '전체를 같은 크기의 칸(보통 10×10)으로 나누고 범주의 비율만큼 칸을 칠해 구성 비율을 셀 수 있게 보여줍니다.', related: ['pie', 'stacked-bar-100', 'treemap'] },
  // ── 시계열 (v0.2) ──
  { id: 'stacked-area', name: '누적 영역 그래프', nameEn: 'Stacked Area Chart', category: 'timeseries', alsoIn: ['composition'], dataKinds: ['timeseries'], keywords: ['누적 영역', 'stacked area', '쌓기', '합계 추세'], summary: '여러 계열의 값을 시점마다 차례로 쌓아 영역으로 채워, 전체 합계의 추세와 계열별 기여를 함께 보여줍니다.', related: ['area', 'streamgraph', 'stacked-bar'] },
  { id: 'streamgraph', name: '스트림그래프', nameEn: 'Streamgraph', category: 'timeseries', alsoIn: ['composition'], dataKinds: ['timeseries'], keywords: ['스트림', 'stream', 'wiggle', '실루엣', 'silhouette', '흐름', 'themeriver'], summary: '누적 영역의 기준선을 가운데로 옮기고 흔들림을 최소화해, 여러 계열의 흐름을 물줄기처럼 보여줍니다.', related: ['stacked-area', 'area', 'bump'] },
  { id: 'bump', name: '범프 차트', nameEn: 'Bump Chart', category: 'timeseries', alsoIn: ['comparison'], dataKinds: ['timeseries', 'categorical'], keywords: ['순위', 'rank', '등수', '순위 변화', '랭킹'], summary: '시점마다 항목의 순위를 매기고 순위끼리 선으로 이어 시간에 따른 순위 변화를 보여줍니다.', related: ['slope', 'line', 'streamgraph'] },
  { id: 'calendar', name: '캘린더 히트맵', nameEn: 'Calendar Heatmap', category: 'timeseries', dataKinds: ['timeseries'], keywords: ['달력', '날짜', '일별', 'github', '잔디', 'calendar'], summary: '날짜마다 하나의 칸을 달력처럼 주·요일 격자에 배치하고 값을 색으로 칠해 일별 패턴을 보여줍니다.', related: ['heatmap', 'line', 'bump'] },
  // ── 계층·흐름 ──
  { id: 'sunburst', name: '선버스트 차트', nameEn: 'Sunburst Chart', category: 'hierarchy', alsoIn: ['composition'], dataKinds: ['hierarchical'], keywords: ['동심원', '방사형 트리맵', '계층', '부채꼴', 'partition', 'radial'], summary: '계층의 깊이를 동심원 고리로, 각 항목의 크기를 부채꼴의 각도로 나타내는 방사형 계층 그래프입니다.', related: ['treemap', 'pack', 'pie'] },
  { id: 'pack', name: '원 패킹', nameEn: 'Circle Packing', category: 'hierarchy', alsoIn: ['composition'], dataKinds: ['hierarchical'], keywords: ['서클 패킹', '원 채우기', '버블 계층', 'circle packing', '중첩 원'], summary: '계층 구조를 원 안에 원을 겹치지 않게 채워 넣어 표현하며, 가장 안쪽 원의 넓이가 값에 비례합니다.', related: ['treemap', 'sunburst', 'bubble'] },
  { id: 'sankey', name: '생키 다이어그램', nameEn: 'Sankey Diagram', category: 'hierarchy', alsoIn: ['network'], dataKinds: ['network'], keywords: ['흐름', 'flow', '에너지 흐름', '유입', '전환', '경로', 'alluvial'], summary: '노드 사이의 흐름을 폭이 양에 비례하는 띠로 이어, 무엇이 어디로 얼마나 흘러가는지 보여줍니다.', related: ['chord', 'treemap', 'waterfall'] },
  { id: 'chord', name: '코드 다이어그램', nameEn: 'Chord Diagram', category: 'hierarchy', alsoIn: ['relationship', 'network'], dataKinds: ['network'], keywords: ['현', '관계 행렬', '원형 연결', 'matrix', '이동', '네트워크'], summary: '그룹을 원 둘레의 호로 놓고 관계 행렬의 값을 두 호를 잇는 리본의 폭으로 나타내 상호 관계를 보여줍니다.', related: ['sankey', 'heatmap', 'dendrogram'] },
  { id: 'dendrogram', name: '덴드로그램', nameEn: 'Dendrogram', category: 'hierarchy', alsoIn: ['multivariate'], dataKinds: ['hierarchical', 'multivariate'], keywords: ['계통수', '군집', '계층적 군집화', 'hierarchical clustering', '트리', 'linkage', 'cluster'], summary: '계층적 군집화가 관측을 하나씩 병합한 순서와 병합 거리를 나무 구조로 그립니다.', related: ['heatmap', 'pairplot', 'chord'] },
  // ── 통계·불확실성 ──
  { id: 'ci', name: '신뢰구간 그래프', nameEn: 'Confidence Interval Plot', category: 'uncertainty', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['신뢰구간', '오차 막대', 'error bar', 't 분포', '추정', 'confidence interval', '표준오차', '부트스트랩'], summary: '그룹별 평균 같은 추정값과 그 신뢰구간을 함께 그려, 추정의 불확실성을 비교합니다.', related: ['box', 'raincloud', 'qq'] },
  // ── v0.3 ──
  { id: 'kde2d', name: '2차원 KDE', nameEn: '2D KDE / Density Contour Plot', category: 'relationship', alsoIn: ['distribution'], dataKinds: ['numeric'], keywords: ['밀도 등고선', '결합 분포', '이변량', 'bivariate', 'contour', 'density', '커널', 'bandwidth'], summary: '두 변수의 결합 분포를 2차원 커널 밀도로 추정하고, 같은 밀도의 지점을 이은 등고선이나 색으로 보여줍니다.', related: ['scatter', 'hexbin', 'kde'] },
  { id: 'pp', name: 'P-P 플롯', nameEn: 'Probability–Probability Plot', category: 'distribution', alsoIn: ['uncertainty'], dataKinds: ['numeric'], keywords: ['누적확률', '확률 그림', '적합도', 'probability', 'cdf', '정규성'], summary: '표본의 경험적 누적확률을 기준 분포의 누적확률과 짝지어 찍어, 분포가 얼마나 잘 맞는지 점검합니다.', related: ['qq', 'ecdf', 'histogram'] },
  { id: 'letter-value', name: '레터 밸류 플롯', nameEn: 'Letter-Value Plot (Boxen)', category: 'distribution', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['박스엔', 'boxen', '분위수', '꼬리', 'letter value', '사분위수 확장', 'quantile'], summary: '중앙값에서 바깥으로 1/4, 1/8, 1/16… 분위수를 단계별 상자로 쌓아, 큰 표본의 꼬리까지 보여주는 박스 플롯의 확장입니다.', related: ['box', 'violin', 'raincloud'] },
  { id: 'connected-scatter', name: '연결 산점도', nameEn: 'Connected Scatter Plot', category: 'relationship', alsoIn: ['timeseries'], dataKinds: ['numeric', 'timeseries'], keywords: ['경로', '궤적', '시간 순서', 'path', 'trajectory', '이동 경로'], summary: '시간이나 순서대로 두 변수의 값을 점으로 찍고 선으로 이어, 두 변수가 함께 움직인 경로를 보여줍니다.', related: ['scatter', 'line', 'slope'] },
  { id: 'pca-biplot', name: 'PCA 바이플롯', nameEn: 'PCA Biplot', category: 'multivariate', alsoIn: ['relationship'], dataKinds: ['multivariate'], keywords: ['주성분', '주성분 분석', '차원 축소', 'pca', 'principal component', '고유값', '적재량'], summary: '여러 변수를 주성분 2개로 줄여 관측값을 점으로, 변수의 기여 방향을 화살표로 한 평면에 함께 그립니다.', related: ['pairplot', 'parallel', 'andrews'] },
  { id: 'andrews', name: '앤드루스 곡선', nameEn: 'Andrews Curves', category: 'multivariate', dataKinds: ['multivariate'], keywords: ['푸리에', '다변량 곡선', 'andrews', 'fourier', '삼각함수', '군집 곡선'], summary: '각 관측값의 변수들을 푸리에 급수의 계수로 삼아 하나의 곡선으로 바꾸고, 비슷한 관측값은 비슷한 곡선이 되게 합니다.', related: ['parallel', 'radar', 'pca-biplot'] },
  { id: 'pyramid', name: '인구 피라미드', nameEn: 'Population Pyramid', category: 'comparison', alsoIn: ['composition'], dataKinds: ['categorical'], keywords: ['연령', '좌우 막대', '양방향 막대', 'population', 'butterfly', '나비 차트', '구성비'], summary: '두 집단의 값을 가운데 축을 기준으로 좌우로 마주 보는 막대로 세워 범주별 구성을 한눈에 비교합니다.', related: ['grouped-bar', 'bar', 'stacked-bar-100'] },
  { id: 'pareto', name: '파레토 차트', nameEn: 'Pareto Chart', category: 'comparison', alsoIn: ['composition'], dataKinds: ['categorical'], keywords: ['누적 비율', '80/20', '핵심 소수', '불량', 'pareto', '품질', 'abc'], summary: '항목을 큰 순서로 막대로 세우고 누적 비율 선을 겹쳐, 전체의 대부분을 차지하는 소수의 항목을 찾아냅니다.', related: ['bar', 'waterfall', 'pie'] },
  { id: 'bullet', name: '불릿 차트', nameEn: 'Bullet Chart', category: 'comparison', dataKinds: ['categorical'], keywords: ['목표', '성과 지표', 'kpi', 'bullet', '게이지 대체', '달성률'], summary: '실제 측정값을 막대로, 목표를 눈금으로, 나쁨~좋음 구간을 배경 띠로 겹쳐 한 줄에 성과를 평가합니다.', related: ['bar', 'lollipop', 'dumbbell'] },
  { id: 'step', name: '스텝 플롯', nameEn: 'Step Plot', category: 'timeseries', dataKinds: ['timeseries'], keywords: ['계단', '계단 그래프', 'step', '이산 변화', '재고', '요금'], summary: '값이 바뀌는 시점에만 변하고 그 사이에는 일정하게 유지되는 계단 모양의 시계열 그래프입니다.', related: ['line', 'area', 'bump'] },
  { id: 'candlestick', name: '캔들스틱 차트', nameEn: 'Candlestick Chart', category: 'timeseries', dataKinds: ['timeseries'], keywords: ['봉차트', '주가', 'ohlc', '시가', '종가', '고가', '저가', 'candle', '금융', '거래량'], summary: '기간마다 시가·고가·저가·종가를 몸통과 꼬리가 있는 캔들 하나로 나타내 가격의 움직임을 보여줍니다.', related: ['line', 'step', 'box'] },
  { id: 'horizon', name: '호라이즌 차트', nameEn: 'Horizon Chart', category: 'timeseries', alsoIn: ['multivariate'], dataKinds: ['timeseries'], keywords: ['지평선', '접힌 영역', 'horizon', '압축 시계열', '밴드', '여러 계열'], summary: '시계열의 값 범위를 여러 구간으로 나눠 색 농도가 다른 층으로 겹쳐 접어, 좁은 높이에 여러 계열을 압축해 비교합니다.', related: ['line', 'area', 'stacked-area'] },
  { id: 'mosaic', name: '모자이크 플롯', nameEn: 'Mosaic Plot', category: 'composition', alsoIn: ['multivariate'], dataKinds: ['categorical'], keywords: ['교차표', '마리메코', 'marimekko', '범주 교차', 'contingency', '카이제곱', '독립성'], summary: '범주형 변수들의 교차 빈도를 직사각형의 넓이로 나타내, 변수 사이의 연관성을 비율로 보여줍니다.', related: ['stacked-bar-100', 'heatmap', 'treemap'] },
  { id: 'icicle', name: '아이시클 차트', nameEn: 'Icicle Chart', category: 'hierarchy', alsoIn: ['composition'], dataKinds: ['hierarchical'], keywords: ['고드름', '파티션', 'partition', '계층 띠', '플레임', 'flame'], summary: '계층의 깊이를 한 방향으로, 값의 크기를 다른 방향의 길이로 나타낸 직사각형 띠를 이어 붙인 계층 차트입니다.', related: ['treemap', 'sunburst', 'pack'] },
  { id: 'network', name: '네트워크 그래프', nameEn: 'Network Graph', category: 'hierarchy', alsoIn: ['relationship', 'network'], dataKinds: ['network'], keywords: ['노드', '간선', '연결망', '힘 기반', 'force', 'graph', '관계망', '소셜'], summary: '노드를 점으로, 연결을 선으로 그리고 힘 기반 시뮬레이션으로 배치해 연결 구조와 군집을 드러냅니다.', related: ['chord', 'arc', 'sankey'] },
  { id: 'arc', name: '아크 다이어그램', nameEn: 'Arc Diagram', category: 'hierarchy', alsoIn: ['relationship', 'network'], dataKinds: ['network'], keywords: ['호', '직선 배치', 'arc', '연결 호', '노드 순서', '관계'], summary: '노드를 한 직선 위에 늘어놓고 연결을 호로 이어, 순서에 따른 연결 패턴을 겹침 없이 보여줍니다.', related: ['network', 'chord', 'sankey'] },
  { id: 'alluvial', name: '올루비얼 다이어그램', nameEn: 'Alluvial Diagram', category: 'hierarchy', alsoIn: ['composition', 'network'], dataKinds: ['network', 'categorical'], keywords: ['충적', '단계별 이동', '범주 이동', 'alluvial', '구성 변화', '다단계', '경로'], summary: '여러 단계에서 집단의 구성이 어떻게 바뀌는지, 같은 대상이 단계마다 어느 범주로 옮겨 가는지 흐름으로 보여줍니다.', related: ['sankey', 'stacked-bar-100', 'bump'] },
  { id: 'roc', name: 'ROC 곡선', nameEn: 'Receiver Operating Characteristic Curve', category: 'uncertainty', dataKinds: ['numeric'], keywords: ['분류기', 'auc', '임계값', 'tpr', 'fpr', '민감도', '특이도', 'roc', '이진 분류'], summary: '이진 분류기의 임계값을 바꿀 때마다 참양성률과 거짓양성률이 어떻게 변하는지 곡선으로 보여줍니다.', related: ['pr', 'ecdf', 'histogram'] },
  { id: 'pr', name: 'Precision–Recall 곡선', nameEn: 'Precision–Recall Curve', category: 'uncertainty', dataKinds: ['numeric'], keywords: ['정밀도', '재현율', 'average precision', 'ap', '불균형', 'precision', 'recall', '분류기'], summary: '임계값에 따른 정밀도와 재현율의 관계를 곡선으로 그려, 양성이 드문 불균형 데이터에서 분류기를 평가합니다.', related: ['roc', 'ecdf', 'histogram'] },
  { id: 'fan', name: '팬 차트', nameEn: 'Fan Chart', category: 'uncertainty', alsoIn: ['timeseries'], dataKinds: ['timeseries'], keywords: ['예측구간', '불확실성', '부채꼴', 'fan', '예측', 'forecast', '밴드'], summary: '예측값 주위에 50%·80%·95% 예측구간을 겹겹의 띠로 펼쳐, 먼 미래일수록 커지는 불확실성을 보여줍니다.', related: ['line', 'ci', 'area'] },
  // ── v0.4 ──
  { id: 'choropleth', name: '코로플레스 지도', nameEn: 'Choropleth Map', category: 'geo', dataKinds: ['geospatial'], keywords: ['단계구분도', '지도', '행정구역', '지역별', '국가별', '시도별', '색상 지도', 'choropleth', 'map', 'region'], summary: '국가나 행정구역의 경계를 그대로 두고 지역별 수치를 색의 진하기로 칠해, 값이 공간에서 어떻게 분포하는지 보여줍니다.', related: ['symbol-map', 'tile-grid', 'dorling'] },
  { id: 'symbol-map', name: '비례 심벌 지도', nameEn: 'Proportional Symbol Map', category: 'geo', dataKinds: ['geospatial', 'numeric'], keywords: ['원 크기', '버블 지도', '위도 경도', '좌표', '심벌', 'bubble map', 'proportional symbol', 'point map'], summary: '위도·경도로 정한 위치마다 값에 비례하는 넓이의 원을 올려, 지역 경계와 무관하게 위치별 크기를 비교합니다.', related: ['choropleth', 'dorling', 'geo-hexbin'] },
  { id: 'dot-density', name: '점 밀도 지도', nameEn: 'Dot Density Map', category: 'geo', dataKinds: ['geospatial'], keywords: ['점 지도', '밀도 지도', '점 하나', 'dot map', 'dot density', '분포 지도'], summary: '지역의 값을 일정 수량을 대표하는 점들로 바꿔 그 지역 안에 흩뿌려, 많고 적음을 점의 빽빽함으로 보여줍니다.', related: ['choropleth', 'geo-hexbin', 'symbol-map'] },
  { id: 'geo-hexbin', name: '지리적 헥스빈 지도', nameEn: 'Geographic Hexbin Map', category: 'geo', alsoIn: ['relationship'], dataKinds: ['geospatial', 'numeric'], keywords: ['육각형 지도', '위치 집계', '위도 경도', '격자 집계', 'geo hexbin', 'hexagon map', '공간 빈'], summary: '위도·경도로 찍힌 점들을 육각형 칸에 모아 세어, 점이 많아 겹치는 지도에서도 밀집 지역을 드러냅니다.', related: ['hexbin', 'dot-density', 'symbol-map'] },
  { id: 'flow-map', name: '흐름 지도', nameEn: 'Flow Map', category: 'geo', alsoIn: ['network'], dataKinds: ['geospatial', 'network'], keywords: ['이동량', '출발 도착', '연결선', '유입 유출', '항공', '이동 지도', 'flow map', 'od', 'migration'], summary: '출발지와 도착지를 지도 위의 선으로 이어 이동량을 선의 굵기로 나타내고, 어디서 어디로 얼마나 움직이는지 보여줍니다.', related: ['sankey', 'chord', 'symbol-map'] },
  { id: 'tile-grid', name: '타일 그리드 지도', nameEn: 'Tile Grid Map', category: 'geo', dataKinds: ['geospatial', 'categorical'], keywords: ['타일 지도', '정사각형 지도', '격자 지도', 'tile map', 'tilegram', '면적 왜곡'], summary: '지역마다 같은 크기의 타일 하나를 배정하고 실제 위치와 비슷하게 늘어놓아, 면적 왜곡 없이 모든 지역을 공평하게 비교합니다.', related: ['choropleth', 'dorling', 'waffle'] },
  { id: 'dorling', name: '도를링 카토그램', nameEn: 'Dorling Cartogram', category: 'geo', dataKinds: ['geospatial', 'numeric'], keywords: ['카토그램', '원형 카토그램', '면적 변형', 'cartogram', 'dorling', '충돌 방지'], summary: '지역을 값에 비례하는 넓이의 원으로 바꾸고 원끼리 겹치지 않게 밀어내, 땅 크기가 아니라 값의 크기로 지도를 다시 그립니다.', related: ['symbol-map', 'choropleth', 'pack'] },
  { id: 'forest', name: '포레스트 플롯', nameEn: 'Forest Plot', category: 'uncertainty', alsoIn: ['comparison'], dataKinds: ['numeric', 'categorical'], keywords: ['메타분석', '효과크기', '오즈비', '위험비', '통합 효과', '이질성', 'forest plot', 'meta-analysis', 'odds ratio'], summary: '연구마다 효과크기와 오차 범위를 가로선으로 나란히 놓고 마지막에 통합 효과를 마름모로 더해, 여러 연구의 결과를 한눈에 종합합니다.', related: ['ci', 'funnel-plot', 'dumbbell'] },
  { id: 'bland-altman', name: '블랜드-알트만 플롯', nameEn: 'Bland–Altman Plot', category: 'uncertainty', alsoIn: ['relationship'], dataKinds: ['numeric'], keywords: ['일치도', '측정 방법 비교', '일치한계', '편향', '두 측정', 'bland altman', 'agreement', 'limits of agreement'], summary: '두 측정 방법의 차이를 평균에 대해 그리고 평균 차이와 일치한계를 그어, 두 방법이 서로 바꿔 써도 될 만큼 일치하는지 평가합니다.', related: ['scatter', 'qq', 'ci'] },
  { id: 'calibration', name: '보정 곡선', nameEn: 'Calibration Plot', category: 'uncertainty', dataKinds: ['numeric'], keywords: ['신뢰도 다이어그램', '예측확률', '보정', '신뢰도', 'reliability diagram', 'calibration', 'ece', 'brier'], summary: '모델이 말한 확률과 실제로 일어난 비율을 구간별로 비교해, 예측확률을 문자 그대로 믿어도 되는지 확인합니다.', related: ['roc', 'pr', 'ecdf'] },
  { id: 'control', name: '관리도', nameEn: 'Control Chart', category: 'uncertainty', alsoIn: ['timeseries'], dataKinds: ['timeseries', 'numeric'], keywords: ['공정 관리', '관리한계', '품질', '이상 신호', 'spc', 'control chart', 'shewhart', 'x-bar', 'i-mr'], summary: '시간 순서대로 측정값을 찍고 공정 자체의 변동에서 계산한 중심선과 관리한계를 그어, 공정이 안정적인지 이상 신호를 찾습니다.', related: ['line', 'step', 'ci'] },
  { id: 'funnel-plot', name: '퍼널 플롯', nameEn: 'Funnel Plot', category: 'uncertainty', dataKinds: ['numeric'], keywords: ['깔때기 그림', '출판 편향', '비대칭', '정밀도', 'funnel plot', 'egger', 'publication bias', '메타분석', 'meta-analysis'], summary: '연구마다 효과크기를 가로로, 정밀도(표준오차)를 세로로 찍고 기대 범위를 깔때기로 그어, 작은 연구가 한쪽으로 치우쳤는지 살핍니다.', related: ['forest', 'scatter', 'ci'] },
  { id: 'gantt', name: '간트 차트', nameEn: 'Gantt Chart', category: 'special', alsoIn: ['timeseries'], dataKinds: ['timeseries', 'categorical'], keywords: ['일정', '프로젝트', '작업 기간', '선행 작업', '타임라인', 'gantt', 'schedule', 'timeline'], summary: '작업마다 시작일부터 종료일까지의 가로 띠를 시간축 위에 놓고 선행 관계를 이어, 프로젝트 일정과 겹침을 한눈에 보여줍니다.', related: ['step', 'bullet', 'waterfall'] },
  { id: 'funnel', name: '퍼널 차트', nameEn: 'Funnel Chart', category: 'special', alsoIn: ['comparison'], dataKinds: ['categorical'], keywords: ['전환율', '이탈률', '단계별 전환', '깔때기 차트', '전환 퍼널', 'funnel chart', 'conversion', 'drop-off'], summary: '단계마다 남은 수를 위에서 아래로 좁아지는 도형으로 쌓아, 어느 단계에서 얼마나 이탈하는지 전환율과 함께 보여줍니다.', related: ['bar', 'waterfall', 'sankey'] },
  { id: 'marimekko', name: '마리메코 차트', nameEn: 'Marimekko Chart', category: 'special', alsoIn: ['composition'], dataKinds: ['categorical'], keywords: ['가변 너비', '시장 규모', '2차원 구성', '시장 점유율', 'marimekko', 'mekko', 'variable width'], summary: '범주의 전체 크기를 너비로, 범주 안의 구성비를 높이로 표현해, 사각형 면적이 전체에서 차지하는 몫과 같아지는 구성 차트입니다.', related: ['mosaic', 'stacked-bar-100', 'treemap'] },
  { id: 'flame', name: '플레임 그래프', nameEn: 'Flame Graph', category: 'special', alsoIn: ['hierarchy'], dataKinds: ['hierarchical'], keywords: ['프로파일링', '호출 스택', '함수', '성능', 'cpu', '병목', 'flame graph', 'flamegraph', 'profile', 'stack trace'], summary: '함수 호출 관계를 쌓은 층으로 그리고 각 함수의 너비를 누적 비용으로 나타내, 프로그램의 시간이 어디에 쓰이는지 찾아냅니다.', related: ['icicle', 'treemap', 'sunburst'] },
  { id: 'adjacency', name: '인접 행렬 그래프', nameEn: 'Adjacency Matrix', category: 'network', alsoIn: ['relationship'], dataKinds: ['network'], keywords: ['연결 행렬', '관계 행렬', '노드 간선 행렬', '네트워크 행렬', 'adjacency matrix', 'matrix view', 'graph matrix'], summary: '노드를 행과 열에 같은 순서로 놓고 연결이 있는 칸을 칠해, 선이 엉키는 네트워크도 겹침 없이 읽을 수 있게 합니다.', related: ['network', 'heatmap', 'chord'] },
  { id: 'edge-bundling', name: '계층형 에지 번들링', nameEn: 'Hierarchical Edge Bundling', category: 'network', alsoIn: ['hierarchy'], dataKinds: ['network', 'hierarchical'], keywords: ['엣지 번들링', '연결선 묶기', '방사형 계층', '의존 관계', 'edge bundling', 'hierarchical edge bundling', 'dependency'], summary: '노드를 계층에 따라 원 둘레에 놓고 연결선을 계층 경로를 따라 휘게 묶어, 복잡한 연결을 큰 흐름으로 읽게 합니다.', related: ['network', 'chord', 'dendrogram'] },
  { id: 'bipartite', name: '이분 그래프', nameEn: 'Bipartite Graph', category: 'network', dataKinds: ['network', 'categorical'], keywords: ['두 집합', '양쪽 노드', '소속 관계', '참여 관계', 'bipartite', 'two-mode', 'affiliation'], summary: '서로 다른 두 집합의 노드를 양쪽에 세우고 집합 사이의 연결만 이어, 누가 무엇에 속하는지 같은 관계를 보여줍니다.', related: ['network', 'sankey', 'adjacency'] },
  { id: 'hive', name: '하이브 플롯', nameEn: 'Hive Plot', category: 'network', dataKinds: ['network'], keywords: ['축 배치', '결정적 레이아웃', '노드 속성', 'hive plot', 'hive', 'rule-based layout'], summary: '노드의 속성으로 어느 축에, 축의 어디에 놓일지 규칙으로 정하고 연결을 곡선으로 이어, 같은 데이터가 늘 같은 모양이 되는 네트워크 그림입니다.', related: ['network', 'arc', 'adjacency'] },
]

export const vizById = new Map(catalog.map((v) => [v.id, v]))

export const inCategory = (meta: VizMeta, category: CategoryId) => meta.category === category || !!meta.alsoIn?.includes(category)

const normalize = (s: string) => s.toLowerCase().replace(/[\s·/()-]/g, '')

/**
 * Search Korean/English names and keywords; every whitespace-separated term must match.
 * The category and the data kinds are independent filters: a chart must be in the category
 * and support at least one of the selected data kinds.
 */
export function searchCatalog(query: string, category: CategoryId | 'all' = 'all', list: readonly VizMeta[] = catalog, kinds: readonly DataKind[] = []) {
  const terms = query.split(/\s+/).map(normalize).filter(Boolean)
  return list.filter((meta) => {
    if (category !== 'all' && !inCategory(meta, category)) return false
    if (kinds.length && !kinds.some((k) => meta.dataKinds.includes(k))) return false
    if (!terms.length) return true
    const hay = [meta.name, meta.nameEn, ...meta.keywords, meta.id].map(normalize).join('|')
    return terms.every((t) => hay.includes(t))
  })
}
