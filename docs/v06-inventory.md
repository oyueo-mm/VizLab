# VizLab v0.6 기법 목록 (inventory)

기준: v0.5 최종 커밋 `7131ea9`, 167종. 상태는 **검증된 것만** “구현 및 검증 완료”로 적습니다. 검증 = 단위 테스트(계산) + 서버 렌더 + 브라우저 딥링크·새로고침·콘솔 오류 0.

상태 표기: 후보 / 조사 완료 / 구현 중 / 구현 및 검증 완료 / 기존 차트에 통합 / 보류 / 미구현

## v0.5 미구현 8종 (A01–A08)

| ID | 이름 | 상태 | 비고 |
| --- | --- | --- | --- |
| A01 | 유전체 트랙 Genome Browser Tracks | 후보 | |
| A02 | Circos Plot | 후보 | |
| A03 | Parallel Sets | 후보 | 올루비얼·평행좌표와의 차이(범주 축 사이 리본 + 차원 순서 조작)를 구현할 수 있으면 독립 |
| A04 | Force-Directed Edge Bundling | 후보 | FDEB(Holten & van Wijk) |
| A05 | Voronoi Treemap | 후보 | |
| A06 | Viewshed Map | 후보 | |
| A07 | Watershed Map | 후보 | |
| A08 | 3D Globe | 후보 | WebGL 검토 |

## 기계학습·AI (ML01–ML18)

모두 브라우저에서 실제로 학습·계산합니다(`src/stats/ml.ts`, 단위 테스트 `src/stats/v6ml.test.ts` 24개).

| ID | 이름 | catalog id | 계산 | 상태 |
| --- | --- | --- | --- | --- |
| ML01 | 혼동행렬 | `confusion-matrix` | kNN·로지스틱·트리·NB·MLP, 5겹 out-of-fold, P/R/F1 | 구현 및 검증 완료 |
| ML02 | 결정 경계 | `decision-boundary` | 격자 전체에 학습된 모델 예측, 검증 점 분리 | 구현 및 검증 완료 |
| ML03 | 학습 곡선 | `learning-curve` | 층화 k겹, 학습 크기별 훈련·검증 점수 | 구현 및 검증 완료 |
| ML04 | 검증 곡선 | `validation-curve` | 하이퍼파라미터별 교차검증 | 구현 및 검증 완료 |
| ML05 | 하이퍼파라미터 탐색 지형도 | `hyperparam-landscape` | 두 하이퍼파라미터 격자 교차검증 | 구현 및 검증 완료 |
| ML06 | 실루엣 플롯 | `silhouette-plot` | 정확한 쌍거리 실루엣(손계산 일치), k-평균(재시작 6회) | 구현 및 검증 완료 |
| ML07 | t-SNE | `tsne` | 정확한 t-SNE(퍼플렉서티 이분법, 모멘텀·이득·과장), KL·신뢰도 | 구현 및 검증 완료 |
| ML08 | UMAP | `umap` | 정확한 kNN, 퍼지 단체 집합, a·b 곡선 맞춤(umap-learn과 일치), PCA 초기화, SGD | 구현 및 검증 완료 (단순판: 스펙트럴 초기화·근사 이웃 없음) |
| ML09 | ICE | `ice-plot` | 랜덤 포레스트 + 격자 예측, c-ICE | 구현 및 검증 완료 |
| ML10 | ALE | `ale-plot` | Apley–Zhao 분위수 구간·누적·중심화 | 구현 및 검증 완료 |
| ML11 | SHAP Summary | `shap-summary` | 정확한 interventional 샤플리(p≤6), 합산 불변량 | 구현 및 검증 완료 |
| ML12 | SHAP Waterfall | `shap-waterfall` | 위와 동일, 가법 분해 | 구현 및 검증 완료 |
| ML13 | Permutation Importance | `permutation-importance` | 열 섞기 R² 감소, 70/30 분할 | 구현 및 검증 완료 |
| ML14 | 결정 트리 | `decision-tree` | CART 지니, 노드·경로 | 구현 및 검증 완료 |
| ML15 | 신경망 학습 곡선 | `nn-training` | MLP SGD+모멘텀, 학습률 스케줄, 검증 20% | 구현 및 검증 완료 |
| ML16 | Loss Landscape | `loss-landscape` | filter-normalised 두 방향 격자 손실, 등고선 | 구현 및 검증 완료 (2D 등고선만, 3D 표면 미구현) |
| ML17 | Attention Map | `attention-map` | 멀티헤드 스케일드 닷프로덕트, 인과·패딩 마스크 | 구현 및 검증 완료 (학습되지 않은 무작위 가중치임을 화면에 명시) |
| ML18 | 활성화 분포·신호 흐름 | `activation-flow` | 실제 MLP 학습 전후 층별 분포, 죽은 뉴런 | 구현 및 검증 완료 |

## 나머지 후보 (아직 시작하지 않음)

- 통계·시계열(ST01–ST15), 지리공간(GEO01–GEO10), 물리·화학·수학(PHY01–PHY16), 생물정보(BIO01–BIO10), 금융(FIN01–FIN10), 네트워크(NET01–NET10), 언어·텍스트(TXT01–TXT10), 소프트웨어(SW01–SW08), 산업·신뢰성(IND01–IND08): 모두 **후보**. 구현하면 이 문서에서 해당 행을 위 표 형식으로 옮겨 적습니다.
- 추가 발굴 후보(목록 외)는 구현 시 같은 표에 추가합니다.

## 중복 판단 기록

- Parallel Sets(A03): 올루비얼(시간 축 순서)·평행좌표(수치 축)와 다른 입력(범주 다차원)이지만 계산은 올루비얼과 비슷하여 구현 시 “차원 축 재배열 + 범주 필터” 상호작용으로 차별화합니다. 불충분하면 “기존 기법에 통합”으로 바꿉니다.
- ML 중 PDP는 기존 `partial-dependence`가 있어 ICE·ALE만 새로 추가했습니다(ICE 화면에 PDP 평균을 함께 표시).
