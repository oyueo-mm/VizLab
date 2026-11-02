# VizLab v0.7 이후 이어서 할 일

## 현재 위치

- v0.7 구현 범위: 도감 281종(17개 카테고리), 신규 방법론 31종, 홈 애니메이션 64단계, 데이터셋 190개, 비교 실험실 추천 조합 40종. 목록은 `v07-inventory.md`, 분류 기준은 `v07-classification.md`, 작업 기록은 `v07-progress.md`.
- 신규 계산 엔진은 `src/stats/`의 `multivar7`, `uncert7`, `struct7`, `net7`, `sci7`에 있고 각각 `v7*.test.ts`가 있습니다.
- 차트 추가 절차(v0.6과 동일, 검증된 순서): 엔진 + 단위 테스트 → 예제 데이터(`datasetsV7*.ts`, ID는 `datasetIdsV7.ts`) → 차트 모듈(`charts/*Charts7*.tsx`) → 카탈로그(`catalogV7*.ts`)와 설명(`content/v7*.ts`) → `loadersV7.ts` 등록 → `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts` → 성격은 `src/viz/kinds.ts`의 `extraKinds`(기본값은 ‘전문 도표’)에 등록 → 화면 캡처 확인.
- 새 설명 필드: `encoding`(시각적 매핑), `differs`(다른 기법과의 차이), `note`(분류 메모), `references`(참고문헌).

## 미구현 후보 (우선순위)

1. **집합 윤곽 계열**: Bubble Sets, LineSets, Kelp Diagram (등치 곡선으로 영역을 만드는 공통 엔진 하나로 세 기법을 처리). Rainbow Boxes.
2. **NodeTrix**: 군집 검출(기존 `louvain`) + 군집 내부 인접 행렬 + 군집 간 링크의 혼합 배치.
3. **Cone Tree, Stream Surface, Streamtube**: 3차원 장면. `kit3d.tsx`와 `field3d.streamline`을 재사용하되 WebGL 렌더러 검토가 필요합니다(지금은 SVG/Canvas).
4. **Event Sequence Visualization**: 이벤트 래스터·간트와 겹치는 부분을 검증한 뒤, 시퀀스 유사도 정렬·반복 패턴 검색이 독립 표현이면 신규, 아니면 이벤트 래스터의 모드로 통합.
5. **후보 목록 밖의 기법 발굴**: Information visualization, scientific visualization 문헌(IEEE VIS, EuroVis)에서 표현 원리가 새로운 기법을 조사합니다. 이번 버전에서는 조사 시간을 확보하지 못했습니다. 후보 예: Scagnostics(산점도 행렬의 형태 지표), 새로 제안된 불확실성·시간 표현.

## 개선 아이디어

- **연동 하이라이트**: 이번에 RadViz·Star Coordinates·Grand Tour가 비교 실험실의 `linked`를 지원합니다. 다른 신규 기법(차원 쌓기, 테이블 렌즈, 패럴렐 셋)에도 관측 단위 연동을 넣으려면 칸·리본이 포함하는 행 목록을 노출해야 합니다.
- **WebGL 렌더러**: 3D 지구본은 SVG 직교투영이라 국가 수가 많은 지도(행정동 등)에서는 느립니다. 큰 폴리곤은 Canvas 또는 WebGL로 옮기는 편이 좋습니다.
- **메인 번들**: `Details` 청크가 약 800 kB(gzip 262 kB)로 커졌습니다. 설명 데이터(`content/*.ts`)를 분야별로 지연 로드하면 줄일 수 있습니다.
- **네트워크 3,000노드 성능**: v0.6의 알려진 한계로, 이번 버전에서는 손대지 못했습니다(Canvas 렌더링 + 공간 인덱스 필요).
- **분류 하위 기준**: 방법론 142개 중에는 ‘같은 인코딩의 분야 적용’(지도 계열 등)이 섞여 있습니다. 필요하면 ‘핵심 표현 원리’ 하위 태그를 추가해 독립 표현의 수를 더 엄격히 셀 수 있습니다.

## 알려진 한계

- 실제 모바일 기기 시험은 하지 않았습니다(뷰포트 에뮬레이션만).
- 워드 클라우드·워드 트리의 한국어 토큰화는 조사 하나를 떼는 보수적 규칙입니다. 형태소 분석이 아니므로 `값을`처럼 어간이 한 글자인 단어는 그대로 남습니다.
- FDEB는 간선 300개, 태그 클라우드는 문장 수에 비례해 계산합니다. 큰 입력은 표본추출하며 화면에 표시합니다. 데이터 표본은 모두 합성입니다.
- Voronoi 트리맵의 면적 오차는 반복 횟수에 따라 1~3%입니다(표시 옵션으로 조정).
- 분류는 사람의 판단이며 경계가 연속적입니다.

## 재개 절차

1. `git pull` 후 `npm ci`.
2. `npx tsc -b --noEmit && npx eslint . && npx vitest run`(단위 약 650개).
3. `npm run build && npx playwright test`(브라우저 약 400개). 빌드를 다시 하면 미리보기 서버가 바뀌므로 실행 중에는 빌드하지 않습니다.
4. 새 차트는 위 ‘차트 추가 절차’를 따릅니다. 성격·카테고리 개수가 바뀌면 `registry.test.ts`, `kinds.test.ts`, e2e 스펙의 개수 단언을 함께 고칩니다.
