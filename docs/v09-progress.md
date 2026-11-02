# VizLab v0.9 작업 기록

## 배치

| 배치 | 내용 | 커밋 |
|---|---|---|
| 1 | 후보 조사와 서지 검증(웹 검색), 집합 3종(MetroSets·MosaicSets·InfoCrystal) + 엔진 `sets9.ts`, v9 등록 구조·데이터셋 | `af68b03` |
| 2 | PAOHvis, Set Streams, Sequence Braiding, Dust & Magnet, GosperMap + 엔진 `tempo9.ts`·`multi9.ts` | `1c1a589` |
| 3 | WordStream, TileBars, OD Maps, Perspective Wall(Bifocal 포함), IBFV, Hyperstreamlines, Fiber Surfaces, VSUP(이변량 코로플레스 모드) + 엔진 `text9`·`focus9`·`geo9`·`field9`·`vsup` | `2a901d8` |
| 4 | Vector Field Topology, MapTrix, Seesoft, SetNet (320종 도달) | `55f0334` |
| 5 | 홈 애니메이션 80단계, 비교 프리셋 10개, 연동 강조, LIC Worker, 데이터셋 지연 로드, 설명 로딩 실패 e2e, v9 e2e, 버전 0.9.0, 문서 | `dac92ee` |
| 6 | CI에서 드러난 LIC e2e 테스트 수정(Worker 비동기 계산을 기다리도록), 기록 갱신 | 아래 ‘배포 확인’ 참조 |

커밋 해시는 `git log`가 기준입니다. 배치 5 이후 문서만 갱신하는 커밋이 한 번 더 올라갈 수 있습니다.

## 테스트 결과 (최종 코드 기준, 로컬)

- `tsc -b --noEmit`: 통과. `eslint .`: 오류 0, 경고 6(모두 v0.7 이전 코드의 hook 의존성 경고).
- 단위 테스트(vitest): **49개 파일, 795개 통과**(v0.8의 713개에서 +82: 엔진 성질 테스트와 등록 검사). 새 엔진의 수학적 성질을 검사합니다: MetroSets(노선이 집합의 모든 원소를 한 번씩 지남, 구간이 팔방위, 환승역 = 다중 소속), MosaicSets(셀이 서로 다름, 비용이 줄어듦, 중첩 집합이 연속 영역이 됨), InfoCrystal(조합 개수가 서로소이며 합이 전체, AND/OR 결과), SetNet(구역 안에 노드가 놓임), PAOHvis(하이퍼에지 구성과 합침 보존), Set Streams(리본이 개체를 보존), Sequence Braiding(사건열 순서 보존), Dust & Magnet(평형이 가중 평균, 자석 이동이 값에 비례해 먼지를 이동), GosperMap(곡선 단위 길이·점이 서로 다름·노드의 셀이 연결), WordStream(단어가 띠 안에 있고 겹치지 않음), TileBars(검색어 횟수), IBFV(임펄스가 흐름 방향으로 이동, 줄무늬 이방성), Hyperstreamlines(접선 = 고유벡터, 단면 비 = 고유값 비), Fiber Surfaces(모든 꼭짓점의 값 쌍이 다각형 경계 위, 사각 다각형의 역상이 기둥), Perspective Wall(단조·연속·역변환), VSUP(구간 수가 절반씩 줄어듦), 벡터장 위상(임계점 분류·위치·분리선 방향).
- 브라우저 테스트(Playwright): **428개 통과**(데스크톱 + Pixel 7 에뮬레이션 모바일). 전체 스위트를 한 번에 실행한 결과이며 개별 재실행으로 대체하지 않았습니다. 중간 실행에서 실패한 것은 개수 단언(카탈로그가 320종이 되어서)과 새 테스트의 가정 오류(주석·스펠링·셀 수)였고, 모두 원인을 고쳐 전체를 다시 실행했습니다.
- 모바일 검증은 **뷰포트 에뮬레이션**(Pixel 7 프로필, 가로·세로)입니다. 실제 휴대폰은 시험하지 못했습니다.
- CI(`.github/workflows/deploy.yml`)가 실제로 실행하는 범위: typecheck → lint → 단위 테스트 → build → **전체 e2e** → Pages 배포.

신규 e2e(`e2e/v9.spec.ts`, `e2e/v9.mobile.spec.ts`)가 확인하는 것: 320종 카드와 새 항목 검색, 19개 실험실의 차트·설명 섹션·‘서지 검증’ 표기, 설명이 해당 버전 그룹만 내려받는지, **설명 청크 실패 경로**(아래), 방법론별 인터랙션(MetroSets 노선 강조·소속 편집, MosaicSets 격자 전환, InfoCrystal 불리언 프리셋·조건 끄기, SetNet 소속 편집, PAOHvis 정렬·시간 범위·강조, Set Streams 리본 추적, Sequence Braiding 패턴 선택, Dust & Magnet 자석 이동, GosperMap 확대, WordStream 단어 선택, TileBars 질의, OD Maps·MapTrix 선택, Perspective Wall 초점 이동, IBFV 애니메이션 프레임, Hyperstreamlines 시드·고유벡터, Fiber Surfaces 다각형 편집, 벡터장 위상 유선 추가, Seesoft 검색, VSUP 모드와 새로고침 복원), 홈 애니메이션 8단계, 새 프리셋 10개, 연동 강조, 모바일 가로 스크롤 없음·터치 선택·화면 회전.

