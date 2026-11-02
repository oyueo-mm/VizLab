# VizLab v0.9 후보 조사와 서지 검증

이 문서는 v0.9에서 조사한 후보 기법의 상태와 서지 검증 결과를 기록합니다. **서지는 기억이 아니라 이번 작업에서 웹 검색(Eurographics 전자도서관, IEEE VIS 사이트, 저자·연구실 페이지, 대학 저장소, DBLP, arXiv 등)으로 확인한 것만** 적었고, 확인하지 못한 항목은 ‘확인되지 않음’으로 두었습니다. 검색 결과는 대부분 초록·서지 기록 수준이며 유료 논문의 원문은 읽지 못했습니다. 따라서 ‘독립성’ 판단과 ‘원 논문과의 차이’는 초록·공식 프로젝트 설명·공개 구현에서 확인한 범위 안의 판단입니다.

상태 표기: **구현 및 검증 완료**(실험실·설명·테스트까지), **기존 차트에 통합**, **보류**, **제외**.

조사한 후보는 **29개**입니다(목표 30~50개에는 1개 부족합니다). 이 중 서지를 웹 기록으로 확인한 것은 26개이고, EulerView·Dual Radial Sets·Superquadric Tensor Glyphs·MatrixExplorer는 서지를 확인하지 못했습니다(아래 표).

## 구현한 후보 (19종 + VSUP 통합)

