# VizLab v1.1 — 조사 기록

서지는 웹 검색 결과(출판사·대학·저자 사본·BibSonomy·Wikipedia 등의 기록)로 확인했고, **원문 PDF를 열어 본문을 대조한 항목은 없습니다.** 검색 도구가 요약과 서지 정보만 돌려주는 환경이라 ‘본문 직접 대조’는 이번에도 하지 못했습니다. 확인하지 못한 항목은 ‘확인되지 않음’으로 적었고 DOI는 추측해서 쓰지 않았습니다.

## 1. 수치

| 항목 | 목표 | 실제 |
| --- | --- | --- |
| 요청문 후보 20개 중 웹 검색한 것 | 20 | 17개 (Matrix Cube, Parallel Edge Splatting, CactusTree, Generalized Pythagoras Tree, Continuous Scatterplots, Continuous Parallel Coordinates, Spot Noise, Taylor, History Flow, Travel-Time Cartogram, Rectangular Cartogram, Target, Piper, Nomogram, Stiff, Ring Maps, Hinton Diagram) |
| 검색하지 않은 후보 | — | Skew-T(원 출처), Hasse(원 출처), Stream Ribbons(원 논문) |
| 요청문의 대체 후보(Data Mountain, Temporal Activity Map, Schoeller, Interleaved PES, Piper 3D) | 조사 | **조사하지 못함** |
| 요청문 밖에서 새로 발굴해 조사한 후보 | 20개 이상 | **0개** (미달) |
| 구현한 새 항목 | 20개 이상 | 20개 (도감 340 → 360) |

기존 340개 어느 것도 이름만 바꾸지 않았습니다. 중복 검사는 카탈로그 id 대조(없음)와 아래 3절의 인코딩 비교로 했습니다.

## 2. 구현한 20개와 서지 (확인 수준)

| id | 서지 | 확인 정도 |
| --- | --- | --- |
| matrix-cube | Bach, Pietriga, Fekete (2014), Visualizing Dynamic Networks with Matrix Cubes, ACM CHI 2014, 877–886, DOI 10.1145/2556288.2557010 | AVIZ·HAL·LISN 기록으로 확인, 본문 미대조 |
| parallel-edge-splatting | Burch, Vehlow, Beck, Diehl, Weiskopf (2011), IEEE TVCG 17(12), 2344–2353, DOI 10.1109/TVCG.2011.226 | 두 서지 기록에서 DOI·쪽수 일치, 저자 일부만 확인, 본문 미대조 |
| cactus-tree | Dang, Forbes (2017), CactusTree, IEEE PacificVis 2017, 210–214, DOI 10.1109/PACIFICVIS.2017.8031596 | 저자 사본 링크·ggraph 문서의 기록. **DOI는 이차 자료로만 확인**, 배치 규칙 본문 미확인 |
| pythagoras-tree | Beck, Burch, Munz, Di Silvestro, Weiskopf (2014), IVAPP 2014, 17–28, DOI 10.5220/0004654500170028 | SciTePress·Stuttgart 기록으로 저자·쪽수·DOI 확인(요청문의 ‘Diehl’은 기록상 ‘Di Silvestro’), 본문 미대조 |
| hinton-diagram | **원 서지 확인되지 않음** | matplotlib·R 패키지 설명이 ‘Hinton이 1980년대에 소개’라고만 서술 |
| continuous-scatterplot | Bachthaler, Weiskopf (2008), IEEE TVCG 14(6), 1428–1435, DOI 10.1109/TVCG.2008.119 | 웹 서지 기록, 본문 미대조 |
| continuous-parallel-coordinates | Heinrich, Weiskopf (2009), IEEE TVCG 15(6), 1531–1538, DOI 10.1109/TVCG.2009.131 | PubMed·Dagstuhl 기록, 본문 미대조 |
| spot-noise | van Wijk (1991), SIGGRAPH 1991 (Computer Graphics 25(4)), 309–318 | SIGGRAPH 역사 기록·BibTeX, **DOI 확인되지 않음** |
| stream-ribbons | **원 논문 조사하지 못함** | 와도 접선 성분의 절반이라는 회전 규칙은 유체역학의 표준 결과이며 테스트로 검증 |
| rectangular-cartogram | van Kreveld, Speckmann (2007), Computational Geometry 37(3), 175–187 | 강의 자료·TU/e 저장소의 이차 기록, **DOI·본문 확인되지 않음**. 초기 판 ESA 2004, LNCS 3221, 724–735 |
| travel-time-cartogram | **구현과 직접 대응하는 원 논문 확인되지 않음** | 관련 연구(Shimizu·Inoue 2009, Hong 외 Traffigram, Buchin 외 2014)는 이차 자료로만 확인 |
| ring-map | Battersby 외 (2011), Journal of Maps 7(1), 564–572 | 검색 기록의 이차 인용으로만 확인, **저자 목록·DOI·본문 확인되지 않음** |
| history-flow | Viégas, Wattenberg, Dave (2004), ACM CHI 2004 | 저자 사본·BibSonomy 기록, **DOI·쪽수 확인되지 않음** (일부 기록은 연도·쪽수가 다름) |
| taylor-diagram | Taylor (2001), J. Geophys. Res. 106(D7), 7183–7192, DOI 10.1029/2000JD900719 | EarthRef·PCMDI 기록과 초록, 본문 미대조 |
| target-diagram | Jolliff 외 (2009), Journal of Marine Systems 76, 64–82 | WHOI 사본·저널 권호 서문 기록, **저자 목록 전체·DOI 확인되지 않음** |
| nomogram | Iasonos, Schrag, Raj, Panageas (2008), J. Clin. Oncol. 26(8), 1364–1370, DOI 10.1200/JCO.2007.12.9791 | 웹 서지 기록, 본문 미대조. 노모그램의 수학적 기원은 조사하지 않음 |
| piper-diagram | Piper (1944), Trans. AGU 25(6), 914–928, DOI 10.1029/TR025i006p00914 | USGS 출판물 기록(일부 서지는 914–923으로 표기), 본문 미대조 |
| stiff-diagram | Stiff (1951), J. Petroleum Technology 3(10), 15–17 | 웹 기록, 쪽수 표기가 출처마다 다름, **DOI 확인되지 않음** |
| skew-t | **원 출처 조사하지 않음** | 식의 출처로 Bolton (1980) Monthly Weather Review 108만 인용(직접 확인하지 못함) |
| hasse-diagram | **원 출처 조사하지 않음** | |

