# VizLab v0.6 기법 목록 (inventory)

기준: v0.5 최종 커밋 `7131ea9`, 167종. 상태는 **검증된 것만** “구현 및 검증 완료”로 적습니다. 검증 = 단위 테스트(계산) + 서버 렌더(빈 데이터·텍스트 셀·null 포함) + 브라우저 스크린샷 점검. 브라우저 딥링크·새로고침 e2e는 마지막 배치에서 한꺼번에 추가합니다(해당 열의 “e2e”).

상태 표기: 후보 / 조사 완료 / 구현 중 / 구현 및 검증 완료 / 기존 차트에 통합 / 보류 / 미구현

## v0.5 미구현 8종 (A01–A08)

| ID | 이름 | 상태 | 비고 |
| --- | --- | --- | --- |
| A01 | 유전체 트랙 | 후보 | |
| A02 | Circos Plot | 후보 | |
| A03 | Parallel Sets | 후보 | 올루비얼·평행좌표와의 차이(범주 축 + 차원 순서 조작)로 독립 가능한지 구현 시 판단 |
| A04 | Force-Directed Edge Bundling | 후보 | |
| A05 | Voronoi Treemap | 후보 | |
| A06 | Viewshed Map | 후보 | |
| A07 | Watershed Map | 후보 | |
| A08 | 3D Globe | 후보 | WebGL 검토 |

## 구현 및 검증 완료 (49종, `catalog id`)

| 분야 | 개수 | 항목 |
| --- | --- | --- |
| 기계학습·AI (ML01–ML18) | 18 | `confusion-matrix`, `decision-boundary`, `learning-curve`, `validation-curve`, `hyperparam-landscape`, `silhouette-plot`, `tsne`, `umap`, `decision-tree`, `ice-plot`, `ale-plot`, `shap-summary`, `shap-waterfall`, `permutation-importance`, `nn-training`, `loss-landscape`(2D 등고선만), `attention-map`(학습되지 않은 가중치임을 화면에 명시), `activation-flow` |
| 통계·시계열·베이지안 (ST01–ST15) | 15 | `acf-plot`, `pacf-plot`, `ccf-plot`, `stl`, `seasonal-subseries`, `lag-plot`, `mcmc-trace`, `prior-posterior`, `posterior-predictive`, `mcmc-rank`, `sbc-rank`, `hazard-plot`, `cumulative-incidence`, `joint-distribution`, `return-level` |
| 물리·수학 (PHY01–PHY16) | 16 | `mandelbrot-set`, `julia-set`, `newton-fractal`, `domain-coloring`, `strange-attractor`, `poincare-section`, `radial-distribution`, `band-structure`, `density-of-states`, `phase-diagram`, `isosurface`, `volume-rendering`, `vector-field-3d`, `tensor-glyph`, `molecule-viewer`, `crystal-lattice` |

(PHY 16종은 요청서의 PHY01–PHY16 전부에 대응합니다.)

계산 검증(단위 테스트 142개): ML(`v6ml` 24), 시계열·베이지안(`v6tsa` 22), 프랙탈(`v6fractal` 11), 물리(`v6physics` 15), 3D·화학(`v6field3d` 12) 외 기존 430개. 주요 검증: SHAP 합산 불변량, UMAP a·b = umap-learn(1.577, 0.895), t-SNE 퍼플렉서티·KL, 실루엣 손계산, ACF 손계산·AR(2)의 PACF 절단, STL 재구성 항등식, Aalen–Johansen 항등식, GEV L-적률 복원, 로렌츠 리아푸노프 ≈ 0.9, fcc 배위수 12·NaCl 밀도 2.164, 마칭 사면체 구의 넓이와 닫힌 메시, Newton 근 회전 대칭 등.

## 남은 후보 (아직 시작하지 않음 = 후보)

- 지리공간(GEO01–GEO10), 생물정보(BIO01–BIO10), 금융(FIN01–FIN10), 네트워크(NET01–NET10), 언어·텍스트(TXT01–TXT10), 소프트웨어(SW01–SW08), 산업·신뢰성(IND01–IND08).
- 구현하면 위 표의 해당 분야 행으로 옮겨 적습니다.

## 중복 판단 기록

- ML09 ICE: 기존 `partial-dependence`가 있어 PDP는 새로 만들지 않고 ICE 화면에 PDP 평균을 겹쳐 표시.
- ST05 계절 부분계열·ST06 시차 도표: 기존 캘린더·선 그래프와 다른 질문(계절별 추세, 자기상관 구조)에 답해 독립 기법으로 인정.
- PHY02 Julia는 Mandelbrot의 매개변수 평면과 연동되는 별개의 반복 집합이라 독립.
- PHY15 띠 구조와 PHY16 상태 밀도는 같은 모형(강한 결합)에서 나오지만, 위·아래 패널의 질문이 달라(분산 관계 vs 에너지 분포) 독립 항목으로 두었습니다.
