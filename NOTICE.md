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
