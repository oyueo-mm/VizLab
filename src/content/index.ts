import { comparison } from './comparison'
import { comparisonV2, compositionV2 } from './comparisonV2'
import { distribution } from './distribution'
import { distributionV2 } from './distributionV2'
import { composition, multivariate, timeseries } from './other'
import { relationship } from './relationship'
import { hierarchyV2, timeseriesV2, uncertaintyV2 } from './timeHierarchyV2'
import { contentV3 } from './v3'
import { contentV4 } from './v4'
import { contentV5 } from './v5'
import { contentV6 } from './v6'
import { contentV7 } from './v7'
import type { VizContent } from './types'

export type { Formula, VizContent } from './types'

export const content: Record<string, VizContent> = {
  ...relationship, ...distribution, ...comparison, ...timeseries, ...composition, ...multivariate,
  ...distributionV2, ...comparisonV2, ...compositionV2, ...timeseriesV2, ...hierarchyV2, ...uncertaintyV2,
  ...contentV3, ...contentV4, ...contentV5, ...contentV6, ...contentV7,
}

/**
 * Short notes that separate the object being drawn from the way it is drawn (v0.7). The charts themselves are unchanged: these entries are
 * results of a computation, and the representation they use is a separate technique.
 */
const conceptNotes: Record<string, string> = {
  'mandelbrot-set': '분류: 분석·계산 결과. 망델브로 집합은 복소평면의 수학적 집합이고, 화면의 색은 점이 발산하기까지의 반복 횟수(탈출 시간)를 색에 대응시킨 표현입니다. 탈출 시간 채색은 줄리아 집합에도 쓰는 별개의 표현 방법입니다.',
  'julia-set': '분류: 분석·계산 결과. 줄리아 집합은 상수 c를 고정한 복소 동역학계에서 정의되는 집합으로 망델브로 집합과는 다른 수학적 대상입니다. 둘은 탈출 시간을 색에 대응시키는 같은 표현을 공유합니다.',
  'newton-fractal': '분류: 분석·계산 결과. 뉴턴 프랙탈은 뉴턴 반복법이 어느 근으로 수렴하는지(끌개 영역)와 수렴 속도를 색과 밝기로 나타낸 것으로, 집합 자체가 아니라 알고리즘의 수렴 특성을 그립니다.',
  'domain-coloring': '분류: 시각화 방법론. 복소수의 편각과 크기를 색상과 밝기에 대응시키는 표현 방법으로, 어떤 복소함수에도 적용할 수 있습니다.',
  tsne: '분류: 분석·계산 결과. 점 그림은 산점도이고, 위치를 정하는 t-SNE 최적화가 이 항목의 핵심입니다. 축의 값과 군집 사이 거리에는 의미를 두지 마세요.',
  umap: '분류: 분석·계산 결과. 표현은 산점도이고, 위치는 단순화한 UMAP 최적화가 정합니다.',
  'kriging-map': '분류: 분석·계산 결과. 크리깅은 공간 보간 알고리즘이며, 그 예측값을 등고선·래스터 같은 지도 표현으로 그립니다.',
  'strange-attractor': '분류: 분석·계산 결과. 특정 동역학계를 적분한 궤적을 3차원 선으로 그린 것입니다.',
  'efficient-frontier': '분류: 분석·계산 결과. 평균–분산 최적화의 해를 선으로 그린 것입니다.',
  'var-es-distribution': '분류: 분석·계산 결과. 시뮬레이션으로 얻은 손익 분포에 VaR·기대손실 선을 겹친 것입니다.',
}
for (const [id, note] of Object.entries(conceptNotes)) if (content[id]) content[id] = { ...content[id], note }
