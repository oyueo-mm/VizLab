# 제3자 데이터·소프트웨어 고지

## 지도 데이터

- **Natural Earth** (https://www.naturalearthdata.com/) — 세계 국가 경계(1:110m Admin 0 – Countries), 시도 경계(1:10m Admin 1 – States, Provinces). Natural Earth의 모든 데이터는 **퍼블릭 도메인**이며 상업적 이용을 포함해 제약 없이 쓸 수 있습니다(https://www.naturalearthdata.com/about/terms-of-use/). `src/geo/data/world.topo.json`, `korea.topo.json`, `stats.ts`는 이 데이터에서 `scripts/build-geo.mjs`로 만든 파생물(좌표 단순화·양자화, 한국어 국가명, Natural Earth 속성의 인구·GDP)입니다. 경계는 학습용으로 단순화했으며 공식 경계가 아닙니다.
- 한국 시도별 인구는 2023년 주민등록 인구를 반올림한 근삿값이며, 흐름·위치·메타분석·프로세스·프로파일 등 나머지 데이터셋은 모두 이 프로젝트가 만든 **합성 데이터**입니다(데이터 설명에 표시).

## 새로 추가한 의존성 (v0.4)

| 패키지 | 용도 | 라이선스 |
| --- | --- | --- |
| topojson-client | 런타임에서 TopoJSON → GeoJSON 변환 | ISC |
| topojson-server, topojson-simplify | 지도 데이터 생성 스크립트 전용(번들에 포함되지 않음) | ISC |
| @types/topojson-client, @types/topojson-specification | 타입 정의(개발 전용) | MIT |

기존 의존성(React, D3, KaTeX, lucide-react 등)의 라이선스는 각 패키지를 따릅니다. d3-geo·d3-force·d3-zoom은 이미 설치된 D3(ISC)의 일부입니다.

## v0.6에서 추가한 데이터와 알고리즘 출처

- **새 의존성은 없습니다.** 모든 새 계산(t-SNE, UMAP 변형, 정확한 Shapley, ALE, MCMC 진단, 크리깅, 이차계획, 블랙–숄즈, 그래프 라플라시안, 에드먼즈–카프, 루뱅, 와이블 순위회귀, GSEA, 이면각 등)은 공개 문헌의 정의를 이 프로젝트가 직접 구현했으며 외부 코드·이미지를 복사하지 않았습니다.
- UMAP의 a, b 곡선 맞춤은 umap-learn의 `find_ab_params` 정의와 같은 값을 내도록 검증했습니다(코드는 복사하지 않음). 최대 유량 시험값은 CLRS 교재 예제의 결과(23)입니다.
- **새 예시 데이터는 모두 이 프로젝트가 만든 합성 데이터**입니다(서열·골격 좌표·말뭉치·옵션 시세·호가·수명 시험 포함). 실제 환자·유전체·시세 자료를 쓰지 않았습니다.

## v0.5에서 추가한 데이터와 알고리즘 출처

- **새 의존성은 없습니다.** 새 계산은 기존 D3(ISC)의 `d3-contour`, `d3-delaunay`, `d3-force`, `d3-hierarchy`와 이 프로젝트가 직접 구현한 코드로 이루어집니다.
- **새 예시 데이터는 모두 이 프로젝트가 만든 합성 데이터**입니다(지형, 기온 관측소, 바람장, GPS 궤적, 회귀·생존·공정 데이터, 신호, 시세, 호가창, 발현·GWAS·서열·거리 행렬, 동아리 소속 등). 실제 지형·도로·환자·유전체 자료를 쓰지 않았고, 데이터 설명에 합성임을 밝혔습니다. 실제 경계는 위의 Natural Earth 세계·한국 시도 지도만 씁니다.
- 알고리즘은 공개된 문헌의 정의를 직접 구현했습니다: 음영기복·경사(Horn 1981 기울기), 등간격 유선(Jobard & Lefer 1997), 카토그램(Dougenik 외 1985, Olson 1976, Demers), Moran I·Getis-Ord Gi*(Anselin 1995, Ord & Getis 1995), Kaplan–Meier·Greenwood·로그순위·Nelson–Aalen, BCa 부트스트랩(Efron 1987), EWMA·CUSUM, Nelson–Siegel(1987), 이웃 연결법(Saitou & Nei 1987), UPGMA, 서열 로고 정보량과 표본 수 보정(Schneider 외 1986), PCoA(Gower 1966), BioFabric(Longabaugh 2012), UpSet(Lex 외 2014), Benjamini–Hochberg(1995). 구현의 검증 기준은 `src/stats/v5*.test.ts`에 있습니다.
