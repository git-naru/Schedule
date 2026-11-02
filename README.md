# Schedule
개인스캐쥴을 확인할 수 있는 App 개발

**My Base** — 업무·개인 데이터베이스와 일정을 한곳에서 관리하는 웹앱입니다.
갤럭시탭 브라우저에서 쓰도록 만들었고, 일정을 저장하면 **Google 캘린더**와 **iCloud 캘린더**(아이폰)에도 함께 기록됩니다.

```
[갤럭시탭 크롬] ─▶ [Google Apps Script 웹앱] ─┬─▶ 구글 스프레드시트 (모든 데이터)
                                            ├─▶ Google 캘린더
                                            └─▶ iCloud 캘린더 ─▶ 아이폰
```

- 서버·호스팅 비용 없음 (Google Apps Script, 무료)
- "나만 접근"으로 배포하므로 내 구글 계정으로만 열림
- 데이터는 내 구글 드라이브의 **My Base 데이터** 스프레드시트에 저장

## 기능

| 화면 | 할 수 있는 일 |
|---|---|
| 대시보드(일간) | 하루 타임라인, 할 일, 이번 주, 최근 기록, 빠른 메모(자동 저장), 통합 검색 |
| 주간 / 월간 | 일정 보기, 빈 칸을 눌러 그 시각으로 새 일정, 공휴일 표시 |
| 데이터베이스 | 업무·개인 DB별 표 보기, 기록 추가·수정·삭제, 기록에 일정 연결 |
| DB 관리 | DB 새로 만들기, 항목(글자·숫자·날짜·선택·체크) 편집, DB 삭제 |
| 설정 | 색상 테마 10종(기본: POSCO 화이트), 캘린더 연동 상태 |

- 처음 실행하면 기본 DB 6개(업무: 프로젝트·거래처·회의록 / 개인: 연락처·가계부·메모)가 비어 있는 상태로 만들어집니다.
- 일정: 종일, 반복(매일·매주·매월), 알림, 장소, 메모, 연결할 기록.
- 화면 크기: 갤럭시탭 가로(1280×800) 기준. 세로 화면·휴대폰에서는 메뉴가 ☰ 버튼으로 접힙니다.

## 설치 (처음 한 번, 약 15분)

