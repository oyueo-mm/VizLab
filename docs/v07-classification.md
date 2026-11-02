# VizLab v0.7 도감 분류 기준

v0.7부터 모든 도감 항목은 카테고리(분야)와 별개로 **성격**을 하나(주분류) 갖고, 필요하면 보조 성격을 가진다. 코드는 `src/viz/kinds.ts`에 있고, 차트 ID·URL·계산·데이터는 바뀌지 않았다(분류는 메타데이터 추가일 뿐이다).

## 네 가지 성격

| 성격 | 질문 | 판단 기준 |
|---|---|---|
| **시각화 방법론** (technique) | 데이터를 어떤 시각적 요소에 어떻게 대응시키는가? | 위치·길이·면적·색·연결·배치 규칙처럼 **여러 데이터·분야에 옮겨 쓸 수 있는 표현 원리**가 있다. 특정 알고리즘 결과에 종속되지 않는다. |
| **전문 도표** (specialized) | 이 도표를 읽는 분야의 관습이 있는가? | 특정 분야·목적(진단, 금융, 생물, 신뢰성 등)에서 **고유한 데이터 구조와 해석 체계**가 굳어진 형식. 기존 산점도·선그래프의 변형처럼 보여도 독립된 해석 체계가 있으면 제거하지 않고 이 성격으로 둔다. |
| **분석·계산 결과** (analysis) | 특정 알고리즘·수학적 대상을 실행한 결과를 그린 것인가? | 그림의 핵심이 **계산**(t-SNE 최적화, 크리깅, 망델브로 반복 등)이고, 표현 방법은 산점도·등고선·래스터 같은 기존 방식이다. |
| **응용 예제** (application) | 기존 표현을 특정 대상에 적용한 사례인가? | 새 표현 원리 없이 **한 분야의 대상**(분자, 결정, 이동 궤적, 호가 등)에 기존 기법을 쓴다. |

주분류는 한 항목에 하나만 붙으므로 전체 항목 수 = 네 성격의 주분류 합이다. 보조 성격(`kindAlso`)은 카탈로그 필터에서만 검색 범위를 넓히고 합계에는 들어가지 않는다. 그래서 필터 칩의 숫자는 주분류 수보다 약간 클 수 있다.

## 망델브로·줄리아·뉴턴·t-SNE 등의 처리

- 세 프랙탈 차트와 t-SNE·UMAP·크리깅 등은 **삭제·복제·이름 변경 없이** 그대로 두고, 성격만 ‘분석·계산 결과’로 표시했다. 계산 엔진, 기본 데이터, URL, 기존 테스트도 그대로다.
- 상세 설명 맨 위에 **‘표현 대상과 표현 방법’을 구분하는 짧은 메모**(`conceptNotes`, `src/content/index.ts`)를 추가했다. 예: 망델브로 집합은 복소평면의 집합이고, 색은 탈출 시간을 대응시킨 표현이다. 이 표현(탈출 시간 채색)은 줄리아 집합에도 쓰이므로 별개의 방법이다.
- ‘영역 채색(복소함수)’(`domain-coloring`)은 편각·크기를 색·밝기에 대응시키는 표현 방법이므로 **방법론**으로 분류하고, 같은 방식으로 세 프랙탈과 상호 연결 대상으로 두었다. 탈출 시간 채색·끌개 영역 채색은 별도 항목으로 만들지 않았다(기존 차트의 복사본이 되기 때문이다).
- 방법론 ↔ 결과 연결은 `techniqueResultLinks`(`src/viz/kinds.ts`)가 ‘관련 시각화’에 양방향으로 넣는다. 예: 산점도 ↔ PCA·t-SNE·UMAP, 히트맵 ↔ 혼동행렬·접촉 지도·어텐션 지도, RadViz ↔ t-SNE, 3D 지구본 ↔ 티소 지시도.

## 판단이 갈린 항목과 근거

- **히트맵·산점도 변형 계열**: 지도 변형(카토그램, 도트 밀도 등), 막대 변형(롤리팝, 덤벨 등)은 위치·길이·면적 대응이 서로 다른 독립된 표현이므로 방법론으로 분류했다. 같은 인코딩의 단순 옵션이면 별도 항목으로 늘리지 않았다.
- **캔들스틱, ROC 곡선, 포레스트 플롯, 간트 차트 등**: 해석 체계가 분야에 묶여 있어 전문 도표다. 캔들스틱·ROC·간트·플레임 그래프·Manhattan·카플란–마이어 등은 독립 표현 원리도 있어 보조 성격 ‘방법론’을 함께 붙였다.
- **PCA 바이플롯**: 계산(주성분)과 표현(점+화살표)이 한 도표로 굳어진 전문 도표로 두고 보조 ‘방법론’으로 표시했다.
- **t-SNE·UMAP**: 표현은 산점도이고 알고리즘이 본질이므로 ‘분석·계산 결과’, 보조 ‘방법론’.
- **벡터장·스트림라인**: 방법론이지만 특정 벡터장 계산에 종속된 면이 있어 보조 ‘분석’을 붙였다.
- **Mandelbrot·Julia·Newton**: ‘분석·계산 결과’, 보조 ‘방법론’(탈출 시간·끌개 영역 채색 기법이 독립 표현으로도 쓰이기 때문).
- **응용 예제**는 의도적으로 좁게 잡았다(8개). 새 데이터를 넣은 기존 기법이 모두 응용 예제는 아니며, 고유한 해석 체계가 있으면 전문 도표로 남겼다.
- v0.7의 신규 31개는 모두 방법론이다. 다만 마레이 차트(철도 시간표 관습)와 탱글그램(계통수·군집 비교 관습)은 분야 관습이 강해 **전문 도표**를 주분류로 하고 보조 ‘방법론’을 붙였다.

