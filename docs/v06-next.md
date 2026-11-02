# VizLab v0.6 이후 이어서 할 일

## 현재 위치

- v0.6 구현 범위: 250종, 17개 카테고리, 홈 애니메이션 50종, 데이터셋 181개. 자세한 내용은 `v06-inventory.md`, `v06-progress.md`.
- 새 계산 엔진은 모두 `src/stats/`에 있고(`ml`, `tsa`, `fractal`, `physics`, `field3d`, `chem`, `geostat`, `finance2`, `graph2`, `applied`) 각각 `v6*.test.ts`가 있습니다.
- 차트 추가 절차(검증된 순서): 엔진 + 단위 테스트 → 예제 데이터(`datasetsV6*.ts`, id를 `datasetIdsV6.ts`에 등록) → 차트 모듈(`charts/*.tsx`) → 카탈로그(`catalogV6*.ts`)와 설명(`content/v6*.ts`) → `loadersV6.ts` 등록 → `UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts` → 화면 캡처 확인.

## 우선순위 제안

1. 소프트웨어 SW01–SW08 (새 카테고리 필요): 트레이스 워터폴, 시간 플레임 차트, 차등 플레임 그래프, 지배자 트리, git 그래프 등. 기존 `flame`과 `LayeredGraph`(`graphCharts2.tsx`)를 재사용할 수 있습니다.
2. 텍스트: 워드 클라우드(겹침 없는 배치), KWIC, 토픽 모형(LDA 깁스 샘플링)과 감성 강.
3. 생물: Hi-C 행렬, 단일세포 지도·의사시간, CNV, 아이소폼.
4. 네트워크: 시간 네트워크·에지 타임라인.
5. v0.5 잔여 A01–A08 (Circos, 유전체 트랙, FDEB 등).
6. 비교 실험실의 연동 하이라이트(`linked`)를 v0.6 차트로 확대: 현재 새 프리셋 9개는 같은 표를 공유하지만 새 차트는 관측 단위 연동 강조를 아직 구현하지 않았습니다.
7. WebGL 렌더러 검토: 3차원 필드·부피 렌더링은 CPU/Canvas라 큰 격자에서 느립니다.

## 알려진 한계

- 어텐션 맵은 학습하지 않은 임의 가중치, UMAP은 단순화 변형입니다(화면에 표시).
- 블록 모형은 노드 120개, 스펙트럼 임베딩은 160개, 고장 수목은 기본 사건 18개까지만 계산합니다.
- 실제 모바일 기기 시험은 하지 않았습니다(뷰포트 에뮬레이션만).
- 메인 번들이 커졌습니다(`Details` 청크 약 720 kB, gzip 232 kB). 설명 데이터를 분야별로 지연 로드하면 줄일 수 있습니다.
