# PANAX Board

PM Studios가 운영하는 영미권 게임 커뮤니티 앱 **PANAX**의 SNS 컨텐츠를 만들기 위한 1인 운영자 전용 대시보드. GitHub Pages에 단일 HTML 파일로 배포된다.

- 저장소: https://github.com/nerothecodeking/PANAX_board (Public)
- 라이브: https://nerothecodeking.github.io/PANAX_board/
- 푸시하면 약 1분 뒤 자동 반영. 빌드 과정 없음.

> **이 문서의 성격**
> 규칙집이 아니다. 지금 코드가 왜 이렇게 생겼는지, 어떤 흐름으로 여기까지 왔는지를 설명해 새 세션이 맥락을 빨리 잡게 하는 문서다.
> 여기 적힌 판단들은 그때의 상황에서 나온 것이고, 앞으로 더 편한 방향으로 계속 바뀐다.
> 단 하나 변하지 않는 전제: **이 사이트는 지금 정상 작동 중이고, 작동을 깨뜨리는 변경이 가장 큰 실패다.**

---

## 1. 코드 지형

```
index.html    전부 여기 있음 (CSS + HTML + JS 인라인, 2,789행)
CLAUDE.md     이 문서
```

`index.html` 한 파일 안에 CSS·HTML·JS가 다 들어 있다. **행 번호는 수정할 때마다 밀리므로 적지 않는다.** 코드 안의 구간 주석으로 찾는다.

```
// ── IMAGES (base64 embedded) ──     favicon / SAMMY_IMG / LEDY_IMG
// ── STATE ──                        CATS, RSS_FEEDS
// ── KEY MANAGEMENT ──               API 키 입출력
// ── TABS ──                         switchTab
// ── FREE INPUT ──                   자유 입력 기사
// ── RSS FETCH ──                    fetchRSS
// ── CLAUDE API ──                   callClaude, extractJSON
// ── LOAD NEWS ──                    loadNews, CLASSIFY_SYS 프롬프트
// ── RENDER NEWS ──                  renderNews
// ── BOOKMARKS ──                    북마크 추가/삭제/렌더
// ── CONTENT GENERATION ──           generateContent + Sammy/Ledy 프롬프트
// ── SAVE CONTENT ──                 저장된 컨텐츠
// ── FUN FACT ──                     Wikipedia + FF_SYSTEM 프롬프트
// ── PANAX USERNAME POOL ──          가상 댓글용 닉네임 목록
// ── STEAM ASSET GRABBER ──          steam* 함수 전체
// ── INIT ──                         DOMContentLoaded 초기화
```

SRT와 Ledy 기능에는 구간 주석 대신 접두사가 있다. `srt*` / `ledy*` 로 grep한다. 기능별 접두사(`srt-` / `ledy-` / `steam-`)로 전역 이름을 격리하는 방식이 이미 자리잡혀 있어서, 새 기능도 같은 방식이면 충돌 걱정이 없다.

`// ── IMAGES ──` 구간은 5만 자짜리 base64 이미지가 한 줄에 들어 있다. 파일을 통째로 다시 쓰면 여기가 깨진다. 그래서 항상 부분 수정으로 작업한다.

---

## 2. 기능 지도

탭은 6개다. **"컨텐츠 생성"은 탭이 아니다.** 뉴스 탭 오른쪽 패널과 북마크 탭 양쪽에서 실행되는 기능이다.

