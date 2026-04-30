<div align="center">

# Open_Translator

**YouTube 자막을 로컬 OpenAI 호환 프록시로 번역하고, 플레이어 위에 실시간 오버레이와 SRT 다운로드를 제공하는 Chrome MV3 확장 프로그램**

WXT · React · TypeScript · Chrome Extensions MV3 · YouTube Caption Tracks · OpenAI-compatible Local Proxy

[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![WXT](https://img.shields.io/badge/WXT-0.20-7C3AED)](https://wxt.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Local Proxy](https://img.shields.io/badge/OpenAI_Compatible-Local_Proxy-111111)](https://github.com/EvanZhouDev/openai-oauth)

</div>

---

## 목차

- [프로젝트 소개](#프로젝트-소개)
- [현재 주요 기능](#현재-주요-기능)
- [빠른 시작](#빠른-시작)
- [사용 흐름](#사용-흐름)
- [문맥 번역 준비 기준](#문맥-번역-준비-기준)
- [자막 다운로드와 확인 페이지](#자막-다운로드와-확인-페이지)
- [시스템 아키텍처](#시스템-아키텍처)
- [기술 스택과 선정 이유](#기술-스택과-선정-이유)
- [자막 수집 전략](#자막-수집-전략)
- [캐시와 성능 전략](#캐시와-성능-전략)
- [설정](#설정)
- [자동 생성 자막과 라이브 자막](#자동-생성-자막과-라이브-자막)
- [구현 중 어려웠던 점](#구현-중-어려웠던-점)
- [프로젝트 구조](#프로젝트-구조)
- [명령어](#명령어)
- [권한과 저장소](#권한과-저장소)
- [알려진 한계와 주의점](#알려진-한계와-주의점)

---

## 프로젝트 소개

Open_Translator는 YouTube 영상의 자막 트랙을 읽고, 현재 재생 시간에 맞는 자막을 로컬 OpenAI 호환 프록시로 번역한 뒤 영상 위에 표시하는 확장 프로그램입니다.

페이지 전체 번역이 아니라 **YouTube 자막 cue와 영상 재생 시간**을 기준으로 동작합니다. 원본 자막 위치를 따라가며 번역문을 표시하고, 가능한 경우 앞뒤 자막을 묶어 문맥 번역을 미리 준비합니다. 번역된 자막은 실시간 표시뿐 아니라 `.srt` 파일로 내려받을 수 있고, 다운로드 전 확인 페이지에서 시간대별 원문/번역을 직접 수정할 수 있습니다.

현재 구현은 다음 문제를 해결하는 데 초점을 맞춥니다.

- YouTube SPA 이동 후에도 현재 영상의 자막만 사용
- 새로고침 없이 AI 버튼과 자막 hook이 동작하도록 YouTube 전역에서 content script 실행
- 자동 생성 자막의 짧고 겹치는 cue를 보기 좋은 단위로 병합
- 영어/한국어처럼 어순이 다른 언어를 위해 40개 cue 단위 문맥 번역을 선호
- 문맥 번역이 늦을 때는 단문 번역으로 즉시 표시
- 실시간으로 쌓인 번역 캐시를 SRT 다운로드에도 재사용
- 전체화면, 극장 모드, 일반 화면에서 자막 오버레이와 AI 메뉴가 화면 안쪽에 머물도록 보정

---

## 현재 주요 기능

| 기능 | 설명 |
| --- | --- |
| **YouTube 자막 감지** | `watch`와 `shorts` 페이지에서 영상 ID와 caption track을 감지합니다. content script는 `https://www.youtube.com/*`에 주입되고 내부 route guard로 영상 페이지만 처리합니다. |
| **빠른 page-world hook** | `document_start`에서 `youtube-hook.js`를 동기 주입해 YouTube 초기 player/timedtext 요청을 놓치지 않도록 합니다. |
| **다중 자막 수집** | InnerTube Android client, YouTube 플레이어의 signed timedtext 응답 hook, 직접 timedtext fallback을 순서대로 시도합니다. |
| **실시간 번역 오버레이** | 현재 cue를 번역해 YouTube 플레이어 위에 표시하고, 원문 자막 표시 여부를 설정할 수 있습니다. |
| **문맥 번역 선준비** | 자막을 40개 cue 단위로 묶어 전체 문맥 번역을 미리 요청합니다. 준비된 문맥 번역을 우선 사용하고, 준비 전에는 단문 번역으로 보완합니다. |
| **선번역과 캐시** | 시작부 8개 cue, 재생 위치 이후 10개 cue를 선번역합니다. content-local 캐시와 background 메모리 캐시를 함께 사용합니다. |
| **AI 플레이어 메뉴** | YouTube 컨트롤 영역의 `AI` 버튼에서 번역 표시 on/off, SRT 다운로드 메뉴를 제공합니다. 메뉴는 버튼 위쪽으로 열리고 viewport 안쪽으로 보정됩니다. |
| **SRT 다운로드** | 번역 전용 또는 원문+번역 형식으로 `.srt`를 만들 수 있습니다. 다운로드 전 확인 페이지가 열립니다. |
| **자막 확인/수정 페이지** | 시간대별 원문/번역 타임테이블을 보여주고, 각 cue의 원문과 번역을 직접 수정한 뒤 다운로드할 수 있습니다. |
| **전체 문맥 다듬기** | 확인 페이지에서 전체 자막을 50개 cue 단위로 다시 보내 번역문을 문맥에 맞게 다듬을 수 있습니다. |
| **팝업/옵션 설정** | 모델, 대상 언어, 프롬프트, 타임아웃, 디바운스, 원문 표시, 오버레이 위치, 글자 수 제한을 설정합니다. |

---

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

Windows PowerShell에서 실행 정책 때문에 `npm`이 막히면 `npm.cmd`를 사용합니다.

```powershell
npm.cmd install
```

### 2. 로컬 OpenAI 호환 프록시 실행

확장은 로컬 프록시 `http://127.0.0.1:10531/v1`에만 요청합니다. 원격 OpenAI API로 직접 요청하지 않습니다.

```bash
npm run proxy:start
```

중지:

```bash
npm run proxy:stop
```

직접 실행하려면 `openai-oauth`를 사용할 수 있습니다.

```bash
npx openai-oauth
```

### 3. 빌드

```bash
npm run build
```

`wxt build` 후 `.output/chrome-mv3`가 `dist/`로 동기화됩니다.

### 4. Chrome에 로드

```text
chrome://extensions
-> Developer mode ON
-> Load unpacked
-> 이 저장소의 dist 폴더 선택
```

이후 YouTube 영상에서 자막을 켜고 플레이어의 `AI` 버튼을 누르면 메뉴가 열립니다.

---

## 사용 흐름

1. YouTube 영상 페이지에 들어갑니다.
2. YouTube 자막을 켭니다.
3. 플레이어 오른쪽 컨트롤 영역에 생기는 `AI` 버튼을 누릅니다.
4. 메뉴에서 `번역 표시`를 켜거나 끕니다.
5. 번역 오버레이가 원본 자막 위치 또는 플레이어 하단 fallback 위치에 표시됩니다.
6. SRT가 필요하면 `자막 다운로드 (번역)` 또는 `자막 다운로드 (원문+번역)`을 누릅니다.
7. 새 확인 페이지에서 시간대별 원문/번역을 검토하고 수정합니다.
8. 필요하면 `전체 문맥으로 다듬기`를 실행한 뒤 `.srt 다운로드`를 누릅니다.

---

## 문맥 번역 준비 기준

실시간 표시에는 두 종류의 번역이 함께 사용됩니다.

| 종류 | 기준 | 용도 |
| --- | --- | --- |
| **문맥 번역** | 자막 cue를 40개씩 묶어 `subtitle:translate-cues`로 요청합니다. | 앞뒤 문맥과 어순을 고려한 자연스러운 번역을 우선 제공합니다. |
| **단문 번역** | 현재 cue 또는 선번역 대상 cue 하나를 `subtitle:translate`로 요청합니다. | 문맥 번역이 아직 준비되지 않았을 때 화면 표시 지연을 줄입니다. |

문맥 번역이 "준비됨"으로 간주되는 기준은 해당 cue index에 대한 번역 결과가 `contextTranslationByIndex`에 저장되어 있고, 빈 문자열이 아닌 경우입니다.

동작 방식:

- 자막 트랙을 불러오면 전체 cue를 40개 단위 chunk로 나눕니다.
- 모든 chunk를 큐에 넣지만, 한 번에 하나씩 처리합니다.
- 현재 재생 중인 cue가 속한 chunk는 우선순위를 올립니다.
- 현재 cue의 문맥 번역이 이미 있으면 바로 표시합니다.
- 아직 없으면 단문 번역을 즉시 요청해 먼저 표시합니다.
- 나중에 문맥 번역 chunk가 완료되면 현재 cue 표시를 문맥 번역으로 갱신합니다.

따라서 문맥 번역은 **미리 준비되고 우선 사용되지만, 영상 속도와 모델 응답 속도에 따라 항상 자막이 나오기 전에 완료된다고 보장되지는 않습니다.** 특히 자동 생성 자막은 YouTube가 원문 cue를 만든 뒤에야 확장이 가져올 수 있으므로, 원문이 존재하기 전에는 미리 번역할 수 없습니다.

---

## 자막 다운로드와 확인 페이지

AI 메뉴에는 두 가지 다운로드 진입점이 있습니다.

| 버튼 | SRT 내용 |
| --- | --- |
| **자막 다운로드 (번역)** | 번역문만 포함합니다. 번역이 비어 있으면 원문으로 fallback합니다. |
| **자막 다운로드 (원문+번역)** | 한 cue 안에 번역문과 원문을 줄바꿈으로 함께 넣습니다. |

다운로드 버튼을 누르면 바로 파일을 저장하지 않고, 먼저 `subtitle-preview.html` 확인 페이지를 엽니다.

확인 페이지 기능:

- 영상 제목, cue 개수, 대상 언어 표시
- `시간 / 원문 / 번역` 타임테이블 표시
- cue별 원문과 번역 직접 수정
- cue별 되돌리기와 전체 되돌리기
- 번역 전용/원문+번역 모드 전환
- SRT 원문 미리보기
- 전체 문맥으로 다듬기
- UTF-8 BOM 포함 `.srt` 다운로드

내보내기 성능 최적화:

- 실시간 재생 중 만들어진 문맥 번역을 가장 먼저 재사용합니다.
- 그다음 단문 번역 캐시를 재사용합니다.
- 아직 번역되지 않은 고유 원문만 추가 번역합니다.
- export payload는 `browser.storage.local`의 `subtitleExport:{id}` 키에 임시 저장됩니다.

SRT 생성 규칙:

- timestamp는 `HH:MM:SS,mmm` 형식입니다.
- `end <= start`인 cue는 제외합니다.
- 파일명은 영상 제목을 기반으로 만들고, 사용할 수 없는 문자는 제거합니다.

---

## 시스템 아키텍처

```text
YouTube page
  |
  | ytInitialPlayerResponse / fetch / XHR / timedtext
  v
youtube-hook.js (MAIN world)
  - /youtubei/v1/player 응답 캡처
  - timedtext 응답 캡처
  - captionTracks, videoId, isLive 추출
  |
  | window.postMessage
  v
youtube.content React app (Shadow DOM)
  - 현재 route/videoId 추적
  - 자막 트랙 선택과 cue 파싱
  - 문맥 번역 queue와 단문 선번역 queue 관리
  - 플레이어 자막 오버레이와 AI 메뉴 렌더링
  |
  | browser.runtime.sendMessage
  v
background service worker
  - 설정 로드
  - 프롬프트 렌더링
  - 번역 캐시
  - SRT 확인 페이지 열기
  |
  | HTTP
  v
local OpenAI-compatible proxy
  http://127.0.0.1:10531/v1/chat/completions
```

핵심 entrypoint:

- `entrypoints/youtube-injector.content.ts`: `document_start`에 page-world hook을 동기 주입합니다.
- `entrypoints/youtube-hook.ts`: YouTube 페이지의 `fetch`와 XHR을 hook하고 자막 관련 응답을 content script로 전달합니다.
- `entrypoints/youtube.content/App.tsx`: YouTube 위의 React UI, cue 선택, 번역 큐, SRT export payload 생성을 담당합니다.
- `entrypoints/background.ts`: 런타임 메시지 라우팅, 로컬 프록시 호출, 문맥 번역/다듬기 요청, preview tab 생성을 담당합니다.
- `entrypoints/subtitle-preview/App.tsx`: SRT 확인, 편집, 문맥 다듬기, 다운로드 페이지입니다.

레이어별 책임은 다음처럼 분리했습니다.

| 레이어 | 책임 | 분리한 이유 |
| --- | --- | --- |
| **page-world hook** | YouTube의 player/timedtext 요청을 가장 이른 시점에 관찰합니다. | content script isolated world에서는 YouTube의 `window.fetch`와 XHR을 직접 안정적으로 hook하기 어렵습니다. |
| **content UI** | route 추적, cue 선택, 오버레이 렌더링, export payload 준비를 담당합니다. | 실제 DOM과 video time에 가까운 작업을 한곳에 모아 화면 동기화를 단순화했습니다. |
| **background service worker** | 설정 로드, 프롬프트 생성, 프록시 호출, 번역 캐시, preview tab open을 담당합니다. | 네트워크와 설정 로직을 UI에서 분리해 메시지 계약을 명확히 했습니다. |
| **subtitle preview page** | SRT 편집, 문맥 다듬기, 최종 다운로드를 담당합니다. | 플레이어 위 메뉴를 가볍게 유지하고, 긴 자막 편집은 별도 화면에서 처리합니다. |
| **local proxy** | OpenAI 호환 `/v1/chat/completions`와 `/v1/models`를 제공합니다. | 확장 프로그램은 로컬 권한만 갖고, 인증과 원격 API 접근은 프록시에 맡깁니다. |

이 구조는 게임 클라이언트의 입력/시뮬레이션/UI/네트워크 계층을 분리하는 방식과 비슷하게 설계했습니다. YouTube 페이지를 외부 런타임으로 보고, content UI는 매 프레임 현재 상태를 읽는 클라이언트 레이어, background는 비동기 서비스 레이어처럼 동작합니다.

---

## 기술 스택과 선정 이유

| 기술 | 사용 위치 | 선정 이유 |
| --- | --- | --- |
| **Chrome Extensions MV3** | 전체 확장 런타임 | YouTube 페이지 위에 기능을 얹기 위해 가장 직접적인 배포 단위입니다. service worker와 content script를 분리할 수 있어 UI와 네트워크 책임을 나누기 좋습니다. |
| **WXT** | entrypoint, manifest, build | MV3 manifest와 여러 entrypoint를 직접 관리하는 비용을 줄이고, React/TypeScript 기반 확장 개발을 빠르게 구성할 수 있습니다. |
| **React 19** | popup, options, YouTube overlay, subtitle preview | 설정 화면과 편집 테이블처럼 상태가 많은 UI를 컴포넌트 단위로 관리하기 좋습니다. YouTube overlay도 상태 전환이 잦아 선언형 UI가 잘 맞았습니다. |
| **TypeScript** | 전체 코드 | background와 content script 사이의 message payload가 많아졌기 때문에 타입 계약을 명확히 유지하는 것이 중요했습니다. |
| **Shadow DOM UI** | YouTube content UI | YouTube 페이지 CSS와 확장 UI 스타일이 서로 오염되지 않도록 격리합니다. |
| **page-world script injection** | `youtube-hook.js` | YouTube의 초기 네트워크 요청을 놓치지 않기 위해 page context에서 동기 실행되는 hook이 필요했습니다. |
| **InnerTube / timedtext** | 자막 수집 | DOM만으로는 자막 본문을 안정적으로 얻기 어려워, YouTube가 실제 사용하는 caption track과 timedtext 응답을 함께 활용했습니다. |
| **OpenAI-compatible local proxy** | 번역 요청 | 확장에는 로컬 host 권한만 두고, 모델 선택과 인증은 프록시 쪽으로 분리했습니다. OpenAI 호환 API를 쓰면 모델 교체도 쉽습니다. |
| **browser.storage.sync/local** | 설정과 export payload | 작은 사용자 설정은 sync에 저장하고, SRT 확인 페이지로 넘기는 큰 임시 데이터는 local에 분리했습니다. |

---

## 자막 수집 전략

자막 본문은 영상마다 접근 방식이 달라서 세 단계 fallback을 사용합니다.

1. **InnerTube Android client**
   - videoId와 선호 언어를 기반으로 YouTube player 응답을 다시 요청합니다.
   - 성공하면 caption baseUrl에서 자막 본문을 가져옵니다.

2. **intercepted timedtext body**
   - YouTube 플레이어가 이미 요청한 signed timedtext 응답을 page-world hook에서 저장합니다.
   - 직접 요청이 실패하는 경우 이 응답을 재사용할 수 있습니다.

3. **direct timedtext fallback**
   - `fmt=json3`, `srv3`, `srv1`, 기본 포맷 순서로 직접 요청합니다.
   - JSON3과 XML 계열 자막을 모두 파싱합니다.

현재 caption track 선택은 영어(`en`)를 우선합니다. 영어 수동 자막, 영어 자동 생성 자막, 임의 수동 자막, 첫 번째 트랙 순서로 선택됩니다.

---

## 캐시와 성능 전략

| 계층 | 저장 내용 | 특징 |
| --- | --- | --- |
| **content-local `contextTranslationByIndex`** | 문맥 번역 결과 | cue index 기준입니다. SRT export에서 가장 먼저 사용합니다. |
| **content-local `translationByText`** | 단문 번역 결과 | 원문 text 기준입니다. 실시간 fallback과 export에 재사용됩니다. |
| **background `translationCache`** | 프록시 응답 캐시 | 모델, 대상 언어, 프롬프트, source language hint, 정규화된 원문 기준입니다. 최대 120개입니다. |

선번역 정책:

- 자막 로드 직후 처음 8개 cue를 단문 선번역합니다.
- 재생 중 현재 cue 이후 최대 10개 cue를 단문 선번역 큐에 넣습니다.
- 단문 선번역 동시 처리 수는 3개입니다.
- 문맥 번역은 40개 cue chunk를 큐에 넣고, 한 번에 1개 chunk씩 처리합니다.

이 구조는 속도와 품질의 타협입니다. 문맥 번역이 준비되면 품질을 우선하고, 아직 준비되지 않았으면 단문 번역으로 화면 공백을 줄입니다.

---

## 설정

설정은 `browser.storage.sync`에 저장됩니다. 기본값과 검증 로직은 `lib/settings.ts`에 있습니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `true` | 번역 표시 on/off |
| `targetLanguage` | `Korean` | 번역 대상 언어 |
| `model` | `gpt-5.4-mini` | 로컬 프록시로 보낼 모델명 |
| `promptTemplate` | 기본 번역 프롬프트 | `{{targetLanguage}}`, `{{sourceLanguage}}`, `{{pageUrl}}`, `{{text}}` 치환자를 지원합니다. |
| `requestTimeoutMs` | `30000` | 단문 번역 요청 타임아웃입니다. |
| `debounceMs` | `80` | 자막이 사라지는 전환 구간의 흔들림을 줄이는 지연값입니다. |
| `showSourceCaption` | `true` | 번역문 아래에 원문을 함께 표시합니다. |
| `overlayPosition` | `bottom` | native caption rect를 찾지 못할 때 사용할 fallback 위치입니다. |
| `maxCharactersPerRequest` | `180` | 단문 번역과 자동 생성 자막 병합 기준에 사용하는 글자 수 제한입니다. |

옵션 페이지에서는 다음을 제공합니다.

- 모델 목록 조회와 선택
- 대상 언어 입력
- 프롬프트 편집
- 요청 타임아웃, 디바운스, 글자 수 제한
- 원문 표시 여부
- 오버레이 상단/하단 위치
- 설정 저장, 변경 취소, 기본값 초기화

모델 목록은 `http://127.0.0.1:10531/v1/models`에서 가져오며, 실패하면 내장 기본 모델 목록을 사용합니다.

---

## 자동 생성 자막과 라이브 자막

### 자동 생성 자막

자동 생성 자막(`kind: asr`)은 지원하지만, YouTube가 음성을 인식해 원문 cue를 만든 뒤에야 확장이 읽을 수 있습니다. 그래서 **원문 cue가 아직 없는 미래 구간을 완전히 미리 번역하는 것은 불가능**합니다.

대신 VOD에서 이미 접근 가능한 자동 생성 자막 트랙은 다음 방식으로 보정합니다.

- 너무 짧은 ASR cue를 병합합니다.
- 겹쳐 반복되는 단어를 overlap 기준으로 제거합니다.
- 문장 종료부, 긴 gap, 긴 duration, 글자 수 제한을 만나면 새 cue로 나눕니다.
- 기본 병합 최대 길이는 `maxCharactersPerRequest`를 따르며, 최소 40자 이상입니다.
- 기본 최대 병합 duration은 4.5초, 최대 merge gap은 0.8초입니다.

자동 생성 자막의 원문 인식이 틀리면 번역도 영향을 받습니다. 확인 페이지의 직접 수정과 전체 문맥 다듬기를 함께 쓰는 것을 권장합니다.

### 라이브 자막

YouTube가 영상을 `isLive` 또는 `isLiveContent`로 표시하면 현재 구현은 cue 로딩을 중단하고 실시간 번역을 수행하지 않습니다. 라이브 스트림은 VOD와 자막 제공 방식이 달라 별도 처리가 필요합니다.

---

## 구현 중 어려웠던 점

### 1. 외부 런타임 위에서 UI와 시간 동기화하기

YouTube 플레이어는 확장이 소유한 렌더링 환경이 아니기 때문에, 자막 위치와 현재 재생 시간을 매번 외부 상태로 읽어와야 했습니다. 단순히 하단 고정 UI를 띄우면 전체화면, 극장 모드, 원본 자막 위치 변경에서 쉽게 어긋납니다.

이를 해결하기 위해 `requestAnimationFrame` 루프에서 video time을 기준으로 active cue를 갱신하고, caption rect는 별도 poll과 resize/fullscreen 이벤트로 보정했습니다. 원본 caption window가 있으면 그 위치를 따라가고, 없으면 player rect 기반 fallback을 계산합니다. 게임 클라이언트에서 월드 상태와 UI overlay를 매 프레임 맞추는 문제와 비슷한 지점입니다.

### 2. 영상 전환 중 오래된 비동기 결과 차단하기

YouTube는 SPA라 영상이 바뀌어도 기존 탭과 일부 네트워크 요청이 그대로 살아 있습니다. 이 상태에서 이전 영상의 caption track이나 번역 결과가 늦게 도착하면 새 영상 위에 잘못된 자막이 표시될 수 있습니다.

route key와 expected videoId를 기준으로 caption track을 필터링하고, navigation 시 cue state와 캐시를 비우며, 진행 중인 fetch는 abort합니다. 또한 cue generation 값을 두어 이전 세대의 비동기 결과는 화면에 반영하지 않습니다. 장면 전환 중 이전 scene의 async load 결과가 새 scene에 적용되지 않도록 막는 방식과 같은 문제로 보았습니다.

### 3. 품질과 반응성 사이의 균형 잡기

문맥 번역은 품질이 좋지만 응답 시간이 길고, 단문 번역은 빠르지만 어순과 앞뒤 맥락이 어색할 수 있습니다. 실시간 자막에서는 둘 중 하나만 고르면 체감 품질이나 반응성 한쪽이 무너집니다.

그래서 40개 cue 단위 문맥 번역을 미리 준비하되, 현재 cue의 문맥 번역이 아직 없으면 단문 번역을 먼저 표시합니다. 문맥 chunk가 나중에 완료되면 현재 cue를 더 자연스러운 번역으로 갱신합니다. 네트워크 지연을 완전히 없애기보다, 사용자가 보는 순간의 공백을 줄이고 뒤에서 품질을 따라잡는 구조입니다.

### 4. 자동 생성 자막을 읽기 좋은 단위로 정규화하기

자동 생성 자막은 짧은 조각이 빠르게 나오거나 단어가 겹쳐 반복되는 경우가 많습니다. 그대로 번역하면 모델 입력도 흔들리고, 화면에서도 자막이 잘게 쪼개져 읽기 어렵습니다.

ASR cue를 시간 gap, 문장 종료, 최대 길이, 최대 duration 기준으로 병합하고, 겹치는 단어는 overlap 비교로 제거했습니다. 이 처리는 번역 품질뿐 아니라 자막 표시 안정성에도 영향을 주기 때문에, 네트워크 최적화보다 먼저 데이터 단위를 정리하는 쪽에 무게를 두었습니다.

### 5. YouTube UI를 방해하지 않는 조작 계층 만들기

확장 UI는 플레이어 위에 떠야 하지만, YouTube의 재생/전체화면/컨트롤 조작을 방해하면 안 됩니다. 반대로 AI 메뉴와 SRT 버튼은 실제 클릭을 받아야 합니다.

Shadow DOM root는 기본적으로 pointer event를 통과시키고, 메뉴와 버튼처럼 상호작용이 필요한 영역만 pointer event를 받도록 나눴습니다. 메뉴는 AI 버튼 위쪽으로 열고 viewport 안쪽으로 clamp해 전체화면에서도 잘리지 않게 했습니다. 외부 UI 위에 얹는 overlay를 렌더링 레이어와 입력 레이어로 분리한 점이 핵심입니다.

---

## 프로젝트 구조

```text
Open_Translator/
├── entrypoints/
│   ├── background.ts                    # MV3 service worker, proxy calls, message router
│   ├── youtube-hook.ts                  # page-world YouTube fetch/XHR hook
│   ├── youtube-injector.content.ts      # document_start hook injector
│   ├── youtube.content/
│   │   ├── App.tsx                      # YouTube overlay, AI menu, translation queues, export payload
│   │   ├── captions.ts                  # caption parsing, ASR merge, active cue search
│   │   ├── innertube.ts                 # InnerTube caption fallback
│   │   ├── pageBridge.ts                # page-world/content bridge
│   │   ├── index.tsx                    # Shadow DOM UI mount
│   │   └── style.css
│   ├── subtitle-preview/
│   │   ├── App.tsx                      # SRT preview, timetable editor, polish, download
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── style.css
│   ├── popup/
│   │   ├── App.tsx                      # quick settings popup
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── style.css
│   └── options/
│       ├── App.tsx                      # full settings page
│       ├── index.html
│       ├── main.tsx
│       └── style.css
├── lib/
│   ├── messages.ts                      # typed runtime message protocol
│   ├── openai.ts                        # local proxy chat/completions client
│   ├── proxy-models.ts                  # /v1/models discovery and fallback models
│   ├── settings.ts                      # defaults, validation, sync storage migration
│   └── subtitle-export.ts               # SRT builder and export payload types
├── public/
│   └── icon/                            # extension icons
├── scripts/
│   ├── sync-dist.mjs                    # copy .output/chrome-mv3 to dist
│   ├── start-openai-oauth-hidden.ps1
│   └── stop-openai-oauth.ps1
├── proxy-setup.bat                      # Windows proxy setup helper
├── start-proxy-hidden.bat
├── stop-proxy.bat
├── wxt.config.ts
├── package.json
└── README.md
```

---

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | WXT 개발 모드 실행 |
| `npm run dev:firefox` | Firefox 대상 개발 모드 실행 |
| `npm run compile` | TypeScript 타입 검사 |
| `npm run build` | Chrome MV3 production build 후 `dist/` 동기화 |
| `npm run build:firefox` | Firefox 대상 build |
| `npm run zip` | Chrome extension zip 생성 |
| `npm run zip:firefox` | Firefox extension zip 생성 |
| `npm run proxy:start` | Windows에서 `openai-oauth` 프록시를 hidden PowerShell로 시작 |
| `npm run proxy:stop` | 프록시 프로세스 중지 |

최근 로컬 build 기준 WXT Chrome MV3 output total은 약 `499.52 kB`입니다.

---

## 권한과 저장소

### Manifest 권한

| 항목 | 값 | 목적 |
| --- | --- | --- |
| `permissions` | `storage` | 설정과 임시 export payload 저장 |
| `host_permissions` | `http://127.0.0.1/*` | 로컬 OpenAI 호환 프록시 호출 |
| `web_accessible_resources` | `youtube-hook.js` | YouTube page-world에 hook script 주입 |
| content script matches | `https://www.youtube.com/*` | YouTube SPA 이동과 초기 hook을 안정적으로 처리 |

### 저장소 사용

| 저장소 | 사용 내용 |
| --- | --- |
| `browser.storage.sync` | 확장 설정과 `settingsSchemaVersion` |
| `browser.storage.local` | SRT 확인 페이지로 넘기는 임시 `subtitleExport:{id}` payload |
| background memory | 최대 120개 번역 cache, service worker 재시작 시 초기화 |

로컬 프록시 URL은 코드에서 `http://127.0.0.1:10531/v1`로 고정되어 있으며, `http`, host, port, `/v1` path를 검증합니다.

---

## 알려진 한계와 주의점

- YouTube의 내부 player/timedtext API와 DOM 구조에 의존하므로 YouTube 변경에 영향을 받을 수 있습니다.
- 라이브 스트림은 현재 번역 대상에서 제외됩니다.
- 자막 트랙이 없는 영상은 번역하거나 SRT로 내보낼 수 없습니다.
- 자동 생성 자막은 YouTube의 음성 인식 결과가 원문이므로, 원문 품질이 낮으면 번역 품질도 낮아집니다.
- 문맥 번역은 품질을 위해 전체 cue chunk를 사용하지만, 모델 응답이 늦으면 먼저 단문 번역이 표시될 수 있습니다.
- bulk 문맥 번역과 다듬기는 모델이 JSON 배열 `{ "index": number, "translation": string }` 형식을 지켜야 합니다. 형식이 깨지면 해당 chunk는 실패하고 단문 번역 fallback이 남습니다.
- 확장 프로그램을 다시 로드한 뒤 이미 열린 YouTube 탭은 `Extension context invalidated` 상태가 될 수 있습니다. 이 경우 YouTube 탭을 새로고침해야 content script와 background 연결이 복구됩니다.
- 원격 API 권한은 선언하지 않습니다. 인증과 API 연결은 로컬 프록시가 담당합니다.

---

<div align="center">

**Open_Translator** · Local-first YouTube subtitle translation extension

</div>
