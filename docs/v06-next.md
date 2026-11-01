# VizLab v0.6 작업 재개 문서

이 문서만 읽고 이어서 개발할 수 있어야 합니다. 저장소 상태와 맞게 유지합니다.

## 현재 상태

- 기준 커밋: v0.5 `7131ea9` (167종). 배치 1(기계학습 18종)을 커밋하면 이 문서의 “마지막 정상 커밋”을 갱신합니다.
- 구현 중: 없음 (배치 단위로 커밋)

## 새 시각화를 추가하는 방법 (순서)

1. `src/stats/<분야>.ts`에 계산 엔진, `src/stats/v6<분야>.test.ts`에 기준값·성질 테스트.
2. `src/data/datasetsV6<분야>.ts`에 데이터셋 → `src/data/datasetsV6.ts`에 합치고 `src/data/datasetIdsV6.ts`의 유니온에 id 추가.
3. `src/viz/charts/<분야>Charts.tsx`에 모듈(roles, datasets, defaultParams, Chart, Controls, hint). 공통 부품은 `kit.tsx`(`XYPlot`, `HeatGrid`, `Stage`).
4. `src/viz/charts/loadersV6.ts`에 로더, `src/viz/catalogV6<분야>.ts`에 메타(`catalogV6.ts`에 합침), `src/content/v6<분야>.ts`에 설명(`content/v6.ts`에 합침). 새 카테고리는 `types.ts`·`catalog.ts`·`components/icons.ts`.
5. `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts`로 `needs.ts` 재생성 후 `npx vitest run`.
6. `src/viz/registry.test.ts`가 모든 카탈로그 항목을 서버 렌더·빈 데이터·텍스트 셀·null·1행으로 검사합니다. 새 차트는 이 모든 경우에 예외 없이 그려야 합니다.

## 실행할 테스트

- `npx tsc -b --noEmit && npx eslint src && npx vitest run` (현재 454개)
- 브라우저: `npm run build` 후 `npx playwright test` (빌드 중에 실행 금지). 스크린샷 점검은 `vite` dev 서버 + 스크래치패드의 `shot.mjs <base> <outdir> <id>...`.

## 변경하면 안 되는 기존 동작

- 기존 167종의 id·딥링크·렌더링·계산, 하위 카테고리 URL(`?s=`), 홈 36단계 순서와 1.8초 전환, 홈 타이머 한 개 구조, 흰색 배경 디자인.
- Bash 도구의 긴 heredoc(한글 포함)은 실패합니다. 파일은 Write 도구로 만들고 `scratch/*.py` 패치 스크립트를 실행하세요(`scratch/`는 .gitignore).

## 다음 작업 순서

배치 2: 고급 통계·시계열(ST01–ST15) → 배치 3: 물리·수학(프랙탈 등)·지리공간 → 배치 4: 생물·금융·네트워크·텍스트·소프트웨어·산업 → 배치 5: 검색·비교 실험실·홈 애니메이션 확장 → 배치 6: 회귀 테스트·성능·문서·배포.