| 탭 | 하는 일 | 외부 의존 |
|---|---|---|
| 📰 뉴스 피드 | RSS 수집 → Claude가 분류·번역 → 카테고리별 카드. 오른쪽 패널에서 컨텐츠 생성 | RSS 프록시 3단 폴백, Claude API |
| 💡 Fun Facts | Wikipedia 문서 → 흥미로운 사실 3개 추출 (게임 검색 / 랜덤) | Wikipedia API(무료), Claude API |
| 🎮 스팀 에셋 가져오기 | Steam 상점 영상을 무손실로 받기 위한 yt-dlp 명령어 생성 | CORS 프록시 3단 폴백 |
| 📝 자막 & 표정 생성 | 음원 + 대본 → SRT / Ledy 표정 MOV용 `.bat` | ElevenLabs Forced Alignment, Claude API |
| 🔖 북마크 | 저장한 기사·Fun Fact 목록 (전체/뉴스/상식 필터). 여기서도 컨텐츠 생성 | 없음 |
| 📦 저장된 컨텐츠 | 생성한 컨텐츠 보관·열람 | 없음 |

컨텐츠 생성은 Sammy(커뮤니티 앵글) / Ledy(산업 앵글) 두 페르소나로 영어·한국어 본문과 가상 커뮤니티 댓글을 만든다. Claude 모델은 `callClaude()` 안에 `claude-sonnet-4-6`으로 지정돼 있다.

**Steam Asset Grabber** — Steam 링크를 넣으면 yt-dlp 명령어가 나오고, 그걸 PowerShell에 붙여넣는다. Steam API를 쓰지 않고 공개 `appdetails` 엔드포인트를 CORS 프록시로 읽는다. 프록시가 깨지면 JSON 직접 붙여넣기 칸이 열리고 JSON만 표시된 페이지가 뜬다 — 설계된 폴백이지 버그가 아니다.

**자막 & 표정 생성** — ElevenLabs 키 + 음원 + 영어 대본(셋은 두 기능이 공유) → SRT 생성 → 표정 생성 순서. 표정 쪽이 SRT 결과(`srtLastWords`)를 재사용하므로 SRT를 먼저 만들어야 버튼이 활성화된다.

---

## 3. 데이터

전부 브라우저 로컬스토리지. 백엔드도 DB도 없다.

| 키 | 내용 |
|---|---|
| `px_ant` | Anthropic Claude API 키 |
| `px_elevenlabs` | ElevenLabs API 키 |
| `px_ledy_prompt` | 사용자가 편집한 Ledy 감정 배치 프롬프트 |
| `px_bookmarks` | 북마크 |
| `px_saved` | 저장된 컨텐츠 |
| `px_news_cache` | 뉴스 캐시 (수동 초기화) |

---

## 4. 지금 이렇게 돼 있는 이유

바꾸는 건 자유지만, 아래는 한 번 부딪혀보고 내린 결론들이다. 다시 제안하기 전에 이유부터 확인하면 시간을 아낀다.

### 브라우저는 명령어만 만들고, 바이트는 로컬 CLI가 만든다

| 기능 | 브라우저가 하는 일 | 실제 처리 |
|---|---|---|
| Steam Asset Grabber | yt-dlp 명령어 문자열 생성 | 사용자가 PowerShell에 붙여넣기 |
| Ledy 표정 MOV | `.bat`(FFmpeg 명령) 생성 | 사용자가 더블클릭 → 로컬 FFmpeg |

브라우저에서는 무손실 원본 영상도, 알파 채널 MOV도 못 만든다. "복사-붙여넣기 단계를 없애고 브라우저에서 바로 처리하자"는 개선처럼 보이지만 기능의 목적 자체를 깨뜨린다.

### 프롬프트의 원본은 코드다

컨텐츠 생성 프롬프트(페르소나, 스타일, 특수기호 규칙), 뉴스 분류(`CLASSIFY_SYS`), Fun Facts(`FF_SYSTEM`), Ledy 감정 사전(`LEDY_DEFAULT_PROMPT`) — 전부 `index.html` 안의 문자열이 유일한 원본이다. 문서로 복사해두면 반드시 어긋나므로, 내용이 궁금하면 코드를 읽는다.

### SRT는 STT가 아니라 강제 정렬(forced alignment)이다

