# VizLab v0.6 기법 목록 (inventory)

기준: v0.5 최종 커밋 `7131ea9`, 167종 → v0.6 **250종**(신규 83종). 상태는 **검증된 것만** “구현 및 검증 완료”로 적습니다. 검증 = 단위 테스트(계산) + 서버 렌더(빈 데이터·텍스트 포함) + 화면 캡처 확인 + Playwright 딥링크·새로고침.

상태 표기: 후보 / 구현 및 검증 완료 / 기존 차트에 통합 / 보류 / 미구현

## 구현 및 검증 완료 (신규 83종)

| 분야 | 개수 | 항목(`catalog id`) |
| --- | --- | --- |
| 기계학습·AI (ML01–ML18) | 18 | `confusion-matrix`, `decision-boundary`, `learning-curve`, `validation-curve`, `hyperparam-landscape`, `silhouette-plot`, `tsne`, `umap`, `decision-tree`, `ice-plot`, `ale-plot`, `shap-summary`, `shap-waterfall`, `permutation-importance`, `nn-training`, `loss-landscape`, `attention-map`, `activation-flow` |
| 통계·시계열·베이지안 (ST) | 15 | `acf-plot`, `pacf-plot`, `ccf-plot`, `stl`, `seasonal-subseries`, `lag-plot`, `mcmc-trace`, `mcmc-rank`, `prior-posterior`, `posterior-predictive`, `sbc-rank`, `hazard-plot`, `cumulative-incidence`, `joint-distribution`, `return-level` |
| 물리·수학·화학 (PHY) | 16 | `mandelbrot-set`, `julia-set`, `newton-fractal`, `domain-coloring`, `strange-attractor`, `poincare-section`, `radial-distribution`, `band-structure`, `density-of-states`, `phase-diagram`, `isosurface`, `volume-rendering`, `vector-field-3d`, `tensor-glyph`, `molecule-viewer`, `crystal-lattice` |
| 지리공간 (GEO) | 7 | `moran-scatterplot`, `semivariogram`, `directional-variogram`, `kriging-map`, `space-time-kde`, `od-matrix-map`, `density-ratio-map` |
| 금융 (FIN) | 10 | `efficient-frontier`, `risk-return-scatter`, `iv-smile`, `iv-surface`, `order-flow-footprint`, `order-book-heatmap`, `event-study-car`, `var-es-distribution`, `risk-contribution`, `yield-surface` |
| 네트워크 (NET) | 5 | `spectral-embedding`, `dag-layout`, `max-flow`, `rich-club`, `community-blockmodel` |
| 산업·공학 (IND) | 5 | `weibull-plot`, `tolerance-stackup`, `queue-simulation`, `process-map`, `fault-tree` |
| 생물정보 (BIO) | 4 | `gsea-running-sum`, `msa-logo`, `contact-map`, `ramachandran` |
| 언어·텍스트 (TXT) | 3 | `collocation-matrix`, `lexical-dispersion`, `zipf-plot` |

## 미구현 (후보로 남음)

| 분야 | 항목 |
| --- | --- |
| v0.5 잔여 A01–A08 | 유전체 트랙, Circos, Parallel Sets, FDEB, Voronoi Treemap, Viewshed, Watershed, 3D Globe |
| 지리 | GEO06(보행 접근성 등 경로 분석), GEO09, GEO10 |
| 네트워크 | 시간 네트워크·에지 타임라인, 다층 네트워크, 흐름 잔차 |
| 생물 | Hi-C 접촉 행렬, CNV, 단일세포 지도·의사시간, 아이소폼, 파일업(pileup) |
| 텍스트 | 워드 클라우드, KWIC, 워드 트리, 토픽 모형(LDA), 감성 강, 정렬, 의존 구문 트리, 토큰 정렬 |
| 소프트웨어 SW01–SW08 | 트레이스 워터폴, 시간 플레임 차트, 차등 플레임 그래프, 지배자 트리, git 그래프, 할당 타임라인, 스케줄링, 변경 이력 |
| 산업 | 병목 곡선(욕조 곡선), 신뢰성 블록 다이어그램, 병렬 공정 간트 |

## 계산 검증

단위 테스트는 `src/stats/v6*.test.ts`(ml 24, tsa 22, fractal 11, physics 15, field3d·chem 12, geostat 9, finance2 11, graph2 11, applied 21) 외에 렌더·내용·레지스트리 테스트가 있습니다.

## 중복 판단 기록

- ML09 ICE: 기존 `partial-dependence`가 있어 PDP는 새로 만들지 않고 ICE 화면에 PDP 평균을 겹쳐 표시.
- ST05 계절 부분계열·ST06 시차 도표: 기존 캘린더·선 그래프와 다른 질문(계절별 추세, 자기상관 구조)에 답해 독립 기법으로 인정.
- PHY02 Julia는 Mandelbrot의 매개변수 평면과 연동되는 별개의 반복 집합이라 독립.
- PHY15 띠 구조와 PHY16 상태 밀도는 같은 모형(강한 결합)에서 나오지만 위·아래 패널의 질문이 달라 독립 항목으로 두었습니다.
- 접촉 지도(Cα 거리 행렬)와 기존 `heatmap`: 입력이 3차원 좌표이고 거리 계산·서열 간격 필터·접촉 차수가 들어가 독립으로 인정.
- 층별 방향 그래프(`dag-layout`)와 `network`: 방향·층 배정·순환 제거·임계 경로가 있어 독립. 프로세스 맵은 같은 배치 위에 이벤트 로그 집계라는 별도 계산이 있어 독립.
- 색·방향만 다른 변형은 새 기법으로 세지 않았습니다.