### 설명 로딩 실패 경로 테스트

`testWithBlockedRequests` 픽스처(`e2e/fixtures.ts`)는 의도적으로 막은 요청의 콘솔 오류(`Failed to load resource` 등)만 허용하고 그 외의 콘솔 오류·예외는 실패로 처리합니다(실제 제품 오류를 무시하지 않음). 테스트는 v9 설명 청크 요청을 중단시킨 뒤 ① 오류 문구와 ‘다시 시도’ 버튼이 보이고 차트는 계속 작동함 ② 다른 버전 그룹(v8)의 설명은 정상 ③ 같은 실험실로 돌아와도 실패가 캐시되지 않아 다시 오류 화면 ④ 네트워크를 복구하고 ‘다시 시도’를 누르면 설명이 표시되고 오류 화면이 사라짐 ⑤ 이후 같은 그룹의 다른 실험실은 추가 요청 없이 캐시에서 표시됨을 확인합니다.

## 성능과 번들 (이번 작업에서 실제로 측정한 값)

### 번들 크기 (`npm run build`)

| 청크 | v0.8 | v0.9 |
|---|---|---|
| 메인 번들(index) | 757.9 kB (gzip 255 kB) | **641.3 kB (gzip 209.0 kB)** |
| 데이터셋 생성기 | 메인 번들 안 | 별도 청크 `datasets` 110.1 kB (gzip 41.7 kB), 첫 카탈로그 썸네일이나 실험실을 열 때 로드 |
| 설명 텍스트 | legacy 148.7, v5 161.8, v6 146.1, v7 83.5, v8 67.9 kB | + **v9 77.6 kB** |
| Details | 265.4 kB | 265.5 kB |
| 신규 차트 청크 | — | setCharts9 18.3, sciCharts9 19.0, moreCharts9 25.8, 그 밖 tempo/multi/text/geoFocus 차트와 홈 프레임(heroFramesV9 8.2) 각각 별도 청크 |

메인 번들이 줄어든 이유와 한계:
- 홈 애니메이션(`heroFrames.ts`, `heroFramesV4.ts`)과 카탈로그 썸네일(`ChartPreview`)이 데이터셋 전체(214개 생성기)를 가져오고 있었습니다. 홈 단계가 쓰는 소수 데이터셋(`heroDatasets.ts`: 기본·V3·V4)만 메인에 두고, 썸네일은 첫 번째로 보일 때 `lab/state`(와 데이터셋 청크)를 동적으로 불러오게 했습니다.
- 신규 19종의 카탈로그 메타데이터·표현 원리·프리셋·홈 단계 목록이 메인에 약 35 kB를 더했습니다. 따라서 실제로 줄어든 폭은 약 150 kB입니다.
- 메인 번들의 약 절반(소스 기준 635k 글자)은 `react-dom`이라 더 줄이기 어렵습니다. 카탈로그 메타데이터·검색 키워드·표현 원리 데이터를 분리하는 것은 검토만 했고 구현하지 않았습니다(카탈로그 페이지와 사이드바 개수가 모두 이 데이터를 쓰므로 홈 첫 로딩에서 빼려면 사이드바 개수 표기와 검색 구조를 바꿔야 함).
- 초기 렌더링 시간은 v0.8과 같은 조건으로 비교하지 못했고, 바이트 크기만 비교했습니다.

### LIC (Web Worker, 취소 지원)

`licJob.ts`의 같은 계산(`licFast`: 격자마다 단위 방향을 한 번 계산하고 걸음 중에는 쌍선형 보간)을 Worker에서 실행합니다. 낮은 해상도(1/3) 미리보기를 먼저 보내고 전체 해상도를 이어서 보내며, 설정이 바뀌면 이전 Worker를 종료합니다. 결과의 의미는 유지됩니다(기존 `lic`와 상관계수 0.85 초과, 균일 흐름에서 줄무늬 방향 동일, 단위 테스트).

| 측정 | 결과 |
|---|---|
| 순수 계산 시간(단일 스레드, 3회 평균) | 120×120: 38→30 ms, 200×200: 155→129 ms, 300×300: **599→559 ms** (`lic`→`licFast`) |
| 300×300로 해상도를 바꿀 때 | 미리보기가 약 76 ms 안에 표시되고 전체 해상도가 약 508 ms에 완료. 계산 중 최대 프레임 간격 17 ms, 50 ms 넘은 프레임 0 / 32 |