대본이 항상 먼저 존재하므로 음성을 받아쓰고 오류를 잡을 이유가 없다. 프리미어 프로 내장 받아쓰기의 오류가 많아서 만든 기능이라, Whisper 같은 STT로 바꾸는 건 다운그레이드다.

### 자막 캡션 설정값은 프리미어 대화상자와 맞춰져 있다

어긋나도 웹에서는 티가 안 나고 프리미어에서만 깨진다. 임의로 조정하면 나중에 원인 찾기 어렵다.

### API 키는 코드에 넣지 않는다

저장소가 Public이다. 이건 취향이 아니라 사고 방지다.

---

## 5. 어떻게 여기까지 왔나

날짜는 `git log` 커밋 기준. 큰 단위 변경만 적는다 — 세부 이력은 `git log`가 갖고 있다.

**2026년 8월 · Claude Code 이관 (진행 중)**
수동 업로드(웹 UI `Add files via upload`)에서 git 워크플로로 전환. 채팅 세션에만 있던 맥락을 저장소에 고정. 이관과 주요 업데이트가 끝나면 버전을 2.0.0으로 올린다.

**2026년 6월 23일 ~ 7월 21일 · 제작 도구화 (버전 태그는 1.2.1로 유지)**
대시보드(읽고 만드는 도구)에서 제작 도구(파일을 뽑는 도구)로 성격이 바뀐 구간.
- Steam Asset Grabber
- SRT 생성 (ElevenLabs Forced Alignment)
- Ledy 표정 MOV (FFmpeg `.bat` 출력)

**v1.2 — 2026년 6월 16일 · Fun Facts + 북마크**
Wikipedia 기반 Fun Facts 탭, 북마크 필터, 뉴스 캐싱, 2단 분할 레이아웃.

**v1.1 — 2026년 5월 13일 · RSS 전환 + 컨텐츠 생성**
프로젝트 성격을 결정한 개편. AI 생성 뉴스 → 실제 RSS 수집(IGN, Kotaku, Eurogamer, PC Gamer, TheGamer, Polygon, VGC). Reddit 제거(노이즈). Sammy/Ledy 페르소나 도입. 영어+한국어 동시 생성. 다크→라이트. 탭 구조 확립.
이후 5월 18일~27일 작업은 대부분 프롬프트 품질 조정이었다.

**v1.0 — 2026년 5월 6일 · 초기 버전**
Anthropic API 연동, AI 게임 뉴스 큐레이션, 채널별 컨텐츠 아이디어(YouTube/X/Instagram), 로컬스토리지 저장.

### 버전 표기

헤더 `.version-tag`에 `PANAX_board <버전> (YYMMDD)` 형식. 현재 **1.2.1 (260623)**.
이관 + 주요 업데이트 완료 시 2.0.0으로 올리고, 그 뒤로는 semver를 따른다 — 기능 추가는 마이너(2.1.0), 수정은 패치(2.0.1). 버전 올릴 때 날짜도 같이 갱신한다.

### 비용 (개략)

뉴스 불러오기 1회 약 $0.02, 컨텐츠 생성 1회 약 $0.05–0.08, Fun Fact 1회 약 $0.02–0.03. ElevenLabs는 사용량 기준. Wikipedia API / GitHub Pages / CORS 프록시는 무료.

---

## 6. 알려진 문제 · 하고 싶은 것

- **백업 수단이 없다.** JSON 내보내기·불러오기가 미구현이라 브라우저 데이터를 지우거나 기기를 바꾸면 북마크와 저장된 컨텐츠가 전부 사라진다. 우선순위 높음.
  (`LEDY_DEFAULT_PROMPT`는 코드에 있어서 로컬스토리지가 날아가도 초기화 버튼으로 복구된다.)