본문을 직접 대조한 것은 하나도 없으므로 ‘충실한 재현’이라는 표현은 정의가 공식으로 명확한 항목(Taylor의 코사인 법칙, Hinton의 면적 ∝ |값|, 노모그램의 점수 변환, Hasse의 이행적 축약)에 한정했습니다.

## 3. 요청문 후보 중 구현하지 못한 것

요청문 후보 20개를 모두 구현했습니다. 다만 **Ring Maps는 정확한 배치 규칙을 확인하지 못해** ‘직접 설계한 구조 보존 단순화’로, Stream Ribbons·Skew-T·Hasse는 원 논문을 조사하지 않고 표준 정의로 구현한 것으로 기록했습니다. 요청문의 `Hasse Diagram`은 기존 `dag-layout`과 독립성이 부분적이라 통합 여부를 판단해야 하는 항목이었고, 이 버전에서는 이행적 축약·순서 공리 검증·상한/하한 강조가 고유하다고 판단해 별도 항목으로 두었습니다(`v11-inventory.md`에서 360이라는 수에 이 항목이 들어 있음을 밝힘).

요청문 목록 밖의 대체 후보(Data Mountain, Temporal Activity Map, Schoeller Diagram, Interleaved Parallel Edge Splatting, Piper 3D)는 조사하지 못했습니다. 이 이유는 시간·범위이며 기법의 가치를 평가한 결과가 아닙니다.

## 4. 구현 수준의 정의

- **충실한 재현**: 논문(또는 표준 정의)의 계산 규칙을 따랐고 테스트로 성질을 확인.
- **구조 보존 단순화**: 핵심 구조와 읽는 법은 같고 일부 계산·최적화·상호작용을 줄이거나 직접 설계.
- **문헌 기반 대안**: 원 기법을 찾지 못해 같은 계열의 확인된 문헌으로 대체.
- **교육용 근사**: 개념을 보이는 근사.
