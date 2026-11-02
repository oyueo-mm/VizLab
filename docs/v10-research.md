# VizLab v1.0 — 조사 기록

이 문서는 v1.0에서 새로 조사한 기법과 서지 확인 결과를 정직하게 기록한다. 서지 확인은 웹 검색 결과(출판사·대학 저장소·DBLP·위키 등 기록)로 했으며, **원문 PDF를 직접 읽어 확인한 것은 없다.** 확인하지 못한 항목은 ‘확인되지 않음’으로 적었다.

## 1. 수치 (목표와 실제)

| 항목 | 목표 | 실제 |
| --- | --- | --- |
| 새로 웹 검색으로 조사한 후보 | 50개 이상 | **약 24개** (목표 미달) |
| 구현한 새 기법 | 20~30개 | **20개** (카탈로그 320 → 340) |
| 구현하지 않고 조사만 한 후보 | — | 4개 안팎 (아래 3절) |

50개 이상 조사한다는 목표는 채우지 못했다. 후보 이름을 떠올리기만 하고 검색하지 않은 것은 ‘조사했다’고 세지 않았다. 앞선 버전(v0.9)에서 이미 조사·구현한 기법(SetNet, MapTrix, Seesoft, 벡터장 위상 등)은 이 표에 포함하지 않았다.

## 2. 구현한 20개와 서지 (신규 vs 기존 조사분)

모두 이번 버전에서 새로 조사해 구현했다. 기존 320개 중 어느 것도 이름만 바꾼 것이 아니다(독립성은 `v10-inventory.md`).

| id | 서지 | 확인 정도 |
| --- | --- | --- |
| zame | Elmqvist, Do, Goodell, Henry Riche, Fekete (2008), PacificVis 2008, 215–222, DOI 10.1109/PACIFICVIS.2008.4475479 | AVIZ·HAL 기록 |
| excentric-labeling | Fekete, Plaisant (1999), Proc. ACM CHI 1999, 512–519 | UMD DRUM 기록, **DOI 확인되지 않음** |
| lineup | Gratzl, Lex, Gehlenborg, Pfister, Streit (2013), IEEE TVCG 19(12), 2277–2286, DOI 10.1109/TVCG.2013.173 | JKU·Harvard·PMC 기록 |
| unit-visualization | Park, Drucker, Fernandez, Elmqvist (2018), Atom, IEEE TVCG 24(12), 3032–3043 | Microsoft Research 기록, **DOI 확인되지 않음** |
| splatterplot | Mayorga, Gleicher (2013), IEEE TVCG 19(9), 1526–1538, DOI 10.1109/TVCG.2013.65 | PMC·Amanote 기록 |
| contour-tree | Carr, Snoeyink, Axen (2000), SODA, 918–926; Carr, Snoeyink, van de Panne (2004), IEEE Vis 2004, 497–504 | UBC 보고서·DBLP, **DOI 확인되지 않음** |
| persistence-diagram | Edelsbrunner, Letscher, Zomorodian (2002), Discrete & Computational Geometry 28(4), 511–533, DOI 10.1007/s00454-002-2885-2 | ISTA·Springer 기록 |
| topological-landscape | Weber, Bremer, Pascucci (2007), IEEE TVCG 13(6), 1416–1423, DOI 10.1109/TVCG.2007.70601 | LBNL·OSTI 기록 |
| probabilistic-isocontour | Pöthkow, Hege (2011), IEEE TVCG 17(10), 1393–1406 | ZIB 기록, DOI(10.1109/TVCG.2010.247)는 **IEEE에서 직접 확인하지 못함** |
| functional-boxplot | Sun, Genton (2011), JCGS 20(2), 316–334, DOI 10.1198/jcgs.2011.09224 | 사본 기록, 쪽수 표기가 출처 간 상이 |
| stem-and-leaf | Tukey (1977), Exploratory Data Analysis | **직접 확인하지 못함** |
| sunflower-plot | Cleveland, McGill (1984), JASA 79(388), 807–822 | 인용 기록 |
| hanging-rootogram | Kleiber, Zeileis (2016), The American Statistician 70(3), 296–303, DOI 10.1080/00031305.2016.1173590 | arXiv·바젤 대학 기록 |
| lorenz-curve | Lorenz (1905), Publications of the ASA | **직접 확인하지 못함** |
| tornado-chart | (원 논문 서지 없음: 민감도 분석의 관례적 도표) | **확인하지 못함** |
| bagplot | Rousseeuw, Ruts, Tukey (1999), The American Statistician 53(4), 382–387, DOI 10.1080/00031305.1999.10474494 | 웹 검색 기록(초록·이차 자료) |
| diverging-stacked-bar | Robbins, Heiberger (2011), JSM Proceedings, 1058–1066; Heiberger, Robbins (2014), JSS 57(5) | 웹 검색 기록 |
| decision-curve | Vickers, Elkin (2006), Medical Decision Making 26(6), 565–574, DOI 10.1177/0272989X06295361 | 웹 검색 기록 |
| contour-boxplot | Whitaker, Mirzargar, Kirby (2013), IEEE TVCG 19(12), 2713–2722 | Wikipedia 기록, DOI 확인되지 않음 |
| spacetree | Plaisant, Grosjean, Bederson (2002), IEEE InfoVis 2002, 57–64, DOI 10.1109/INFVIS.2002.1173148 | UMD HCIL 기록 |

사용자가 요청문에서 예로 든 DOI 중 이 환경에서 확인하지 못한 것은 임의로 채워 넣지 않았다(이센트릭 라벨링, 이미지 공간 불확실성 2026).

## 3. 조사했으나 구현하지 않은 후보

- **UnitoPia (Contain-and-Fill 모형)**: 검색으로 논문을 찾지 못했다. 대신 같은 계열의 확인된 문법인 Atom을 구현하고, 콘텐츠에 이 사실을 적었다.
- **Uncertainty-Oriented Ensemble Data Visualization … Variable Spatial Spreading (TVCG 2021)**, **A General Approach to Visualizing Uncertainty in Statistical Graphics (TVCG 2026)**: 검색은 했으나 서지를 원문으로 확인하지 못했고 이번 버전에서 구현하지 않았다.
- **Rectangular cartograms (van Kreveld, Speckmann 2007)**: 검색은 했으나 구현하지 않았다. 기존 카토그램류와의 독립성 검토도 마치지 못했다.

이 후보들의 ‘구현하지 않은 이유’는 시간·범위 때문이며, 기법 자체의 가치를 평가한 결과가 아니다.

## 4. 구현 수준의 정의

- **충실한 재현**: 논문의 정의·알고리즘을 따른 계산(규모는 작을 수 있음).
- **구조 보존 단순화**: 핵심 구조와 읽는 법은 같고, 일부 계산·최적화·상호작용을 줄임.
- **문헌 기반 대안**: 원 기법을 찾지 못해 같은 계열의 확인된 문헌으로 대체.
- **교육용 근사**: 개념을 보이기 위한 근사이며 원 논문의 정확한 절차가 아님.

수준별 분류는 `v10-inventory.md`에 있다.