- **`generateFromFree()`가 두 번 정의돼 있다.** `// ── FREE INPUT ──` 쪽이 뒤의 `// ── CONTENT GENERATION ──` 쪽에 덮여 죽은 코드다. 동작엔 문제 없지만 읽는 사람을 헷갈리게 한다.
- **`steamRender()`의 `STEAM_DL_DIR`에 개인 PC 경로가 하드코딩돼 있다.** Public 저장소에 사용자명이 노출되고 다른 PC에서는 맞지 않는다.
- Ledy 눈 깜빡임 프레임 자동 삽입 (아래 8-9 참조)
- Reddit 트렌딩, 게임 출시 일정 위젯

---

## 7. 공개 범위

저장소도 사이트도 Public이다. **URL이 알려지지 않았을 뿐 비공개가 아니다.** 저장소명에서 Pages 주소가 유추되고, 소스 보기로 프롬프트 전문을 읽을 수 있다.

저장소를 Private으로 바꿔도 달라지지 않는다. GitHub Pages는 저장소 공개 여부와 사이트 공개 여부를 별개로 취급하며, 단일 HTML 앱에서는 `index.html`이 곧 배포된 사이트다. (사이트 자체를 비공개로 하려면 Enterprise Cloud 조직 계정이 필요하다.)

Public 유지가 현재의 의도된 상태다. API 키만 코드에 넣지 않으면 된다.

---

# 8. Ledy 표정 MOV 파이프라인 (상세)

이 기능을 손대기 전에 읽는다. 다른 기능보다 깨지기 쉬운 지점이 많다.

## 8-1. 한 줄 요약

TTS 음성 + 영어 대본을 넣으면 Claude API가 문장별로 Ledy의 감정을 배치하고, 그 타임라인대로 **투명 배경 MOV를 만드는 `.bat` 파일**을 뽑아준다. 사용자는 그 `.bat`을 표정 PNG 폴더에 넣고 더블클릭한다. 브라우저는 영상을 만들지 않는다. FFmpeg가 만든다.

## 8-2. 왜 이 구조인가

**립싱크가 아니라 "스티커"다.** Ledy는 화면 주인공이 아니라 말풍선 자막 아래에 얹히는 오버레이다. 음소 단위 립싱크는 과잉이고, 문장 단위로 표정만 바뀌면 충분하다.

**브라우저는 투명 MOV를 못 만든다.** `MediaRecorder`, `WebCodecs` 모두 프리미어가 읽는 알파 채널 비디오를 못 뽑는다. WebM 알파는 프리미어가 못 읽는다. 그래서 브라우저는 "무엇을 언제 보여줄지"만 결정하고, 픽셀은 로컬 FFmpeg가 만든다.

**파일 하나(.bat)만 내보낸다.** `list.txt` + `render.bat` 두 개를 주면 관리가 번거롭다. `.bat` 하나가 `_ledy_list.txt`를 만들고 → FFmpeg 실행 → `_ledy_list.txt` 삭제까지 한다. 사용자 동선은 "다운로드 → PNG 폴더에 넣기 → 더블클릭"뿐이다.

**감정 목록은 코드가 아니라 프롬프트에 있다.** 표정은 계속 추가된다. 코드에 박아두면 표정 추가마다 재배포가 필요하다. 그래서 감정 사전을 편집 가능한 프롬프트 텍스트박스로 옮겼다. 표정 추가 = 프롬프트에 한 줄 추가, HTML은 안 건드림.

## 8-3. 처리 흐름

```
① ElevenLabs API 키          ┐
② 오디오 파일(TTS 음성)       ├─ 공유 입력 (자막/표정 둘 다 사용)
③ 영어 대본 텍스트            ┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          │                                                     │
   [SRT 생성]                                          [표정 생성]
   Forced Alignment로                                  1. SRT의 단어 타임스탬프 재사용
   단어별 타임스탬프 → 자막 블록                        2. 문장 단위로 묶음
   → SRT 다운로드                                       3. Claude API가 문장별 감정 배치
                                                        4. 문장별 표정 목록 표시(수정 가능)
                                                        5. [표정 다운로드] → .bat
                                                                 │
                                                    사용자가 .bat을 PNG 폴더에
                                                    넣고 더블클릭 → ledy.mov
```