| 후보 | 서지 검증(이번 작업) | 독립성 판단 | 상태 | 원 논문과의 차이(요약) |
|---|---|---|---|---|
| MetroSets | Jacobsen, Wallinger, Kobourov, Nöllenburg. IEEE TVCG 27(2), 1257–1267 (2021), DOI 10.1109/TVCG.2020.3030475. IEEE VIS 2020. Arizona·TU Wien 저장소 기록과 일치 | 집합=노선·원소=역, 노선이 구간을 공유하는 지지 그래프와 팔방위 도식. LineSets는 위치 보존 곡선이라 구조가 다름 | 구현 및 검증 완료 | 지지 그래프는 큰 집합부터 탐욕적으로, 도식화는 격자 맞춤과 꺾임 1회의 팔방위 경로. 전역 최적화 아님 |
| MosaicSets | Rottmann, Wallinger, Bonerath, Gedicke, Nöllenburg, Haunert. IEEE TVCG 29(1), 875–885 (2023), DOI 10.1109/TVCG.2022.3209485. arXiv 2208.07982. NP-hard이며 원 논문은 정수 선형 계획법으로 최적 해 | 격자 셀 한 칸=원소 하나, 같은 집합이 연속 영역 | 구현 및 검증 완료 | 모의 담금질(연결 요소 수+둘레). 최적 보장 없음, 연속성 완화 확장은 조각 수 표시로 대체 |
| InfoCrystal | Spoerri (1993). CIKM 1993. 저자 사이트·CIKM 색인으로 제목·학회 확인. DOI는 확인되지 않음 | 조건 조합마다 아이콘, 불리언 질의를 시각적으로 조립. Venn·UpSet과 배치·질의 방식이 다름 | 구현 및 검증 완료 | 이진(0/1) 불리언 질의만. 가중 질의·임계값 모드 없음 |
| SetNet | Rodgers 외(Rodgers, Stapleton, Alsallakh, Micallef, Baker, Thompson). Information Sciences 367–368, 58–79 (2016), DOI 10.1016/j.ins.2016.05.045. Kent·Aalto 저장소 기록. 요청서의 저자 ‘Chapman’은 이 논문에 없음 | 집합 먼저 배치, 노드를 구역 안에 배치. Bubble Sets 류(네트워크 먼저)와 반대 구조 | 구현 및 검증 완료 | 핵심 아이디어(집합 먼저→구역 안 배치)만 단순화. 집합 배치 개선 알고리즘은 원 크기·위치를 겹침·간선 수로 정하는 방식으로 대체 |
| PAOHvis | Valdivia, Buono, Plaisant, Dufournaud, Fekete. IEEE TVCG, DOI 10.1109/TVCG.2019.2933196. AVIZ·HAL·IEEE VIS 기록. 권호·연도(2020/2021, 26/27)는 출처마다 다름 | 정점=가로선, 하이퍼에지=시간 칸의 세로선, 같은 구성 합침 | 구현 및 검증 완료 | 정렬은 단순 휴리스틱, 원 논문의 검색·속성 필터 인터페이스 없음 |
| Sequence Braiding | Di Bartolomeo, Zhang, Sheng, Dunne. IEEE VIS 2020 / TVCG. Northeastern 연구실 서지로 제목·저자 확인. 권호·쪽수·**DOI는 확인되지 않음**(요청서의 10.1109/TVCG.2020.3030442는 직접 확인하지 못함) | 이벤트 유형 노드의 층별 DAG와 개체 가닥. LifeFlow는 접두사 트리 | 구현 및 검증 완료 | n-층 최적 배치 대신 최장 경로 층과 노드 안 정렬. 속성은 색·정렬로만 |
| Set Streams | Agarwal, Beck. Computer Graphics Forum 39(3), 383–391 (EuroVis 2020), DOI 10.1111/cgf.13988. Eurographics·Bamberg 기록과 일치 | 집합 조합 줄과 시점 사이 리본으로 개체 이동. TimeSets·Alluvial과 다름 | 구현 및 검증 완료 | 줄 정렬 휴리스틱, 원 논문의 상호작용 일부 생략 |
| Dust & Magnet | Yi, Melton, Stasko, Jacko. Information Visualization (2005), DOI 10.1057/palgrave.ivs.9500099. Georgia Tech 페이지. 권호·쪽수는 확인되지 않음(저자 순서는 요청서와 달리 Yi가 첫째) | 변수=자석, 관측=먼지, 끌림 평형과 자석 조작. RadViz는 고정 투영 | 구현 및 검증 완료 | 평형 위치는 강성 가중 평균. 자석이 원 위·같은 세기면 RadViz와 같아짐. 대비(거듭제곱)·겹침 밀어내기는 이 구현의 추가 |
| GosperMap | Auber, Huet, Lambert, Renoust, Sallaberry, Saulnier. IEEE TVCG 19(11), 1820–1832 (2013), DOI 10.1109/TVCG.2013.91. Bordeaux·Montpellier 저장소, 저자 사이트, DBLP | 고스퍼 곡선 위 구간 할당, 노드=연속 영역 | 구현 및 검증 완료 | 영역 윤곽 다듬기 없이 육각 셀 경계를 그대로 그림. 셀 수는 7ⁿ |
| WordStream | Dang, Nguyen, Pham (이름 전체는 확인되지 않음; 요청서의 ‘Ebert’는 저자 목록에 없음). EuroVis 2019 Short Papers, DOI 10.2312/evs.20191178. Eurographics 기록 | 스트림 띠 안에 단어를 채움. Word Cloud+Streamgraph 병치가 아님 | 구현 및 검증 완료 | 글자를 곡선 경계를 따라 휘지 않고 가로로 놓음. 글자 폭은 근사 |
| TileBars | Hearst (1995). CHI 1995, 59–66, DOI 10.1145/223904.223912. 저자 연구 페이지·CHI 1995 논문집 기록 | 문서 길이 막대+조각+검색어 줄. 일반 히트맵과 다름 | 구현 및 검증 완료 | 조각 나누기는 고정 길이 또는 단순화한 TextTiling |
| OD Maps | Wood, Dykes, Slingsby. The Cartographic Journal 47(2), 117–129 (2010). City 대학 저장소 기록. DOI는 확인되지 않음 | 지도 배열을 바깥·안쪽에 겹친 칸 격자. 흐름 지도·od-matrix-map과 다름 | 구현 및 검증 완료 | 사각 격자 지도만. 실제 행정 경계·불규칙 해상도 없음 |
| MapTrix | Yang, Dwyer, Goodwin, Marriott. “Many-to-Many Geographically-Embedded Flow Visualisation: An Evaluation”, IEEE TVCG 23(1) (2017), IEEE InfoVis 2016. Monash·arXiv 1908.02052 기록. DOI·쪽수는 확인되지 않음. 요청서의 저자(Jones, Kiemer)·학회(EuroVis)는 확인되지 않음 | 행렬을 지도 옆에 붙이고 직각 지시선으로 행·열을 지역에 연결. 기존 od-matrix-map은 연동 강조로 잇는 도식이라 구조가 다름 | 구현 및 검증 완료 | 사각 격자 지도와 단순 지시선(라우팅 최적화 없음) |
| IBFV | van Wijk (2002). SIGGRAPH 2002 / ACM TOG, DOI 10.1145/566654.566646. 저자 프로젝트 페이지·ACM 기록. 권호·쪽수는 확인되지 않음 | 프레임마다 영상을 옮기고 노이즈를 섞음. LIC는 정지 영상의 선적분 | 구현 및 검증 완료 | CPU 이류, GPU 메시 변형·타일링 노이즈 없음. 줄무늬를 위해 같은 노이즈를 여러 단계 유지 |
| Fiber Surfaces | Carr, Geng, Tierny, Chattopadhyay, Knoll. Computer Graphics Forum 34(3), 241–250 (EuroVis 2015), DOI 10.1111/cgf.12636. Eurographics·Leeds 기록. 요청서의 저자 표기(Carr, Duke, Tricoche)와 다름 | 두 스칼라장의 역상 곡면. 등값면의 일반화 | 구현 및 검증 완료 | 사면체별 독립 삼각형, 가속 구조·부분 질의 없음, 셀 수 6만 제한 |
| Hyperstreamlines | Delmarcelle, Hesselink (1993). IEEE Computer Graphics and Applications 13(4), 25–33. NASA NTRS·Auckland 페이지 기록. DOI는 확인되지 않음 | 고유벡터 경로+타원 단면 관. Tensor Glyph는 점마다 글리프 | 구현 및 검증 완료 | 대칭 텐서만, 등방성 지점에서 중단 |
| Perspective Wall | Mackinlay, Robertson, Card. CHI 1991, 173–176(출처에 따라 173–179), DOI 10.1145/108844.108870 (DBLP) | 원근으로 접은 양옆 맥락. 테이블 렌즈·쌍곡 트리와 다름 | 구현 및 검증 완료 | 2D 투영 좌표 변환, 3D 애니메이션 없음 |
| Bifocal Display | Spence, Apperley (1982), Behaviour & Information Technology 1(1), 43–54(도서관 기록). Apperley, Tzavaras, Spence, Eurographics 1982, DOI 10.2312/EG.19821002. 두 논문의 내용 대조는 못 함 | Perspective Wall과 같은 Focus+Context 계열(양옆 균일 압축) | **기존 항목에 통합**(Perspective Wall의 ‘방식’) | 별도 항목으로 세지 않음 |
| Seesoft | Eick, Steffen, Sumner. IEEE Transactions on Software Engineering 18(11), 957–968 (1992). DBLP 기록. DOI는 확인되지 않음 | 줄 단위 막대로 파일 전체를 보이는 픽셀 지향 텍스트 시각화. 기존 픽셀·텍스트 항목과 다름 | 구현 및 검증 완료(요청서 목록 외 추가 발굴) | ‘읽기 창’(글자 확대 창)과 직접 조작 질의 없음 |
| Vector Field Topology | Helman, Hesselink. IEEE Computer 22(8), 27–36 (1989). 서지 색인 기록. 원문 대조·DOI는 확인되지 않음 | 임계점 분류와 분리선으로 흐름 골격을 요약. 유선·LIC·IBFV와 구조가 다름 | 구현 및 검증 완료(추가 발굴) | 2차원 정상 장의 쌍선형 보간만. 한계 순환·3차원·위상 연결 그래프 없음 |
| VSUP | Correll, Moritz, Heer. “Value-Suppressing Uncertainty Palettes”, CHI 2018. Tableau 연구 페이지로 저자·제목·학회 확인. DOI는 확인되지 않음(요청서의 10.1145/3173574.3174216은 직접 확인하지 못함) | 재사용 가능한 색 인코딩 | **기존 차트에 통합**(이변량 코로플레스의 ‘팔레트 방식’) | 트리 구성(색 평균·채도 억제)을 단순화: 합친 구간 가운데 값 색에 불확실성만큼 회색을 섞음 |