### 1. Apps Script 프로젝트 만들기
1. https://script.google.com → **새 프로젝트**, 이름: `My Base`
2. ⚙️ **프로젝트 설정** → "편집기에서 appsscript.json 매니페스트 파일 표시" 체크
3. **편집기**에서 아래 파일을 만들고 `apps-script/` 폴더의 내용을 그대로 붙여넣기

   | 만들 파일 | 만드는 방법 |
   |---|---|
   | `Code.gs` | 기본 파일 내용을 교체 |
   | `Store.gs`, `GoogleCal.gs`, `ICloud.gs` | ＋ → 스크립트 |
   | `Index` | ＋ → HTML, 이름은 `Index` (`Index.html` 내용) |
   | `appsscript.json` | 내용 교체 |

   > PC가 있다면 [clasp](https://github.com/google/clasp)로 한 번에 올릴 수도 있습니다:
   > `npm i -g @google/clasp` → `clasp login` → `clasp create --type webapp --title "My Base" --rootDir apps-script` → `clasp push`

### 2. 권한 승인과 연결 확인
편집기 위쪽 함수 목록에서 `testSetup` 선택 → **실행** → 권한 승인.
"확인되지 않은 앱" 경고가 나오면 **고급 → My Base(으)로 이동** (내가 만든 스크립트입니다).
실행 로그에 데이터 시트 주소와 Google 캘린더 이름이 나오면 성공입니다.

### 3. 웹앱 배포
1. **배포 → 새 배포** → 유형 **웹 앱**
2. 실행 사용자 **나**, 액세스 권한 **나만**
3. 나온 웹앱 주소(`https://script.google.com/macros/s/.../exec`)를 갤럭시탭 크롬에서 열고 ⋮ → **홈 화면에 추가**

여기까지 하면 앱과 Google 캘린더 연동이 동작합니다.

### 4. (선택) iCloud 캘린더 연결 — 아이폰 캘린더에도 기록
1. https://appleid.apple.com → **로그인 및 보안 → 앱 암호** → 새 암호 발급 (`xxxx-xxxx-xxxx-xxxx`)
2. `tools/find_icloud_calendar.py`로 iCloud 캘린더 주소 찾기
   - PC: `python3 find_icloud_calendar.py`
   - 갤럭시탭: https://colab.research.google.com 새 노트북에 파일 내용을 붙여넣고 ▶ 실행
3. Apps Script ⚙️ **프로젝트 설정 → 스크립트 속성**에 추가

   | 속성 | 값 |
   |---|---|
   | `ICLOUD_USER` | Apple ID 이메일 |
   | `ICLOUD_APP_PASSWORD` | 앱 전용 암호 |
   | `ICLOUD_CALENDAR_URL` | 2번에서 찾은 캘린더 주소 |

4. `testSetup`을 다시 실행해 로그에 `iCloud(work): 연결 성공`이 나오는지 확인

### 5. (선택) 업무·개인을 다른 캘린더에 넣기
스크립트 속성에 아래 값을 넣으면 구분별로 다른 캘린더에 기록합니다. 비워 두면 기본 캘린더(또는 `ICLOUD_CALENDAR_URL`)를 씁니다.

| 속성 | 값 |
|---|---|
| `GOOGLE_CALENDAR_ID_WORK` / `GOOGLE_CALENDAR_ID_PERSONAL` | Google 캘린더 설정 → 캘린더 통합 → 캘린더 ID |
| `ICLOUD_CALENDAR_URL_WORK` / `ICLOUD_CALENDAR_URL_PERSONAL` | `find_icloud_calendar.py` 결과 중 원하는 캘린더 주소 |

## 코드를 고친 뒤 반영하기
편집기에 바뀐 파일을 붙여넣고 **배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포**. 웹앱 주소는 그대로입니다.

## 알아둘 점
- **한 방향 연동입니다.** 앱에서 만든 일정을 Google·iCloud로 보냅니다. Google 캘린더나 아이폰에서 직접 만든 일정은 앱에 나타나지 않습니다.
- 일정을 고치면 Google 쪽은 지우고 새로 만들고, iCloud 쪽은 같은 일정을 덮어씁니다.
- 반복 일정은 전체가 함께 바뀌고 함께 지워집니다 (특정 날짜만 바꾸기는 아직 없음).
- 외부 캘린더 기록이 실패해도 앱에는 저장되고, 일정 편집 창에 실패 이유가 표시됩니다.
- 공휴일은 양력 공휴일과 2026·2027년 설날·부처님오신날·추석만 표시합니다 (대체공휴일 제외).

## 문제 해결
| 증상 | 확인할 것 |
|---|---|
| iCloud 인증 실패 | `ICLOUD_USER`, `ICLOUD_APP_PASSWORD` 오타. 앱 암호를 폐기했다면 새로 발급 |
| iCloud 캘린더 주소를 확인하세요 | `ICLOUD_CALENDAR_URL`을 `find_icloud_calendar.py` 결과와 비교 |
| 설정 화면에 "설정 필요" | 스크립트 속성 3개가 모두 들어갔는지 확인 |
| 아이폰에 안 보임 | 아이폰 **설정 → [내 이름] → iCloud → 캘린더**가 켜져 있는지, 캘린더 앱에서 해당 캘린더가 표시되는지 |

## 개발

| 경로 | 내용 |
|---|---|
| `apps-script/Code.gs` | 웹앱 진입점, 서버 API(일정·할 일·DB·기록·메모·설정) |
| `apps-script/Store.gs` | 스프레드시트 저장소 |
| `apps-script/GoogleCal.gs` | Google 캘린더 연동 |
| `apps-script/ICloud.gs` | iCloud(CalDAV) 연동, .ics 생성 |
| `apps-script/Index.html` | 화면 전체 |
| `tools/find_icloud_calendar.py` | iCloud 캘린더 주소 찾기 (1회용) |
| `dev/fake-gas.js` | Apps Script 서비스를 메모리에서 흉내 내는 가짜 환경 |
| `dev/preview.js` | 가짜 환경 + 실제 화면을 브라우저로 띄워 화면 캡처 |
| `tests/` | 날짜·반복·배치·.ics 검사, 서버 API 검사 |

```bash
npm test                      # 순수 함수 + 서버 API 검사 (설치할 것 없음)
node dev/preview.js shots     # 화면 캡처 (playwright 필요)
```