`srtGenerate()`가 정렬 결과를 전역 `srtLastWords`에 저장하고 `ledyOnWordsReady()`를 부른다. 그래서 SRT를 먼저 안 만들면 표정 버튼이 비활성이다.

## 8-4. 감정 배치 프롬프트

Claude API에게 "이 문장들 각각에 어울리는 감정 키를 골라라"라고 시킨다. 입력은 문장 목록, 출력은 JSON 문자열 배열(길이 = 문장 수).

기본 프롬프트는 `LEDY_DEFAULT_PROMPT` 상수에 있다. **현재 감정 목록을 알고 싶으면 이 상수를 읽는다** — 여기 복제하지 않는다.

프롬프트는 두 블록으로 구성되고, 코드가 `DICTIONARY` / `PLACEMENT RULES` 헤더로 구간을 인식한다.

```
(도입부 - 자유롭게)

DICTIONARY
<감정키> (<변형수>) <설명>
...

PLACEMENT RULES
- <배치 규칙들>
```

DICTIONARY 한 줄의 형식이 가장 중요하다.

```
key (n) description
```

- `key` : 소문자 + 숫자 + 언더스코어. **파일명 앞부분과 정확히 일치해야 한다.**
- `(n)` : 변형(파일) 개수. 생략하면 1.
- `description` : Claude가 "언제 이 표정을 고를지" 판단하는 근거. **AI는 파일 이미지를 못 본다. 이 설명문만 보고 고른다. 그래서 설명문의 품질이 결과의 전부다.**

파일명은 `key_숫자.png`. `sad (3)` → `sad_1.png`, `sad_2.png`, `sad_3.png`. 코드가 이 규칙에 의존하므로 규칙을 바꾸려면 `ledyResolveFiles()`부터 고쳐야 한다.

**코드가 프롬프트를 쓰는 방식** — `ledyParseDict()`가 `DICTIONARY`~`PLACEMENT RULES` 사이에서 `key (n) ...` 패턴을 뽑아 `{keys, variants}`를 만든다. 이 목록이 (a) Claude에게 주는 허용 감정 목록, (b) 문장별 수정 드롭다운, (c) 파일명 생성의 기준이 된다. AI가 사전에 없는 키를 반환하면 `normal`로 폴백하고, 파싱이 완전히 실패해도 최소 `normal` 하나로 동작한다.

**출력 계약은 코드가 자동으로 덧붙인다.** 프롬프트에 아래를 쓸 필요 없다(써도 무방).

```
Return ONLY a JSON array of strings...
Each string must be one of: <사전의 키들>
The array length must exactly match the number of input lines.
```

그래서 프롬프트를 새로 써도 JSON 형식이 깨질 걱정은 없다. 도입부와 DICTIONARY, PLACEMENT RULES만 신경 쓰면 된다.

**변형 로테이션** — 같은 감정이 여러 번 나오면 매번 다음 변형 파일로 돈다. 연속이 아니어도 등장 횟수 기준이다. `normal` 3번이면 `normal_1` → `normal_2` → `normal_1`. 같은 그림이 반복되면 정지 화면처럼 보여서 넣은 장치다. AI는 변형 번호를 고르지 않는다 — `normal`만 반환하고 `_1`/`_2` 선택은 `ledyResolveFiles()`가 한다.

## 8-5. 왜 자막 블록이 아니라 문장 단위인가

표정을 자막 블록에 1:1로 붙이면 안 된다. 자막 블록은 짧아서 1~2단어씩 쪼개지고, 45초 대본이면 블록이 40~60개가 된다. 표정이 1초에 한 번씩 바뀌어 스트로브처럼 깜빡인다.

