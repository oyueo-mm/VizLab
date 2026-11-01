# VizLab v0.6 작업 재개 문서

이 문서만 읽고 이어서 개발할 수 있어야 합니다. 저장소 상태와 맞게 유지합니다.

## 현재 상태

- 기준: v0.5 `7131ea9`(167종). 마지막 정상 커밋: `14e8866` (batch 3b). 시각화 **216종** (+49), vitest **514개** 통과.
- 완료한 배치: 1 기계학습 18, 2 통계·시계열·베이지안 15, 3a 프랙탈·동역학·응집물질 10, 3b 3D 장·분자·결정 6.
- 구현 중: 없음. 다음은 지리공간 → 금융 → 생물정보 → 네트워크 → 텍스트 → 소프트웨어 → 산업 순서(요청서 권장 순서와 같으며, 이미 계산 엔진이 있는 지리·네트워크를 앞당김).
- 홈 애니메이션(36단계), 비교 실험실, e2e(Playwright) 테스트는 아직 v0.5 그대로입니다. 마지막 배치에서 갱신합니다 (기존 spec의 개수 기대값 167 → 최종 개수, 카테고리 목록 등을 함께 고쳐야 함: `e2e/*.spec.ts`, `src/viz/registry.test.ts`).

## 새 시각화를 추가하는 방법 (순서)

1. `src/stats/<분야>.ts`에 계산 엔진 + `src/stats/v6<분야>.test.ts` (기준값·성질로 검증).
2. `src/data/datasetsV6<분야>.ts`에 데이터셋 → `datasetsV6.ts`에 합치고 `datasetIdsV6.ts` 유니온에 id 추가.
3. `src/viz/charts/<분야>Charts.tsx`: 모듈(roles, datasets, defaultParams, Chart, Controls, hint). 공통 부품: `kit.tsx`(`XYPlot`, `HeatGrid`, `Stage`, `Panels`), `kitPlane.tsx`(캔버스 복소평면 `Plane`), `kit3d.tsx`(`Scene3D` 궤도 카메라).
4. `loadersV6.ts`에 로더, `catalogV6<분야>.ts`에 메타(`catalogV6.ts`에 합침), `src/content/v6<분야>.ts`에 설명(`content/v6.ts`에 합침). 새 카테고리는 `types.ts`·`catalog.ts`(categories, subcategories)·`components/icons.ts`·`registry.test.ts`의 카테고리 목록.
5. `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts` 후 `npx vitest run`.
6. `registry.test.ts`가 모든 카탈로그 항목을 서버 렌더·빈 데이터·텍스트 셀·null·1행으로 검사하고(기본 데이터셋 전부에서 `chart-message`가 없어야 함), 비-컴팩트 렌더는 도형 요소 6개 초과, 설명의 KaTeX와 수식 설명(caption) 4자 이상을 요구합니다.

## 실행할 테스트

- `npx tsc -b --noEmit && npx eslint src && npx vitest run`
- 브라우저: `npm run build` 후 `npx playwright test` (빌드 중 실행 금지). 스크린샷 점검은 `npx vite --host 127.0.0.1 --port 5199` + 스크래치패드의 `shot.mjs <base> <outdir> <id>...`.

## 변경하면 안 되는 기존 동작

- 기존 167종의 id·딥링크·렌더링·계산, 하위 카테고리 URL(`?s=`), 홈 36단계 순서와 1.8초 전환, 홈 타이머 한 개 구조, 흰색 배경 디자인.
- Bash 도구의 긴 heredoc(한글·따옴표 포함)은 실패합니다. 파일은 Write 도구로 만들고 `scratch/*.py` 패치 스크립트를 실행하세요(`scratch/`는 .gitignore).

## 알려진 제한 (현재까지)

- `loss-landscape`는 2D 등고선만(3D 표면 미구현). `attention-map`은 학습되지 않은 가중치(화면에 명시).
- `volume-rendering`·`isosurface`·`tensor-glyph`는 WebGL이 아닌 CPU/Canvas 렌더링이라 큰 격자에는 느립니다.
- `umap`은 PCA 초기화·정확한 이웃 탐색을 쓰는 단순판(umap-learn과 수치가 같지는 않음).
- 실제 모바일 기기에서는 확인하지 못했고 에뮬레이션만 검증합니다(마지막 배치).
