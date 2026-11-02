# VizLab v0.8 작업 기록

## 배치

| 배치 | 내용 | 커밋 |
|---|---|---|
| 1 | 조사(후보 33개), 집합 영역 계열 5종(Bubble Sets, LineSets, Kelp, Rainbow Boxes, Radial Sets) + 엔진 `sets8.ts` | `d1e06f4` |
| 2 | 표현 원리 태그(`encodings.ts`)와 도감 필터·URL `?e=` | `5f60ced` |
| 3 | NodeTrix, Power Graph, Confluent Drawing + 엔진 `graph8.ts` | `fdaa708` |
| 4 | Cone Tree, Stream Surface, Streamtube + 엔진 `viz3d8.ts`, 새 벡터장 데이터셋 | `c4505a1` |
| 5 | Semantic Substrates, PivotGraph, TimeArcs, LifeFlow, TimeSets, Flowstrates, TextArc, Parallel Tag Clouds, Phrase Net + 엔진·데이터셋 | `efc85e9` |
| 6 | 홈 애니메이션 72단계, 비교 프리셋 9개, 설명 콘텐츠 지연 로딩, FDEB Web Worker, e2e(v8), 버전 0.8.0 | `9579248` |
| 7 | 문서·README, 최종 전체 검증, push·배포 | 이 문서의 최종 커밋 |

## 테스트 결과 (최종 코드 기준, 로컬)

- `tsc -b --noEmit`: 통과. `eslint .`: 오류 0, 경고 6(모두 v0.7 이전 코드의 hook 의존성 경고).
- 단위 테스트(vitest): **43개 파일, 713개 통과**(v0.7 650개 안팎에서 신규 엔진·필터·로더·프리셋·홈 프레임 테스트 추가).
- 브라우저 테스트(Playwright): **398개 통과**(데스크톱 + Pixel 7 에뮬레이션 모바일). 전체 스위트를 한 번에 실행한 결과이며 개별 재실행으로 대체하지 않았습니다. 중간에 실패한 것은 카테고리별 개수 단언 4개(카탈로그가 늘어서)와 새 테스트의 포인터 캡처 문제 3개였고 모두 원인을 고쳐 전체를 다시 실행했습니다.
- 모바일 검증은 **뷰포트 에뮬레이션**(Pixel 7 프로필, 가로·세로)입니다. 실제 휴대폰은 시험하지 못했습니다.
- CI(`.github/workflows/deploy.yml`)가 실제로 실행하는 범위: typecheck → lint → 단위 테스트 → build → **전체 e2e** → Pages 배포. 로컬에서 같은 순서로 확인했습니다.

신규 e2e(`e2e/v8.spec.ts`, `e2e/v8.mobile.spec.ts`, 25개)가 확인하는 것: 표현 원리 필터와 URL·새로고침·뒤로가기, 20개 실험실의 차트·설명 섹션, 설명이 해당 버전 그룹만 내려받는지, 방법론별 인터랙션(집합 소속 편집·드래그·융합·조각 수·섹터 선택, NodeTrix 접기·펼치기, Power Graph 복원, 합류 줄기 도달 노드, 속성 영역 필터, 콘 트리 선택·접기, 3D 재구성, 호 길이, 패턴 검색, 지역 선택, 구문 패턴), 비교 실험실의 연동 강조(같은 점이 세 그림에서 강조), FDEB가 Worker에서 계산되는지, 홈 8단계와 링크, 새 프리셋 9개, 모바일 가로 스크롤 없음·터치 선택·화면 회전.

## 성능과 번들 (이번 작업에서 실제로 측정한 값)

### 번들 크기 (`npm run build`)

| 청크 | v0.7 | v0.8 |
|---|---|---|
| Details(상세 설명 + KaTeX) | 804.0 kB (gzip 262 kB) | **265.4 kB (gzip 80.1 kB)** |
| 설명 텍스트 | Details 안에 모두 포함 | 버전 그룹별 청크: legacy 148.7, v5 161.8, v6 146.1, v7 83.5, v8 67.9 kB |
| 메인 번들(index) | 723.1 kB | 757.9 kB (+34.7 kB: 카탈로그·표현 원리 데이터) |

