# VizLab v0.9 인벤토리

## 실제 전체 개수 (코드에서 센 값)

| 항목 | v0.8 | v0.9 |
|---|---|---|
| 전체 도감 항목 | 301 | **320** (+19) |
| 카테고리 | 17 | 17 (변경 없음) |
| 홈 애니메이션 | 72 | **80** (+8) |
| 데이터셋 | 199 | **214** (+15) |
| 비교 실험실 추천 조합 | 49 | **59** (+10) |
| 표현 원리 태그 | 16 | 16종(변경 없음, 신규 19종에 주분류와 보조 부여) |

주분류 기준 성격별 수(합 = 320):

| 성격 | v0.8 | 신규 19 | 합계 |
|---|---|---|---|
| 시각화 방법론 | 162 | 19 | **181** |
| 전문 도표 | 78 | 0 | **78** |
| 분석·계산 결과 | 53 | 0 | **53** |
| 응용 예제 | 8 | 0 | **8** |

카테고리별 수(보조 카테고리 포함 기준): 분포 25 · 관계 46 · 비교 37 · 시계열 60 · 비율·구성 24 · 다변량 32 · 계층·흐름 23 · 통계·불확실성 47 · 지리공간 57 · 관계·네트워크 54 · 특수·응용 19 · 과학·수학 43 · 생물정보학 13 · 금융·경제 20 · 산업·공학 5 · 언어·텍스트 12 · 머신러닝 20.

## 목표와 실제

| 목표 | 실제 |
|---|---|
| 전체 320종 이상(도전) | **320종 달성**(정확히 320) |
| 신규 독립 방법론 15~25종(도전) | **19종 달성** (VSUP는 기존 차트에 통합했고 신규로 세지 않음) |
| 신규 연구 후보 30~50종 조사 | **29종 조사, 1종 미달**(서지 검증 26종, 미확인 4종 — `v09-research.md`) |
| 홈 애니메이션 80단계 이상(도전) | **80단계 달성** |
| 비교 프리셋: 신규 방법론 반영 | 10개 추가(59개). 요청서의 후보 중 같은 데이터셋을 공유할 수 없는 조합(TimeSets/Set Streams, Word Cloud/WordStream, 히트맵/TileBars, VSUP 비교 등)은 추가하지 않았음 |
| 기존 301종 전부 보존 | **보존**(기존 ID·URL·데이터셋·테스트 유지. 이변량 코로플레스는 ‘팔레트 방식’ 옵션만 추가했고 기본 동작은 그대로) |

숫자를 맞추려고 기존 기법을 이름만 바꾸거나 설정 조합으로 등록하지 않았습니다. 독립성 판단은 `v09-research.md`에 있습니다.

## 신규 19종

