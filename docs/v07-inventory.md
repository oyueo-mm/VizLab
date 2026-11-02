# VizLab v0.7 인벤토리

## 실제 전체 개수 (이 문서 작성 시점의 코드에서 센 값)

| 항목 | v0.6 | v0.7 |
|---|---|---|
| 전체 도감 항목 | 250 | **281** |
| 카테고리 | 17 | 17 (새 카테고리 없음) |
| 홈 애니메이션 | 50 | **64** |
| 데이터셋 | 181 | **190** (+9) |
| 비교 실험실 프리셋 | 33 | **40** (+7) |

주분류 기준 성격별 수(합 = 281, 규칙은 `v07-classification.md`):

| 성격 | 기존 250 | 신규 31 | 합계 |
|---|---|---|---|
| 시각화 방법론 | 113 | 29 | **142** |
| 전문 도표 | 76 | 2 | **78** |
| 분석·계산 결과 | 53 | 0 | **53** |
| 응용 예제 | 8 | 0 | **8** |

## 목표와 실제

- 신규 독립 표현 기법 30종 이상 → **31종 구현** (목표 달성). 40종 이상(도전) → 미달성.
- 전체 300종 이상(도전 목표) → **281종**, 미달성.
- 홈 애니메이션 60종 이상(도전) → **64종**, 달성.
- 숫자를 맞추려고 분석 결과를 신규 방법론으로 등록하지 않았다. 신규 31종은 모두 새 배치·인코딩 원리를 가진 방법론(그중 마레이 차트·탱글그램은 전문 도표 주분류)이다.

## 기존 250종

모든 ID가 그대로이고(`src/viz/legacyIds.ts`에 목록 고정, 회귀 테스트가 존재·설명 유무를 검사), 계산 엔진·설명·데이터셋·홈 애니메이션·비교 프리셋·기존 단위·브라우저 테스트도 그대로다. 목록은 `src/viz/legacyIds.ts` 참고.

## 후보 40종의 처리

| ID | 후보 | 결과 | 비고 |
|---|---|---|---|
| V01 | RadViz | 구현 `radviz` | 앵커 드래그·재배치, 정규화, 변수 선택, 그룹 강조 |
| V02 | Chernoff Faces | 구현 `chernoff-faces` | 요소별 변수 대응(8요소), 정규화 범위, 표본 수 |
| V03 | Star Coordinates | 구현 `star-coordinates` | 축 벡터 드래그, 변수별 가중치, 회전 애니메이션 |
| V04 | Grand Tour | 구현 `grand-tour` | 시드 경유 프레임을 정규직교 보간, 재생·속도·위치 슬라이더, 관측값 선택 |
| V05 | Dimensional Stacking | 구현 `dimensional-stacking` | 변수 순서, 구간 수, 가로/세로 시작 |
| V06 | Table Lens | 구현 `table-lens` | 히트맵 대체가 아니라 행 확대·압축, 정렬, 막대/색 |
| V07 | Recursive Pattern | 구현 `recursive-pattern` | 재귀 깊이, 블록 크기, 정렬 변수, 뱀 모양 |
| V08 | Circle Segments | 구현 `circle-segments` | 변수별 구역, 링 배치 |
| V09 | HyperSlice | 구현 `hyperslice` | 커널 밀도의 변수 쌍 단면, 공유 단면 위치 |
| V10 | Pixel Bar Chart | 구현 `pixel-bar-chart` | 레코드=픽셀, 정렬·색 변수 |
| V11 | Storyline Chart | 구현 `storyline-chart` | 모임별 블록 정렬로 교차 감소 |
| V12 | NodeTrix | **미구현** | 군집 검출+행렬 혼합 배치는 이번 범위에서 미착수 |
| V13 | Bubble Sets | **미구현** | 등치 곡선 기반 영역 윤곽 필요 |
| V14 | LineSets | **미구현** | Bubble Sets·Kelp와 같은 집합 윤곽 계열로 묶어 다음 버전에 |
| V15 | Kelp Diagram | **미구현** | 위와 동일 |
| V16 | Rainbow Boxes | **미구현** | 시간 부족 |
| V17 | Parallel Sets | 구현 `parallel-sets` | 올루비얼(단계 사이 같은 개체의 이동)과 다름: 같은 레코드의 서로 다른 범주 속성을 잇는 리본 |
| V18 | Tanglegram | 구현 `tanglegram` | 두 연결법의 군집화, 교차 수, 가지 뒤집기 정렬 |
| V19 | Hyperbolic Tree | 구현 `hyperbolic-tree` | 푸앵카레 원판, 뫼비우스 변환 초점 이동 |
| V20 | Cone Tree | **미구현** | 3차원 장면 필요 |
| V21 | Voronoi Treemap | 구현 `voronoi-treemap` | 파워 다이어그램 면적 맞춤, 재귀 |
| V22 | FDEB | 구현 `force-directed-edge-bundling` | 호환성 4척도, 세분화 사이클 (계층형 에지 번들링과 다른 알고리즘) |
| V23 | Quantile Dotplot | 구현 `quantile-dotplot` | 분포 4종, 점 개수, 구간 강조, 표본 눈금 |
| V24 | HOPs | 구현 `hops` | t 분포 표본 추출, 시드·장면 재현성 |
| V25 | Gradient Plot | 구현 `gradient-plot` | 투명도/색, 구간 막대와 비교 |
| V26 | Wilkinson Dot Plot | 구현 `wilkinson-dotplot` | 비스웜은 위치를 보존하며 비켜 놓고, 이 기법은 구간 중심에 쌓는 별개의 알고리즘이라 독립 항목으로 유지 |
| V27 | Punchcard | 구현 `punchcard` | 면적 인코딩, 히트맵과 다른 크기 인코딩 |
| V28 | Time Curves | 구현 `time-curves` | 고전적 MDS, 반복 시점 표시 |
| V29 | Marey Chart | 구현 `marey-chart` | 선분 교차로 만남·추월 검출 |
| V30 | LifeLines | 구현 `lifelines` | 기간/시점 사건, 개체 선택·정렬 비교 |
| V31 | Event Sequence | **미구현(통합 보류)** | 이벤트 래스터·간트와 겹치는 정도를 검증하지 못해 보류 |
| V32 | LIC | 구현 `line-integral-convolution` | 화살표·스트림라인과 겹쳐 비교 |
| V33 | Stream Surface | **미구현** | 3차원 면 생성 필요 |
| V34 | Streamtube | **미구현** | 위와 동일 |
| V35 | Multi-Planar Reconstruction | 구현 `multi-planar-reconstruction` | 세 단면 동기화 |
| V36 | 3D Globe | 구현 `globe-3d` | SVG 직교투영(WebGL 아님) |
| V37 | Word Cloud | 구현 `word-cloud` | 실제 텍스트 입력, 나선 배치 |
| V38 | Word Tree | 구현 `word-tree` | 접두 트리 |
| V39 | Space-Filling Curve Pixel | 구현 `space-filling-curve` | Hilbert·Z-order·뱀·행 순서 |
| V40 | Linear Set Diagram | 구현 `linear-set-diagram` | UpSet은 막대+점 행렬, 이 도표는 열 너비가 원소 수 |