## 집계 규칙

- 전체 항목 수 = 카탈로그의 항목 수(중복 제거, ID 기준).
- 성격별 수 = 항목을 **주분류**로 한 번씩만 센 값. 네 값의 합 = 전체.
- 카탈로그 필터의 성격 칩은 주분류와 보조 성격을 모두 포함해 센다(탐색용).
- 신규 항목 수와 ‘독립적인 방법론’의 수는 서로 다른 통계다. 신규 31개 중 29개가 방법론 주분류이고, 기존 250개 중 113개가 방법론 주분류다(아래 목록).

## v0.6의 250종 분류 결과 (주분류)

### 시각화 방법론 113

scatter, bubble, hexbin, pairplot, histogram, kde, ecdf, box, violin, strip, bar, grouped-bar, stacked-bar, line, area, pie, treemap, heatmap, parallel, radar, ridgeline, raincloud, beeswarm, lollipop, dumbbell, slope, waterfall, stacked-bar-100, waffle, stacked-area, streamgraph, bump, calendar, sunburst, pack, sankey, chord, dendrogram, ci, kde2d, letter-value, connected-scatter, andrews, pyramid, bullet, step, horizon, mosaic, icicle, network, arc, alluvial, fan, choropleth, symbol-map, dot-density, geo-hexbin, flow-map, tile-grid, dorling, adjacency, edge-bundling, bipartite, hive, point-map, kde-map, square-grid, cluster-map, spike-map, isoline, hillshade, vector-field, streamline, particle-flow, bivariate, chorochromatic, vba-map, glyph-map, cartogram-contiguous, cartogram-noncontiguous, demers, gridded-cartogram, voronoi-map, raster-map, terrain-3d, prism-map, space-time-cube, dasymetric, surface-3d, scatter-3d, spectrogram, scalogram, ternary, polar-plot, polar-heatmap, pictogram, nightingale-rose, radial-bar, event-raster, barcode-plot, lexis, spiral-plot, clustered-heatmap, venn, upset, hypergraph, biofabric, radial-tree, domain-coloring, isosurface, volume-rendering, vector-field-3d, tensor-glyph

### 전문 도표 76

qq, pp, pca-biplot, pareto, candlestick, roc, pr, forest, bland-altman, calibration, control, funnel-plot, gantt, funnel, marimekko, flame, slope-aspect, tissot, residual-plot, scale-location, influence-plot, coefficient-plot, partial-dependence, kaplan-meier, nelson-aalen, ewma, cusum, lift-gain, pit-histogram, wind-rose, renko, heikin-ashi, kagi, point-figure, equivolume, volume-profile, line-break, drawdown, yield-curve, order-book, cumulative-flow, volcano, ma-plot, manhattan, sequence-logo, coverage, phylogenetic-tree, confusion-matrix, learning-curve, validation-curve, acf-plot, pacf-plot, ccf-plot, seasonal-subseries, lag-plot, mcmc-trace, prior-posterior, posterior-predictive, mcmc-rank, sbc-rank, hazard-plot, cumulative-incidence, joint-distribution, return-level, order-flow-footprint, dag-layout, weibull-plot, process-map, fault-tree, gsea-running-sum, msa-logo, contact-map, ramachandran, collocation-matrix, lexical-dispersion, zipf-plot

### 분석·계산 결과 53

isochrone, buffer-map, hotspot, lisa, bootstrap, phase-portrait, bifurcation, recurrence-plot, delaunay, pcoa, decision-boundary, hyperparam-landscape, silhouette-plot, tsne, umap, decision-tree, ice-plot, ale-plot, shap-summary, shap-waterfall, permutation-importance, nn-training, loss-landscape, attention-map, activation-flow, stl, mandelbrot-set, julia-set, newton-fractal, strange-attractor, poincare-section, radial-distribution, band-structure, density-of-states, phase-diagram, moran-scatterplot, semivariogram, directional-variogram, kriging-map, space-time-kde, density-ratio-map, efficient-frontier, iv-smile, iv-surface, event-study-car, var-es-distribution, risk-contribution, yield-surface, spectral-embedding, max-flow, rich-club, community-blockmodel, queue-simulation

### 응용 예제 8

trajectory, terrain-profile, molecule-viewer, crystal-lattice, od-matrix-map, risk-return-scatter, order-book-heatmap, tolerance-stackup

## 한계

- 이 분류는 사람이 정한 판단이며 경계가 연속적이다. 위의 근거를 문서화했을 뿐 유일한 정답은 아니다. 코드에서는 `techniques`, `analyses`, `applications` 집합에 ID를 옮기면 바꿀 수 있고, 회귀 테스트(`src/viz/kinds.test.ts`)는 모든 항목이 정확히 하나의 주분류를 갖는지와 합계가 맞는지를 검사한다.
- 방법론 113개에는 같은 인코딩의 ‘분야 적용 변형’(지도 계열 등)이 섞여 있다. ‘독립된 표현 원리’의 개수를 엄밀히 세려면 더 엄격한 하위 기준이 필요하며, 이번 버전에서는 도입하지 않았다.
