# VizLab v0.9 이후 이어서 할 일

## 현재 위치

- v0.9 구현 범위: 도감 320종(17개 카테고리), 신규 독립 방법론 19종(+ VSUP를 기존 차트에 통합), 홈 애니메이션 80단계, 데이터셋 214개, 비교 실험실 추천 조합 59개. 목록은 `v09-inventory.md`, 후보·서지 검증은 `v09-research.md`, 작업 기록과 측정은 `v09-progress.md`.
- 신규 계산 엔진: `src/stats/`의 `sets9`(MetroSets·MosaicSets·InfoCrystal·SetNet), `tempo9`(PAOHvis·Set Streams·Sequence Braiding), `multi9`(Dust & Magnet·GosperMap), `text9`(WordStream·TileBars·Seesoft), `focus9`(Perspective Wall·Bifocal), `geo9`(OD Maps·MapTrix), `field9`(IBFV·Hyperstreamlines·Fiber Surfaces·벡터장 위상), `vsup`. 각각 `v9*.test.ts`.
- 차트 추가 절차는 v0.8과 같습니다(`v08-next.md`). v0.9에서 달라진 점: 설명은 `content/v9*.ts`를 `content/v9.ts`에 모으고 `content/loader.ts`의 ‘v9’ 그룹을 씁니다. 등록은 `catalogV9.ts`, `charts/loadersV9.ts`입니다. `kinds.ts`와 `encodings.ts`에는 스크래치 스크립트 대신 같은 문자열에 ID를 직접 추가하면 됩니다. 새 차트마다 `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts`를 실행합니다.
- 새 기법의 `registry.test.ts` 요구: 서버 렌더에서 `<svg`가 있어야 하고 모양(shape)이 compact 1개 초과·일반 5개 초과여야 합니다(캔버스 중심 차트는 테두리·범례 도형을 SVG로 함께 그립니다. IBFV 참고).
- `encodings.test.ts`는 ‘복합 표현’ 주분류를 화이트리스트로 제한합니다. 새 기법이 복합이면 다른 주분류를 고르거나 화이트리스트를 늘립니다.

## 미구현·보류 후보 (우선순위)

1. **ZAME**(Elmqvist 외 2008): 서지 확인됨. 다중 스케일로 집계한 인접 행렬. 기존 `adjacency`의 집계·확대 모드와 겹치는지 먼저 비교.
2. **Sequen-C**(Magallanes 외 2021/2022): 서지 확인됨. LifeFlow·Sequence Braiding에 ‘유사한 경로 군집·정렬’ 모드로 추가하는 방식 권장.
3. **EulerView, Dual Radial Sets, Superquadric Tensor Glyphs, MatrixExplorer**: 서지를 확인하지 못했습니다. 먼저 서지와 독립성을 확인하세요.
4. **추가 발굴**: 시간·관계, 텍스트 구조, 지리(MapTrix 이후), 과학(다변량 필드, 시간에 따라 변하는 3D 필드, 불확실성) 분야를 체계적으로 훑지 못했습니다(후보 조사는 29개로 목표 30~50개에 1개 부족). IEEE VIS/EuroVis 논문의 ‘표현 구조’를 기준으로 더 찾아야 합니다.
5. 기존 차트 확장: Scagnostics(산점도 형태 지표), VSUP를 다른 색 차트(히트맵·코로플레스)에도 적용.

## 알려진 문제와 한계

- 19종 모두 원 논문의 알고리즘을 단순화한 구현입니다(차이는 각 설명의 ‘주의사항’과 `v09-research.md`). 완전한 재현이라고 주장하지 않습니다.
- Sequence Braiding·VSUP·InfoCrystal·OD Maps·Seesoft·Vector Field Topology 등은 DOI를 직접 확인하지 못했습니다(설명에 ‘확인되지 않음’).
- 모든 신규 데이터셋은 합성입니다.
- 한국어 텍스트 일치는 형태소 분석이 아닌 글자 그대로의 부분 문자열입니다(TileBars·Seesoft 검색).
- IBFV는 CPU 계산(기본 200×200)이고, 필드·3D 기법은 Canvas/SVG입니다. WebGL은 도입하지 않았습니다.
- 모바일은 뷰포트 에뮬레이션(Pixel 7 프로필)으로만 검증했습니다.
- 성능 항목(LIC 최적화, 3,000노드 네트워크, 메인 번들 분리)은 `v09-progress.md`의 ‘성능’에 한 것과 하지 못한 것을 구분해 적었습니다.

## 재개 절차

1. `git pull` 후 `npm ci`.
2. `npx tsc -b --noEmit && npx eslint . && npx vitest run`.
3. `npm run build && npx playwright test`(빌드를 다시 하면 미리보기 서버가 바뀌므로 실행 중에는 빌드하지 않습니다).
4. 새 차트는 위 ‘차트 추가 절차’를 따릅니다. 항목 수가 바뀌면 `registry.test.ts`, `kinds.test.ts`, `hero.test.ts`, `compare.test.ts`, e2e 스펙의 개수 단언(`app`·`mobile`·`tablet`·`v3`·`v8`·`v9`)을 함께 고칩니다.
5. 포인터 캡처가 있는 SVG·3D 오빗 박스에서는 자식의 `click`이 도착하지 않을 수 있습니다. 선택은 `pointerdown`에서 처리하세요.
6. 설명 청크 로딩 실패는 `testWithBlockedRequests` 픽스처(`e2e/fixtures.ts`)로 테스트합니다. 의도적으로 막은 요청의 콘솔 오류만 허용하고 나머지 오류는 실패로 봅니다.