그래서 `ledyBuildSentences()`가 문장 단위로 묶는다.
1. 단어들을 문장 끝 부호(`.!?` + 닫는 따옴표/괄호)로 자른다.
2. "표정 최소 유지 시간"(슬라이더, 기본 2초)보다 짧은 문장은 앞 문장과 병합.
3. 마지막 문장도 너무 짧으면 앞으로 병합.

결과적으로 45초에 표정 컷 10~15개, 2~4초에 한 번 전환. 이게 적정 밀도다.

## 8-6. .bat / FFmpeg 규칙 (깨지기 쉬운 지점)

`.bat`은 FFmpeg **concat demuxer** 형식으로 `_ledy_list.txt`를 만든다.

```
ffconcat version 1.0
file 'normal_1.png'
duration 2.140
file 'shocked_1.png'
duration 3.660
...
file '<마지막파일>.png'      ← 마지막 파일을 duration 없이 한 번 더 반복
```

반드시 지켜야 하는 두 가지:

1. **마지막 파일 반복.** concat demuxer는 마지막 항목의 duration을 버린다. 마지막 파일을 duration 없이 한 번 더 써야 끝 컷이 1프레임만 나오는 버그를 막는다.
2. **duration = 다음 컷 시작 − 현재 컷 시작.** 현재 컷의 "끝 시각"을 쓰면 문장 사이 무음 구간에서 MOV에 구멍이 생긴다. 마지막 컷은 오디오 총 길이(없으면 마지막 단어 끝)까지 채운다.

```
ffmpeg -y -f concat -safe 0 -i _ledy_list.txt -r <fps> -vf scale=<width>:-2 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ledy.mov
```

- **ProRes 4444** (`yuva444p10le` = 알파 포함). 프리미어 네이티브, 무손실 알파. 처음엔 `qtrle`을 썼는데 안티에일리어싱된 외곽선 때문에 RLE 압축이 안 먹혀 파일이 너무 커졌다.
- `scale=<width>:-2` : 가로만 지정, 세로는 비율 유지(`-2`는 2의 배수로 맞춤, 코덱 요구사항).
- `<width>`는 UI 슬라이더(기본 500px), `<fps>`는 SRT 쪽 fps 버튼과 공유(기본 29.97).

`.bat` 첫 줄은 `cd /d "%~dp0"`. `%~dp0`는 .bat 자신이 있는 폴더라 절대경로를 하드코딩하지 않는다. 폴더를 옮기거나 다른 PC로 복사해도 동작한다. 내려받는 파일명은 `<오디오파일명>_ledy.bat`.

전제조건: 사용자 PC에 FFmpeg 설치(`winget install Gyan.FFmpeg`). 혼자 쓰는 내부 툴이라 이 마찰은 수용한다.

## 8-7. 코드 위치

전부 `ledy` 접두사로 격리돼 있다.

| 요소 | 식별자 |
|---|---|
| 기본 프롬프트 | `LEDY_DEFAULT_PROMPT` |
| 프롬프트 파서 | `ledyParseDict()` |
| 문장 묶음 | `ledyBuildSentences()` |
| 감정 배치(API 호출) | `ledyGenerate()` |
| 변형 파일명 로테이션 | `ledyResolveFiles()` |
| 문장별 표정 목록 렌더 | `ledyRenderCues()` |
| 표정 수동 수정 | `ledySetKey()` |
| 문장 오디오 미리듣기 | `ledyPlay()` |
| .bat 생성/다운로드 | `ledyDownload()` |
| 프롬프트 저장/복원 | `ledyGetPrompt()` / `ledySavePrompt()` / `ledyResetPrompt()` |

기존 코드에 손댄 곳은 두 군데뿐이다.
- `srtGenerate()`에 `srtLastWords = words; ledyOnWordsReady();` 추가
- `srtSetAudioFile()`에 오디오 길이 읽기 + Ledy 상태 초기화 추가

UI는 **자막 & 표정 생성** 탭. 상단에 공유 입력(①②③), 아래 2단 분할(`.srt-split`) — 왼쪽 자막(SRT), 오른쪽 Ledy 표정(MOV).