계산 자체의 속도 향상은 1.1~1.3배로 작습니다(필드 평가가 병목이 아니었음). 달라진 것은 **계산 중에도 UI가 멈추지 않고 미리보기가 먼저 나온다**는 점입니다. v0.7의 1.1초 측정값과는 조건이 달라 속도가 빨라졌다고 주장하지 않습니다. 결과 캐싱은 별도로 하지 않았습니다(컴포넌트 메모만).

### 시도하지 못한 것

- 3,000노드 네트워크의 Canvas 렌더링·공간 인덱스 개선과 조사는 하지 않았습니다.
- WebGL 렌더러는 도입하지 않았습니다. 신규 3D·과학 기법은 기존 Canvas/SVG 키트로 구현했고 성능(삼각형 수)을 따로 측정하지 못했습니다. Fiber Surfaces는 셀 수를 6만으로 제한하고, 기본 14³ 격자에서 약 3,600개의 삼각형을 그립니다.
- IBFV는 CPU 계산(기본 200×200)이며 이 크기에서 프레임 간격이 안정적이었는지는 e2e의 ‘프레임이 계속 증가’ 수준으로만 확인했습니다.

## 연동 하이라이트: 동일 데이터셋 공유와 Linked Highlighting의 구분

| 상태 | 해당 |
|---|---|
| **데이터셋 공유 + 연동 강조 지원(원소·관측 행 단위)** | MetroSets·MosaicSets(원소 행; 프리셋 `set-metro`에서 레인보우 박스와 함께), SetNet(노드 행), Dust & Magnet(관측 행; RadViz·스타 좌표와 함께, 프리셋 `multivar-dust`) |
| 데이터셋만 공유 | InfoCrystal, PAOHvis, Set Streams, Sequence Braiding, GosperMap, WordStream, TileBars, OD Maps, MapTrix, Perspective Wall, IBFV, Hyperstreamlines, Fiber Surfaces, 벡터장 위상, Seesoft(집계 단위이거나 자체 기하라 관측 행으로 되돌리지 못함) |

모든 차트가 연동 강조를 지원하는 것은 아닙니다. 검증된 쌍은 e2e(`linked highlighting` 테스트)의 `set-metro`(모자이크 셀 → 메트로셋 역) 입니다. SetNet·Dust & Magnet의 연동은 같은 방식으로 구현했고 `multivar-dust`의 Dust & Magnet은 e2e로 확인했으나, RadViz·스타 좌표 쪽의 반응은 v0.7 기존 기능입니다.

## 알려진 문제

- 요청서의 일부 후보(Sequen-C, ZAME, EulerView, Dual Radial Sets, Superquadric Tensor Glyphs, MatrixExplorer, Scagnostics)는 구현하지 않았습니다(`v09-research.md`).
- 서지: Sequence Braiding·VSUP·InfoCrystal·OD Maps·Seesoft·Vector Field Topology·Hyperstreamlines 등은 DOI를 확인하지 못했고, 요청서와 다르게 확인된 저자·학회 정보는 `v09-research.md`에 정리했습니다.
- 한국어 검색(TileBars·Seesoft)은 형태소 분석이 아닌 부분 문자열 일치입니다.
- 새 기법 19종은 모두 원 논문의 알고리즘을 단순화한 구현입니다. 단순화한 내용은 각 항목의 설명(‘주의사항’)과 `v09-research.md`에 적었고 완전한 재현이라고 주장하지 않습니다.
- 홈 애니메이션 새 8단계(MetroSets 등)는 단순화한 정지 장면의 morph이고 인터랙티브하지 않습니다.

## 배포 확인

- 푸시 `dac92ee`의 첫 GitHub Actions 실행(41484376170): typecheck·lint·단위 테스트·build는 성공, **e2e 단계에서 실패**해 배포되지 않았습니다. 로컬 전체 실행(4 workers)은 428개 통과였지만, CI와 같은 설정(`CI=1`, 2 workers)으로 다시 실행하니 v7의 LIC 테스트 1개가 실패했습니다. 원인: LIC가 Web Worker에서 비동기로 계산되도록 바뀌었는데 테스트가 캔버스를 곧바로 읽었습니다(제품 결함이 아니라 테스트의 가정 오류). 테스트가 ‘계산 중’ 표시가 사라지고 캔버스가 칠해질 때까지 기다리도록 고쳤고 `CI=1`로 3회 반복해 통과를 확인했습니다. 이렇게 로컬 통과와 CI 실패가 갈린 것은 이번에 처음이며, 앞으로 전체 스위트를 CI 설정(`CI=1`)으로 한 번 더 돌려 보는 것이 안전합니다.