## 구현하지 않은 후보

| 후보 | 서지 검증(이번 작업) | 상태 | 판단 근거 |
|---|---|---|---|
| Sequen-C | Magallanes, Stone, Morris, Mason, Wood, Villa-Uriol. TVCG 28(1), 901–911, DOI 10.1109/TVCG.2021.3114868 (IEEE VIS 2021). arXiv 2108.03043·Sheffield 기록 | 보류 | 다단계 군집 요약(Align-Score-Simplify)은 LifeFlow·Sequence Braiding의 확장 기능으로 보는 편이 맞아 별도 항목으로 만들지 않았고 시간이 없어 확장도 하지 못함 |
| ZAME | Elmqvist, Do, Goodell, Henry, Fekete. PacificVis 2008, 215–222, DOI 10.1109/PACIFICVIS.2008.4475479. AVIZ·HAL 기록 | 보류 | 서지·존재 확인. 다중 스케일로 집계한 인접 행렬이라 독립 후보지만 구현하지 못함 |
| Scagnostics | Wilkinson, Anand, Grossman. IEEE InfoVis 2005, 157–164, DOI 10.1109/INFVIS.2005.1532142 | 제외(기존 기능 확장 후보) | 산점도 형태를 수치로 분석하는 계산이라 새 시각 인코딩이 아님 |
| EulerView | 개별 논문 서지는 확인하지 못함(SetNet 논문이 비교 대상으로 다룬다는 사실만 확인) | 보류 | 별도 서지가 없어 독립성을 판단할 근거 부족. SetNet과 ‘집합 먼저’ 계열이라 SetNet으로 대표 |
| Dual Radial Sets | 확인하지 않음 | 보류 | 기존 Radial Sets의 확장 후보. 서지 확인과 비교를 못 함 |
| Superquadric Tensor Glyphs | 확인하지 않음 | 보류 | 기존 Tensor Glyph의 확장 후보. 서지 확인과 비교를 못 함 |
| MatrixExplorer | 확인하지 않음 | 보류 | 기존 인접 행렬의 탐색·정렬 기능 후보. 서지 확인과 비교를 못 함 |
| KelpFusion | (v0.8에서 처리) | 기존 항목에 통합 | 이미 Kelp Diagram의 융합 슬라이더로 통합되어 있음 |
| EulerView 외 ‘시간·관계’, ‘텍스트 구조’, ‘지리’, ‘과학 일반’ 추가 조사(V09-10, 17, 20, 24) | — | 일부만 수행 | 추가 발굴은 Seesoft, Vector Field Topology, ZAME 세 개를 찾은 데서 멈췄고 이 분야를 체계적으로 훑지는 못함 |