실험실 하나를 열 때 내려받는 설명은 최대 약 162 kB(해당 버전 그룹 하나)입니다. 메인 번들은 줄이지 못했고 오히려 카탈로그 항목이 늘면서 커졌습니다(홈 첫 로딩에는 설명 텍스트가 이미 포함되지 않았습니다 — 설명은 Details 청크에만 있었습니다).

### FDEB (Web Worker, 취소 지원)

`bundleEdges` 계산을 변경하지 않고 같은 함수를 Worker에서 실행합니다. 설정이 바뀌면 이전 계산을 `terminate()`로 취소하고, 계산하는 동안 이전 결과를 계속 보여 줍니다. 입력 크기별 단계 수 조절·공간 인덱스는 하지 않았습니다(호환성 사전 계산은 v0.7에서 이미 있음).

| 간선 수 | 계산 시간(Worker) | 계산 중 최대 프레임 간격 | 50 ms 넘은 프레임 |
|---|---|---|---|
| 90 | 113 ms | (측정 구간 짧음) | 0 |
| 300 | 975 ms | 17 ms | 0 / 61 프레임 |

v0.7 기록(90개 163 ms, 300개 1,977 ms, 모두 메인 스레드를 막음)과 숫자 비교는 같은 조건이 아니므로(다른 시점의 측정, 헤드리스 Chromium) 속도가 빨라졌다고 주장하지 않습니다. 달라진 것은 **계산 중에도 UI가 멈추지 않는다**는 점입니다.

### 시도하지 못한 것

- LIC(300×300, 약 1.1초) 최적화, 3,000노드 네트워크 병목 측정·개선, WebGL 렌더러는 이번 작업에서 하지 않았습니다. 3D 기법은 기존 Canvas/SVG 3D 키트(`kit3d`)로 구현했고 WebGL을 도입하지 않았으므로 GPU 리소스 정리 문제도 생기지 않았습니다.

## 연동 하이라이트: 동일 데이터셋 공유와 Linked Highlighting의 구분

| 상태 | 해당 |
|---|---|
| **데이터셋 공유 + 연동 강조 지원** | Bubble Sets, LineSets, Kelp Diagram(점 단위, 같은 점이 세 그림에서 강조), NodeTrix(행렬 칸 → 간선 행), Semantic Substrates·PivotGraph·TimeSets·Rainbow Boxes(관측 행) |
| 데이터셋만 공유 | Radial Sets, Power Graph, Confluent Drawing(그리기 단위가 집계라 관측 행을 되돌려 주지 않음; Power Graph·Confluent는 받는 쪽은 지원), Cone Tree, Stream Surface, Streamtube, TimeArcs, LifeFlow, Flowstrates, TextArc, Parallel Tag Clouds, Phrase Net |

NodeTrix 칸을 가리키면 같은 간선 행이 `network`·`adjacency`에서 **노드 단위로** 강조됩니다(기존 네트워크 차트가 행→노드 강조 방식이라 간선 하나만 강조하지는 않습니다).

## 알려진 문제

- 설명 청크를 내려받지 못한 경우의 화면(“설명을 불러오지 못했습니다 · 다시 시도”)은 구현했지만, e2e의 콘솔 오류 검사 때문에 실패 경로를 브라우저 테스트로 검증하지 못했습니다. `loadContent`는 실패한 로드를 캐시하지 않고 단위 테스트는 성공 경로만 검사합니다.
- TextArc의 한국어 조사 처리, Phrase Net의 조사 패턴은 형태소 분석이 아닙니다.

## 배포 상태

(배포 후 갱신) — 이 항목은 `v08-next.md`의 ‘재개 절차’와 함께 최종 커밋에서 확정합니다.