구현 31 / 미구현 9(NodeTrix, Bubble Sets, LineSets, Kelp, Rainbow Boxes, Cone Tree, Event Sequence, Stream Surface, Streamtube).

## 기존 차트에 통합한 항목

없음. 후보를 기존 실험실의 모드로만 흡수한 경우는 없고, 겹침 우려가 있던 후보(Wilkinson, Parallel Sets, Punchcard, Linear Set Diagram)는 모두 독립 항목으로 구현하고 각 설명에 ‘다른 기법과의 차이’를 적었다. ‘탈출 시간 채색’·‘끌개 영역 채색’은 새 항목 대신 기존 세 프랙탈 차트의 설명 메모로 다뤘다.

## 추가 발굴 (후보 외)

이번 버전에서는 후보 목록 외의 새 기법을 발굴하지 못했다(조사 단계를 시간 문제로 후보 구현에 우선 투입했다). `v07-next.md`의 후속 조사 목록을 참고.

## 신규 31종 (구현 순서)

| 분야 | ID |
|---|---|
| 다변량·고차원 (10) | radviz, star-coordinates, grand-tour, dimensional-stacking, table-lens, recursive-pattern, circle-segments, hyperslice, pixel-bar-chart, chernoff-faces |
| 분포·불확실성 (5) | quantile-dotplot, hops, gradient-plot, wilkinson-dotplot, punchcard |
| 집합·계층·텍스트 (9) | parallel-sets, word-cloud, word-tree, space-filling-curve, voronoi-treemap, tanglegram, hyperbolic-tree, linear-set-diagram, force-directed-edge-bundling |
| 시간 (4) | time-curves, marey-chart, lifelines, storyline-chart |
| 과학·지리 (3) | line-integral-convolution, globe-3d, multi-planar-reconstruction |

## 신규 데이터셋 (9)

state-series, train-timetable, patient-events, survey-cats, text-corpus, lic-sources, org-tree, flow-edges, story-scenes. 모두 `src/data/datasetsV7*.ts`의 시드 기반 합성 데이터이며 설명 문구에 합성임을 밝혔다.

## 신규 계산·레이아웃 엔진

`src/stats/multivar7.ts`(RadViz, Star Coordinates, 그랜드 투어 프레임, 차원 쌓기, 테이블 렌즈 배치, 재귀 패턴, 서클 세그먼트, 하이퍼슬라이스, 픽셀 막대, 체르노프 기하), `uncert7.ts`(분포 적합, 분위수 점, 윌킨슨 쌓기, HOP 표본, 고전적 MDS, 선분 교차), `struct7.ts`(패럴렐 셋, 단어 빈도·워드 클라우드·워드 트리, 공간충전곡선, 보로노이 트리맵(파워 다이어그램), 탱글그램 정렬), `net7.ts`(쌍곡 트리, 선형 집합 도표, FDEB, 스토리라인), `sci7.ts`(LIC, 직교투영 지구본, MPR 단면).