## 요청서와 다르게 확인된 서지 (검증 결과)

- Fiber Surfaces: 저자는 Carr, **Geng, Tierny, Chattopadhyay, Knoll** (요청서: Carr, Duke, Tricoche).
- MapTrix: 저자는 **Yang, Dwyer, Goodwin, Marriott**, 학회는 IEEE InfoVis 2016(TVCG 23(1) 2017). EuroVis가 아님.
- SetNet: 저자에 Chapman이 없음. 논문은 Information Sciences 367–368 (2016).
- WordStream: 저자 목록에 Ebert가 없음.
- Dust & Magnet: 첫 저자는 Yi.
- Sequence Braiding, VSUP, InfoCrystal, OD Maps, Seesoft 등의 DOI는 이번 조사에서 직접 확인하지 못했습니다.

## 방법과 한계

- 검색은 일반 웹 검색(standard)이었고 각 후보를 한 번씩 조회했습니다. 같은 서지가 여러 출처에서 일치한 항목은 ‘일치’로, 한 출처뿐이거나 출처 사이 권호·연도가 다른 항목은 그렇게 표기했습니다.
- ‘독립성’은 초록·공식 설명에서 본 시각적 인코딩과 배치를 기존 VizLab 항목(LineSets, Bubble Sets, TimeSets, LifeFlow, RadViz, Treemap, LIC, Tensor Glyph 등)과 비교한 판단입니다.
