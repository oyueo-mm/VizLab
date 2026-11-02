# VizLab v0.8 이후 이어서 할 일

## 현재 위치

- v0.8 구현 범위: 도감 301종(17개 카테고리), 신규 방법론 20종, 표현 원리 태그 16종과 도감 필터, 홈 애니메이션 72단계, 데이터셋 199개, 비교 실험실 추천 조합 49개. 목록은 `v08-inventory.md`, 후보 조사는 `v08-research.md`, 태그는 `v08-encodings.md`, 작업 기록은 `v08-progress.md`.
- 신규 계산 엔진: `src/stats/`의 `sets8`, `graph8`, `viz3d8`, `relate8`, `tempo8`, `text8`(각각 `v8*.test.ts`)와 `fdeb.worker.ts`.
- 차트 추가 절차(검증된 순서): 엔진 + 단위 테스트 → 예제 데이터(`datasetsV8*.ts`, ID는 `datasetIdsV8.ts`) → 차트 모듈(`charts/*Charts8.tsx`) → 카탈로그(`catalogV8*.ts`)와 설명(`content/v8*.ts`) → `loadersV8.ts` 등록 → `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts` → 성격(`kinds.ts`의 `extraKinds` 문자열)·표현 원리(`encodings.ts`의 `MAIN`/`SECOND_LIST`) 등록 → 화면 캡처 확인 → 개수 단언(`registry.test.ts`, e2e)·`loader.test.ts` 확인.
- 설명 콘텐츠는 버전 그룹(legacy, v5, v6, v7, v8) 청크로 나뉩니다. 새 설명 파일은 해당 버전 그룹의 집계 파일(`content/v8.ts`)에 등록하고, 새 버전을 만들면 `content/loader.ts`의 그룹 표에 추가합니다.

## 미구현·보류 후보 (우선순위)

1. **Sequence Braiding**(DiBartolomeo 외 2020): 사건 종류 열 × 속성 행 격자의 층 DAG. `graph2.dagLayout`과 LifeFlow의 시퀀스 모델을 재사용할 수 있습니다.
2. **SetNet**(Rodgers 외 2016): Euler 영역 배치와 네트워크 배치의 공동 최적화가 필요합니다.
3. **MatrixExplorer 계열·Document Cards**: 먼저 독립 표현인지 판단하고, 아니면 기존 인접 행렬 실험실에 정렬·인터랙션으로 통합합니다.
4. **Event Sequence의 시퀀스 유사도 정렬·군집**(Sequen-C 계열): LifeFlow에 정렬 모드로 추가할 수 있습니다.
5. Scagnostics, Dual Radial Sets, Set Streams 등 `v08-research.md`의 ‘조사만’ 항목.
6. 신규 독립 방법론 30종, 도감 320종(도전 목표)은 달성하지 못했습니다. 후보 발굴은 IEEE VIS/EuroVis 논문의 ‘표현 구조’를 기준으로 더 진행해야 합니다.

## 개선 아이디어

- **성능 미착수 항목**: LIC(300×300 약 1.1초)의 Worker·저해상도 미리보기, 3,000노드 네트워크의 Canvas 렌더링·공간 인덱스(v0.6부터의 한계), FDEB의 입력 크기별 단계 수 조절.
- **WebGL 렌더러**: 3D 기법은 직교 투영 Canvas입니다. 노드 수가 큰 콘 트리나 조밀한 스트림 서피스가 필요해지면 도입을 검토하되 GPU 자원 정리와 미지원 환경 처리를 먼저 설계하세요.
- **연동 하이라이트**: Radial Sets·Cone Tree·LifeFlow 등은 집계 단위라 관측 행을 되돌려 주지 않습니다. 집계가 포함하는 행 목록을 노출하면 지원할 수 있습니다.
- **Power Graph 중첩**: power 노드가 서로 겹치지 않는 평평한 형태입니다. 중첩을 허용하면 압축률이 더 높아집니다.
- **Semantic Substrates**: 영역마다 다른 축 속성, 로그 축 지원.
- **설명 청크 실패 경로**: 브라우저 테스트가 콘솔 오류를 실패로 보기 때문에 실패 경로(`details-retry`)를 e2e로 검사하지 못했습니다. 이 검사만 오류를 허용하는 fixture를 두면 됩니다.
- **메인 번들**: 카탈로그·표현 원리 데이터가 메인 번들에 들어 있어 757 kB(gzip 255 kB)입니다. 카탈로그 요약·키워드를 분리·지연 로드하면 줄일 수 있습니다.

## 알려진 한계

- 실제 모바일 기기 시험은 하지 않았습니다(뷰포트 에뮬레이션만).
- 새 기법 20종은 모두 원 논문의 알고리즘을 단순화한 구현입니다. 단순화한 내용은 각 항목의 설명(‘주의사항’)과 `v08-inventory.md`에 적었고 완전한 재현이라고 주장하지 않습니다.
- 데이터는 모두 합성입니다(데이터셋 설명에 명시).
- TextArc·Phrase Net의 한국어 조사 처리는 형태소 분석이 아닙니다.
- 분류(성격·표현 원리)는 사람의 판단이며 경계가 연속적입니다.

## 재개 절차

1. `git pull` 후 `npm ci`.
2. `npx tsc -b --noEmit && npx eslint . && npx vitest run`(단위 713개).
3. `npm run build && npx playwright test`(브라우저 398개, 약 2.5분). 빌드를 다시 하면 미리보기 서버가 바뀌므로 실행 중에는 빌드하지 않습니다.
4. 새 차트는 위 ‘차트 추가 절차’를 따릅니다. 항목 수·카테고리 수가 바뀌면 `registry.test.ts`, `kinds.test.ts`, `hero.test.ts`, e2e 스펙의 개수 단언을 함께 고칩니다(`e2e/app.spec.ts`, `v4`–`v6.spec.ts`, `v8.spec.ts`).
5. 포인터 캡처가 있는 SVG·3D 오빗 박스에서는 자식의 `click`/`dblclick`이 도착하지 않습니다. 선택은 `pointerdown`에서 처리하세요(콘 트리·NodeTrix 참고).