| ID | 이름 | 카테고리 | 표현 원리(보조) | 구현 수준 |
|---|---|---|---|---|
| `metrosets` | MetroSets | 관계·네트워크(집합) | 연결 (위치) | 지지 그래프 + 격자 맞춤 + 팔방위 경로. 탐욕·휴리스틱, 전역 최적화 아님 |
| `mosaicsets` | MosaicSets | 관계·네트워크(집합) | 공간 분할 (면적) | 모의 담금질. 원 논문은 정수 선형 계획법 |
| `infocrystal` | InfoCrystal | 관계·네트워크(집합) | 연결 (글리프) | 이진 불리언 질의만, 가중·임계값 모드 없음 |
| `setnet` | SetNet | 관계·네트워크(집합) | 연결 (공간 분할) | 집합 먼저 배치→구역 안 노드 배치(단순화) |
| `paohvis` | PAOHvis | 관계·네트워크(그래프), 시계열 | 연결 (시간) | 정렬은 휴리스틱 |
| `set-streams` | Set Streams | 관계·네트워크(집합), 시계열 | 흐름 (시간) | 줄 정렬 휴리스틱 |
| `sequence-braiding` | Sequence Braiding | 시계열, 관계·네트워크 | 흐름 (연결, 시간) | 최장 경로 층, 노드 안 정렬 |
| `dust-magnet` | Dust & Magnet | 다변량(고차원 투영) | 다변량 매핑 (투영) | 끌림 평형 + 대비·겹침 밀어내기 추가 |
| `gosper-map` | GosperMap | 계층·흐름 | 공간 분할 (면적) | 윤곽 다듬기 없음, 7ⁿ 셀 |
| `wordstream` | WordStream | 언어·텍스트, 시계열 | 공간 분할 (시간) | 가로 글자, 근사 글자 폭 |
| `tilebars` | TileBars | 언어·텍스트 | 색상 (길이) | 고정 길이/단순 TextTiling |
| `od-maps` | OD Maps | 지리공간, 관계·네트워크 | 색상 (공간 분할) | 사각 격자 지도 |
| `maptrix` | MapTrix | 지리공간, 관계·네트워크 | 연결 (색상) | 사각 격자 지도, 직각 지시선 |
| `perspective-wall` | Perspective Wall · Bifocal | 시계열, 특수·응용 | Focus+Context (시간) | 2D 투영 좌표 변환, Bifocal 통합 |
| `ibfv` | IBFV | 과학·수학(동역학), 지리공간 | 텍스처 (흐름) | CPU 이류, 같은 노이즈 유지 단계로 줄무늬 |
| `hyperstreamlines` | Hyperstreamlines | 과학·수학(3D 필드) | 3D 공간 (글리프) | 대칭 텐서, 등방성에서 중단 |
| `fiber-surfaces` | Fiber Surfaces | 과학·수학(3D 필드) | 3D 공간 | 사면체별 독립 삼각형, 셀 6만 제한 |
| `vector-field-topology` | Vector Field Topology | 과학·수학(동역학), 지리공간 | 글리프 (흐름) | 2차원 정상 장, 한계 순환 없음 |
| `seesoft` | Seesoft | 언어·텍스트(말뭉치), 다변량 | 픽셀 (길이) | 읽기 창 없음, 툴팁·검색으로 대체 |

## 기존 차트에 통합한 기능

- **VSUP(Value-Suppressing Uncertainty Palettes)**: 이변량 코로플레스(`bivariate`)의 ‘팔레트 방식’ 옵션. Y를 불확실성으로 읽어 불확실성 단계가 높을수록 값 구간을 합칩니다. 엔진 `src/stats/vsup.ts`.
- **Bifocal Display**: Perspective Wall 실험실의 ‘방식’ 선택으로 통합(별도 항목으로 세지 않음).
- **KelpFusion**: v0.8에서 Kelp Diagram에 통합되어 있음.

## 신규 데이터셋 15개 (모두 합성)

`lab-members`, `search-hits`, `team-projects`, `membership-history`, `care-braids`, `phone-specs`, `topic-words`, `search-docs`, `grid-flows`, `flow-2d`, `tensor-twist`, `memo-archive`, `bivariate-volume`, `club-network`, `code-lines`.

## 신규 비교 프리셋 10개

`set-metro`(메트로셋·모자이크셋·레인보우 박스), `set-network`(셋넷·메트로셋·모자이크셋), `set-query`(벤·UpSet·인포크리스털), `seq-braiding`(라이프플로·시퀀스 브레이딩), `multivar-dust`(RadViz·스타 좌표·더스트 앤 마그넷), `hier-gosper`(트리맵·보로노이 트리맵·고스퍼맵), `flow-textures`(IBFV·벡터장 위상), `tensor-paths`(텐서 글리프·하이퍼스트림라인), `od-views`(OD 지도·맵트릭스), `bivariate-surface`(3D 등치면·파이버 곡면).

## 구현하지 않은 후보와 제외 근거

`v09-research.md`의 ‘구현하지 않은 후보’ 표를 보세요(Sequen-C, ZAME, Scagnostics, EulerView, Dual Radial Sets, Superquadric Tensor Glyphs, MatrixExplorer).
