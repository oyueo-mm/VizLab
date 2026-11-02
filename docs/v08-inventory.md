# VizLab v0.8 인벤토리

## 실제 전체 개수 (코드에서 센 값)

| 항목 | v0.7 | v0.8 |
|---|---|---|
| 전체 도감 항목 | 281 | **301** (+20) |
| 카테고리 | 17 | 17 (변경 없음) |
| 홈 애니메이션 | 64 | **72** (+8) |
| 데이터셋 | 190 | **199** (+9) |
| 비교 실험실 추천 조합 | 40 | **49** (+9) |
| 표현 원리 태그 | — | 16종(주분류 1개 + 보조) |

주분류 기준 성격별 수(합 = 301):

| 성격 | v0.7 | 신규 20 | 합계 |
|---|---|---|---|
| 시각화 방법론 | 142 | 20 | **162** |
| 전문 도표 | 78 | 0 | **78** |
| 분석·계산 결과 | 53 | 0 | **53** |
| 응용 예제 | 8 | 0 | **8** |

## 목표와 실제

| 목표 | 실제 |
|---|---|
| 전체 320종 이상(도전) | **301종, 미달성** |
| 신규 독립 방법론 30종 이상 | **20종, 미달성** |
| 신규 40종 이상(확장) | 미달성 |
| 홈 애니메이션 70단계 이상(도전) | **72단계, 달성** |
| 기존 281종 전부 보존 | **보존** (기존 ID·URL·테스트 모두 유지, 기존 e2e 373개 통과) |
| v0.7 미구현 9종 처리 | 8종 구현, 1종(Event Sequence)은 LifeFlow로 부분 구현 |

숫자를 맞추려고 기존 기법을 이름만 바꾸거나 설정 조합으로 등록하지 않았습니다.

## 신규 20종

| ID | 이름 | 카테고리 | 핵심 표현 원리(보조) | 구현 수준 |
|---|---|---|---|---|
| `bubble-sets` | Bubble Sets | 관계·네트워크(집합) | 면적 (연결, 위치) | 에너지 장 + 가상 간선 우회. 장애물 회피를 재귀 3단계로 단순화 |
| `linesets` | LineSets | 관계·네트워크(집합) | 연결 (위치) | 최근접 이웃 + 2-opt 경로, 선 간격 벌리기. 원 논문의 선 라우팅은 단순화 |
| `kelp-diagram` | Kelp Diagram (KelpFusion) | 관계·네트워크(집합) | 면적 (연결) | 신장 트리 + 굵기 변화, 융합은 델로네 삼각형 채우기로 단순화 |
| `rainbow-boxes` | Rainbow Boxes | 관계·네트워크(집합) | 면적 (분할) | 이동-개선 지역 탐색 휴리스틱 |
| `radial-sets` | Radial Sets | 관계·네트워크(집합) | 면적 (연결, 투영) | 단순화(대화형 질의 없음) |
| `nodetrix` | NodeTrix | 관계·네트워크 | 연결 | 루뱅/그룹 공동체, 허브 우선 순서 |
| `power-graph` | Power Graph | 관계·네트워크 | 연결 | 평평한 biclique/clique 분해, 무손실 복원 검증 |
| `confluent-drawing` | Confluent Drawing | 관계·네트워크 | 연결 | 그리디 분해 위의 줄기(최적 합류 그림 아님) |
| `semantic-substrates` | Semantic Substrates | 관계·네트워크 | 공간 분할 (위치, 연결) | 모든 영역이 같은 두 속성 |
| `pivot-graph` | PivotGraph | 관계·네트워크 | 위치 (연결) | 범주형 속성 2개 |
| `cone-tree` | Cone Tree | 계층·흐름 | 3D 공간 | 직교 투영 Canvas |
| `stream-surface` | Stream Surface | 과학·수학 | 3D 공간 | 시간 동기 적분 + 유선 삽입, 전진 전선 없음 |
| `streamtube` | Streamtube | 과학·수학 | 3D 공간 | 평행 이동 프레임, 유량 보존 반지름 |
| `timearcs` | TimeArcs | 시계열 | 시간 (연결) | barycenter 정렬(힘 기반 1차원 배치 아님) |
| `lifeflow` | LifeFlow | 시계열 | 흐름 (시간, 길이) | 접두사 집계 + 부분 순서 패턴 검색 |
| `timesets` | TimeSets | 시계열 | 시간 (면적, 연결) | 점 사건만, 켈프 영역 재사용 |
| `flowstrates` | Flowstrates | 지리공간 | 복합 표현 (색, 연결) | 지역 좌표 도식(지도 타일 아님) |
| `textarc` | TextArc | 언어·텍스트 | 위치 (연결) | 문장 눈금(글자 없음) |
| `parallel-tag-clouds` | Parallel Tag Clouds | 언어·텍스트 | 면적 (위치) | 빈도·TF-IDF식 점수 |
| `phrase-net` | Phrase Net | 언어·텍스트 | 연결 | 한국어 조사 5종 패턴 |

위 ‘핵심 표현 원리’는 `src/viz/encodings.ts`의 값입니다(`docs/v08-encodings.md`).

## 통합·제외·미구현

| 항목 | 처리 |
|---|---|
| KelpFusion | Kelp Diagram의 ‘융합’ 슬라이더로 통합 |
| Event Sequence Visualization | LifeFlow로 부분 구현 |
| SetNet, Sequence Braiding, MatrixExplorer, Document Cards | 미구현(`v08-research.md`) |
| Temporal Density Matrix | 독립 방법론이 아닌 히트맵 응용으로 판단해 제외 |
| Scagnostics 외 조사만 한 6종 | 미구현 |

## 신규 데이터셋 9종

`set-points`, `dense-modules`, `vector-vortex`, `people-network`, `dynamic-links`, `od-timeseries`, `care-pathways`, `timed-events`, `corpus-articles`. 모두 합성 자료이며 실제 사람·서비스·환자·통계가 아닙니다(데이터셋 설명에 명시).

## 신규 계산 엔진

| 파일 | 내용 | 단위 테스트 |
|---|---|---|
| `src/stats/sets8.ts` | Bubble Sets, LineSets, Kelp(+융합), Rainbow Boxes, Radial Sets | `v8sets.test.ts` 15개 |
| `src/stats/graph8.ts` | Power Graph 분해, 합류 줄기, NodeTrix 블록 배치, 그룹 레이아웃 | `v8graph.test.ts` 11개 |
| `src/stats/viz3d8.ts` | 시간 적분, 스트림 서피스, 스트림튜브, 콘 트리 | `v8viz3d.test.ts` 13개 |
| `src/stats/relate8.ts`, `tempo8.ts`, `text8.ts` | Semantic Substrates, PivotGraph, TimeArcs 순서, LifeFlow, Flowstrates, 레인 배정, TextArc, Parallel Tag Clouds, Phrase Net | `v8seq.test.ts` 21개 |
| `src/stats/fdeb.worker.ts` | FDEB를 Web Worker에서 계산 | e2e |

수학적 성질 검증의 예: 회전 흐름에서 스트림 서피스가 환형 면적 3.0(해석값)에 수렴하고 모든 점이 z = 0·반지름 보존, 유량 보존 튜브의 유량 일정, 평행 이동 프레임의 비틀림 없음, 콘 트리 형제 부분트리 비겹침, Power Graph 전개 = 원본 간선, 합류 줄기 전개 = 분해된 간선, LifeFlow 노드 수 = 자식 합 + 종료 수.