## 8-8. 표정 추가 요청을 받았을 때

"새 표정 추가했어, 프롬프트 줘" 같은 요청이 오면:

**먼저 확인** — 파일명이 `key_숫자.png` 규칙을 따르는지, 변형이 몇 개인지, 언제 쓰는 표정인지(이게 description이 된다), 기존 감정과 역할이 겹치는지.

**전체 프롬프트를 통째로 돌려준다.** 일부만 주면 어디에 끼울지 헷갈린다. 기존 항목은 `LEDY_DEFAULT_PROMPT`(또는 이미 편집된 프롬프트)에서 그대로 가져오고 새 줄만 추가한다. 사용자는 그걸 "감정 배치 프롬프트" 텍스트박스에 통째로 붙여넣는다.

**description 쓰는 법** — "언제 이 표정을 고르는가"를 구체적으로. 감정 단어만 나열하지 말고 상황을 준다.
- 나쁨: `sleepy (2) Sleepy face.`
- 좋음: `sleepy (2) Drowsy, nodding off, low energy. When something is so slow or dull she's dozing off.`

기존 것과 겹치면 PLACEMENT RULES에 구분 한 줄 추가.
- 예: `sleepy = actually dozing off. boring = uninterested but awake. Pick boring unless she's literally falling asleep.`

"기본은 normal" 원칙은 유지한다. 새 감정에 "이것도 자주 써라"를 넣으면 표정이 산만해진다. 특수 표정은 "정확히 맞을 때만"이 기본값이다. 프롬프트 본문은 영어로 쓴다 — 대본이 영어라 감정 판단도 영어 문맥에서 이뤄진다.

**돌려준 뒤 안내** — 텍스트박스에 통째로 붙여넣으면 되고 HTML은 안 고쳐도 된다는 것, 그리고 프롬프트가 기대하는 PNG가 실제로 폴더에 있어야 한다는 것(없으면 그 표정이 배치될 때 FFmpeg가 멈춘다). `(2)`로 적었으면 `_1`, `_2` 둘 다 필요하다.

`key`에 대문자나 공백을 쓰면 파일명과 안 맞아 FFmpeg가 죽는다. 소문자 + 언더스코어만.

## 8-9. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| .bat 실행 시 `No such file or directory` | 파일명 불일치(대소문자 포함) | .bat을 메모장으로 열어 부르는 파일명 확인 → 폴더와 대조 |
| MOV 끝 컷이 순식간에 지나감 | 마지막 파일 반복 누락 | `ledyDownload()`가 마지막 파일을 duration 없이 한 번 더 쓰는지 확인 |
| 표정 바뀔 때 Ledy가 커졌다 작아짐 | 표정 PNG들의 캔버스 크기·중심이 제각각 | 모든 표정을 같은 캔버스 크기·같은 머리 중심으로 정규화 |
| MOV 배경이 검거나 흼 | 알파 미포함 | FFmpeg 명령에 `-pix_fmt yuva444p10le` 있는지 확인 |
| 표정이 1초마다 깜빡임 | 문장이 아니라 자막 블록에 붙음 | `ledyBuildSentences` 사용 확인, 최소 유지시간 슬라이더 ↑ |
| 특정 표정이 안 나옴 | 사전에 없거나 파일 없음 | 프롬프트 DICTIONARY에 있는지 + 폴더에 파일 있는지 |
| 표정이 전부 normal | API 파싱 실패(폴백 발동) | 프롬프트 형식 확인, 또는 문장별 드롭다운으로 수동 수정 |

## 8-10. 확장 아이디어 (미구현)

**눈 깜빡임** — 각 표정의 눈감은 버전을 만들고, concat 리스트에 2~4초마다 0.08초짜리 깜빡임 프레임을 자동 삽입. 정지 표정이 살아 보인다. 구현 비용은 낮다(리스트에 줄 추가).
