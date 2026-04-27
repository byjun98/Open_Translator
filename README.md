<div align="center">

# Open_Translator

**Chrome MV3 기반 YouTube 자막 번역 확장 프로그램 — 로컬 OpenAI 호환 프록시로 자막을 번역하고 플레이어 위에 오버레이 표시**

WXT · React · TypeScript · Chrome Extensions MV3 · YouTube Caption Tracks · OpenAI-compatible Proxy

[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![WXT](https://img.shields.io/badge/WXT-0.20-7C3AED)](https://wxt.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAI Proxy](https://img.shields.io/badge/openai--oauth-local_proxy-111111)](https://github.com/EvanZhouDev/openai-oauth)

</div>

---

## 목차

- [프로젝트 소개](#프로젝트-소개)
- [주요 기능](#주요-기능)
- [시스템 아키텍처](#시스템-아키텍처)
- [기술 스택 & 선택 이유](#기술-스택--선택-이유)
- [핵심 기능 상세](#핵심-기능-상세)
  - [1. YouTube 자막 트랙 수집](#1-youtube-자막-트랙-수집)
  - [2. 자막 파싱과 현재 구간 매칭](#2-자막-파싱과-현재-구간-매칭)
  - [3. 로컬 프록시 기반 번역 요청](#3-로컬-프록시-기반-번역-요청)
  - [4. 플레이어 오버레이와 빠른 설정](#4-플레이어-오버레이와-빠른-설정)
  - [5. 옵션 페이지와 사용자 설정](#5-옵션-페이지와-사용자-설정)
- [연동 프로젝트](#연동-프로젝트)
- [어려웠던 점과 해결](#어려웠던-점과-해결)
- [정량 지표](#정량-지표)
- [구현 범위](#구현-범위)
- [프로젝트 구조](#프로젝트-구조)
- [실행 방법](#실행-방법)
- [권한과 동작 범위](#권한과-동작-범위)
- [알려진 한계](#알려진-한계)

---

## 프로젝트 소개

Open_Translator는 YouTube 영상의 자막을 감지하고, 현재 재생 중인 자막 문장을 로컬 OpenAI 호환 프록시로 번역한 뒤 영상 플레이어 위에 자연스럽게 표시하는 Chrome 확장 프로그램입니다.

일반적인 번역 확장처럼 페이지 전체를 번역하는 방식이 아니라, **YouTube 플레이어의 자막 트랙과 재생 시간을 기준으로 현재 필요한 자막만 번역**하는 데 초점을 맞췄습니다. 번역 결과는 기존 YouTube 자막 위치에 맞춰 오버레이되며, 다음 자막을 미리 번역해 시청 중 지연을 줄이도록 설계했습니다.

이 프로젝트는 특히 다음 흐름을 하나의 확장 프로그램 안에서 안정적으로 연결하는 데 집중했습니다.

- YouTube 페이지에서 자막 트랙 메타데이터 수집
- InnerTube, fetch/XHR hook, timedtext 직접 요청을 조합한 자막 본문 확보
- JSON3/XML 자막 포맷 파싱
- 현재 재생 시간에 맞는 cue 선택
- 로컬 `openai-oauth` 프록시를 통한 번역 요청
- 플레이어 UI 안에서 켜기/끄기, 에러 표시, 옵션 페이지 진입
- 모델, 프롬프트, 번역 언어, 오버레이 표시 방식 사용자 설정

---

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| **YouTube 자막 감지** | YouTube 영상/Shorts 페이지에서 자막 트랙과 영상 ID를 감지합니다. |
| **다중 자막 수집 전략** | InnerTube 요청, YouTube 플레이어 fetch/XHR hook, timedtext fallback을 순서대로 사용합니다. |
| **실시간 번역 표시** | 현재 재생 시간에 해당하는 자막을 번역해 플레이어 위에 표시합니다. |
| **선번역 큐** | 현재 cue 이후의 자막을 미리 번역해 재생 중 지연을 줄입니다. |
| **번역 캐시** | 같은 모델, 언어, 프롬프트, 원문 조합은 캐시해 중복 요청을 줄입니다. |
| **빠른 토글 버튼** | YouTube 플레이어 컨트롤 영역에 `AI` 버튼을 추가해 즉시 켜고 끌 수 있습니다. |
| **팝업 설정** | 확장 팝업에서 번역 활성화, 모델, 번역 언어, 원문 표시, 위치를 빠르게 변경합니다. |
| **옵션 페이지** | 프롬프트 템플릿, 타임아웃, 디바운스, 글자 수 제한 등 세부 설정을 제공합니다. |

---

## 시스템 아키텍처

```text
┌────────────────────────────────────────────────────────────┐
│                      YouTube Page                          │
│                                                            │
│  ytInitialPlayerResponse / fetch / XHR / timedtext          │
└──────────────────────────────┬─────────────────────────────┘
                               │ page-world hook
                               ▼
┌────────────────────────────────────────────────────────────┐
│                 youtube-hook.js (MAIN world)               │
│                                                            │
│  - YouTube 자막 트랙 추출                                  │
│  - timedtext 응답 감지                                     │
│  - window.postMessage로 content script에 전달              │
└──────────────────────────────┬─────────────────────────────┘
                               │ bridge message
                               ▼
┌────────────────────────────────────────────────────────────┐
│                 YouTube Content UI (React)                 │
│                                                            │
│  - 자막 트랙 선택                                          │
│  - cue 파싱 및 현재 재생 시간 매칭                         │
│  - 선번역 큐 관리                                          │
│  - 플레이어 오버레이 렌더링                                │
└──────────────────────────────┬─────────────────────────────┘
                               │ browser.runtime message
                               ▼
┌────────────────────────────────────────────────────────────┐
│              Background Service Worker (MV3)               │
│                                                            │
│  - 설정 로드                                               │
│  - 프롬프트 렌더링                                         │
│  - 번역 캐시 관리                                          │
│  - 로컬 프록시로 chat/completions 요청                     │
└──────────────────────────────┬─────────────────────────────┘
                               │ HTTP
                               ▼
┌────────────────────────────────────────────────────────────┐
│        openai-oauth local proxy : 127.0.0.1:10531           │
│                                                            │
│  OpenAI-compatible /v1/chat/completions, /v1/models         │
└────────────────────────────────────────────────────────────┘
```

---

## 기술 스택 & 선택 이유

| 기술 | 선택 이유 |
| --- | --- |
| **Chrome Extensions MV3** | YouTube 페이지 위에서 동작하는 브라우저 확장 프로그램 형태가 가장 자연스러웠습니다. 백그라운드 로직은 service worker로 분리하고, 실제 DOM/플레이어 조작은 content script에서 담당하도록 구성했습니다. |
| **WXT** | MV3 확장의 entrypoint, manifest, build output을 일관되게 관리하기 위해 사용했습니다. React 모듈과 TypeScript 환경을 빠르게 묶을 수 있고, Chrome/Firefox 빌드 확장도 쉽습니다. |
| **React** | 팝업, 옵션 페이지, YouTube 오버레이처럼 상태 변화가 잦은 UI를 컴포넌트 단위로 관리하기 위해 사용했습니다. |
| **TypeScript** | background, content script, page bridge, options가 메시지를 주고받기 때문에 런타임 메시지 계약과 설정 타입을 명확히 유지하는 것이 중요했습니다. |
| **YouTube InnerTube / timedtext** | YouTube 자막 데이터가 DOM에만 안정적으로 남아 있지 않기 때문에, 트랙 메타데이터와 자막 본문을 별도로 수집하는 구조가 필요했습니다. |
| **openai-oauth** | 로컬에서 OpenAI 호환 `/v1` 프록시를 실행해 확장 프로그램이 표준 chat completions 형태로 번역 요청을 보낼 수 있게 했습니다. |

---

## 핵심 기능 상세

### 1. YouTube 자막 트랙 수집

<details>
<summary><b>기술 상세 펼치기</b></summary>

YouTube는 SPA 구조라 페이지 이동이 발생해도 전체 페이지가 새로고침되지 않습니다. 그래서 확장 프로그램은 `document_start` 시점에 page-world hook을 먼저 주입하고, 이후 YouTube 내부 상태와 네트워크 응답을 함께 감시합니다.

흐름은 다음과 같습니다.

```text
content script가 document_start에 youtube-hook.js 삽입
   ↓
youtube-hook.js가 MAIN world에서 실행
   ↓
ytInitialPlayerResponse에서 captionTracks 추출
   ↓
fetch / XHR 요청 중 timedtext 응답 감지
   ↓
window.postMessage로 content script에 전달
```

WXT의 content script wrapper는 비동기 IIFE로 감싸질 수 있어, YouTube의 초기 요청보다 늦게 실행될 가능성이 있습니다. 이를 피하기 위해 `youtube-injector.content.ts`가 동기 `<script>` 태그로 `youtube-hook.js`를 먼저 주입합니다.

</details>

### 2. 자막 파싱과 현재 구간 매칭

<details>
<summary><b>기술 상세 펼치기</b></summary>

자막 본문은 상황에 따라 JSON3 또는 XML 계열 포맷으로 내려올 수 있습니다. 이 프로젝트는 두 포맷을 모두 파싱해 공통 cue 구조로 변환합니다.

```ts
interface CaptionCue {
  start: number;
  end: number;
  text: string;
}
```

현재 표시할 자막은 영상의 `currentTime`과 cue의 `start`, `end`를 비교해 선택합니다. 이전 cue index를 기억해 인접 cue 전환을 먼저 확인하고, 필요할 때만 이진 탐색으로 현재 위치를 찾습니다.

지원하는 자막 수집 전략:

1. InnerTube Android client 기반 caption track 요청
2. YouTube 플레이어가 직접 요청한 timedtext 응답 hook
3. `fmt=json3`, `srv3`, `srv1`, 기본 포맷 순서의 직접 요청 fallback

</details>

### 3. 로컬 프록시 기반 번역 요청

<details>
<summary><b>기술 상세 펼치기</b></summary>

번역 요청은 content script가 직접 보내지 않고 background service worker가 담당합니다. 이렇게 분리한 이유는 설정 로드, 프롬프트 렌더링, 캐시 관리, 에러 응답 정규화를 한 계층에 모으기 위해서입니다.

```text
Content UI
   ↓ subtitle:translate message
Background
   ↓ settings load + prompt render + cache lookup
Local Proxy
   ↓ /v1/chat/completions
Background
   ↓ normalized response
Content UI overlay
```

프롬프트 템플릿은 다음 치환자를 지원합니다.

```text
{{targetLanguage}}
{{sourceLanguage}}
{{pageUrl}}
{{text}}
```

같은 자막을 반복 요청하지 않도록 모델, 대상 언어, 프롬프트, 원문을 조합한 cache key를 만들고, 최대 120개까지 번역 결과를 보관합니다.

</details>

### 4. 플레이어 오버레이와 빠른 설정

<details>
<summary><b>기술 상세 펼치기</b></summary>

YouTube 플레이어의 오른쪽 컨트롤 영역에 `AI` 버튼을 추가합니다. 이 버튼은 확장 기능을 빠르게 켜고 끄는 진입점이며, 우클릭으로 옵션 페이지를 열 수 있습니다.

오버레이는 가능한 경우 YouTube 원본 자막 박스의 위치와 폭을 따라갑니다.

```text
YouTube native caption rect 측정
   ↓
번역 자막 오버레이 위치 계산
   ↓
원본 자막은 투명 처리
   ↓
번역문 + 선택적으로 원문 표시
```

자막 rect를 찾지 못하는 상황에서는 설정된 위치(`top` 또는 `bottom`)에 fallback으로 표시합니다.

</details>

### 5. 옵션 페이지와 사용자 설정

<details>
<summary><b>기술 상세 펼치기</b></summary>

설정은 `browser.storage.sync`에 저장합니다. 팝업과 옵션 페이지, YouTube content UI가 같은 설정을 바라보며, storage change 이벤트를 통해 변경 사항을 즉시 반영합니다.

주요 설정:

- 번역 활성화 여부
- 번역 대상 언어
- 사용할 모델
- 프롬프트 템플릿
- 요청 타임아웃
- 자막 변경 디바운스
- 원문 자막 함께 표시
- 오버레이 위치
- 요청당 최대 글자 수

로컬 프록시가 `/v1/models`를 지원하면 사용 가능한 모델 목록을 읽고, 실패하면 기본 모델 목록을 보여줍니다.

</details>

---

## 연동 프로젝트

| 프로젝트 | 용도 | 링크 |
| --- | --- | --- |
| **openai-oauth** | 로컬 OpenAI 호환 프록시 실행 | [GitHub](https://github.com/EvanZhouDev/openai-oauth) · [npm](https://www.npmjs.com/package/openai-oauth) |
| **WXT** | Chrome MV3 확장 개발 프레임워크 | [GitHub](https://github.com/wxt-dev/wxt) · [Docs](https://wxt.dev) |
| **React** | 팝업, 옵션 페이지, 오버레이 UI | [GitHub](https://github.com/facebook/react) |
| **TypeScript** | 확장 내부 메시지와 설정 타입 관리 | [GitHub](https://github.com/microsoft/TypeScript) |

`openai-oauth`는 이 프로젝트의 소스에 포함된 라이브러리가 아니라, 사용자가 로컬에서 실행하는 별도 프록시 도구입니다. 확장 프로그램은 이 프록시가 제공하는 OpenAI 호환 `/v1/chat/completions`와 `/v1/models` 엔드포인트를 사용합니다.

---

## 어려웠던 점과 해결

### 1. YouTube 초기 자막 요청을 놓치지 않는 문제

YouTube는 페이지 로딩 초기에 자막 관련 요청을 빠르게 수행합니다. 일반적인 content script 흐름만 사용하면 hook 설치 시점이 늦어져 timedtext 응답을 놓칠 수 있었습니다.

이를 해결하기 위해 ISOLATED world content script는 최소한의 역할만 맡고, 실제 fetch/XHR hook은 `youtube-hook.js`를 page-world에 동기 주입하는 방식으로 분리했습니다. 덕분에 YouTube 번들 실행보다 앞선 시점에 네트워크 hook을 설치할 수 있습니다.

### 2. 자막 데이터 확보 경로가 영상마다 달라지는 문제

일부 영상은 기본 timedtext 직접 요청으로 충분하지만, 일부 영상은 서명이나 클라이언트 조건에 따라 빈 응답이 내려올 수 있습니다. 단일 경로에만 의존하면 영상별 실패율이 높아집니다.

이 문제는 자막 수집 전략을 3단계 fallback으로 나누어 해결했습니다.

- InnerTube Android client로 caption track 요청
- YouTube 플레이어가 이미 받은 timedtext 응답 재사용
- 직접 timedtext 요청을 여러 포맷으로 시도

### 3. 번역 지연을 줄이는 문제

현재 자막이 화면에 나온 뒤에야 번역을 요청하면, 짧은 문장이라도 시청 중 지연이 체감됩니다.

그래서 현재 cue를 번역하는 동시에 다음 cue들을 큐에 넣고, 최대 3개까지 병렬로 선번역합니다. 영상 시작 직후에는 초기 cue 8개를 먼저 예열하고, 재생 중에는 현재 위치 이후 10개 cue를 미리 준비합니다.

### 4. YouTube 원본 자막과 번역 오버레이 정렬

단순히 화면 하단 고정 위치에 번역문을 띄우면 YouTube 기본 자막과 겹치거나, 전체화면/극장 모드에서 위치가 어색해집니다.

이를 줄이기 위해 원본 caption window의 bounding rect를 주기적으로 측정하고, 번역 오버레이가 해당 위치와 폭을 따라가도록 구현했습니다. 번역문이 준비된 경우 원본 자막은 투명 처리해 같은 위치에 번역 자막이 자연스럽게 보이도록 했습니다.

---

## 정량 지표

로컬 개발 환경 기준으로 확인한 수치입니다.

| 항목 | 수치 | 설명 |
| --- | --- | --- |
| **지원 페이지** | 2종 | YouTube watch, Shorts |
| **자막 수집 전략** | 3단계 | InnerTube, intercepted timedtext, direct timedtext fallback |
| **지원 자막 포맷** | 2종 | JSON3, XML timedtext |
| **초기 선번역 cue** | 8개 | 영상 시작 지연 완화 |
| **재생 중 선번역 범위** | 다음 10개 | 현재 cue 이후 미리 번역 |
| **선번역 동시 처리** | 3개 | 번역 요청 병렬 처리 제한 |
| **번역 캐시 한도** | 120개 | background service worker 메모리 캐시 |
| **기본 요청 타임아웃** | 30초 | 설정에서 변경 가능 |
| **기본 요청 글자 수 제한** | 160자 | 자막 단위 요청 비용과 지연 완화 |
| **Chrome MV3 빌드 크기** | 약 468.8 KB | `npm run build` 기준 WXT output total |

---

## 구현 범위

| 영역 | 구현 내용 |
| --- | --- |
| **Background** | 메시지 검증, 설정 로드, 프롬프트 렌더링, 번역 캐시, 로컬 프록시 요청 |
| **YouTube Hook** | page-world fetch/XHR hook, caption track 추출, SPA navigation 대응 |
| **Content UI** | cue 로딩, 현재 재생 시간 매칭, 선번역 큐, 플레이어 오버레이 |
| **Popup** | 빠른 활성화 토글, 모델 선택, 번역 언어 변경, 옵션 페이지 이동 |
| **Options** | 모델, 프롬프트, 타임아웃, 디바운스, 오버레이, 글자 수 제한 설정 |
| **Proxy Scripts** | Windows에서 `openai-oauth` 프록시 시작/중지 보조 스크립트 |
| **Build** | WXT 기반 Chrome MV3 빌드와 `dist/` 동기화 |

---

## 프로젝트 구조

```text
Open_Translator/
├── entrypoints/
│   ├── background.ts                    # MV3 service worker
│   ├── youtube-hook.ts                  # page-world YouTube hook
│   ├── youtube-injector.content.ts      # hook 동기 주입용 content script
│   ├── youtube.content/
│   │   ├── App.tsx                      # YouTube 오버레이 UI
│   │   ├── captions.ts                  # caption cue 파싱/선택
│   │   ├── innertube.ts                 # InnerTube caption fallback
│   │   ├── pageBridge.ts                # page-world와 content script bridge
│   │   ├── index.tsx                    # content UI mount
│   │   └── style.css
│   ├── popup/
│   │   ├── App.tsx
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── style.css
│   └── options/
│       ├── App.tsx
│       ├── index.html
│       ├── main.tsx
│       └── style.css
├── lib/
│   ├── messages.ts                      # background message contract
│   ├── openai.ts                        # local proxy request helper
│   ├── proxy-models.ts                  # /v1/models 조회
│   └── settings.ts                      # synced settings
├── public/
│   └── icon/                            # extension icons
├── scripts/
│   ├── sync-dist.mjs                    # WXT output을 dist로 동기화
│   ├── start-openai-oauth-hidden.ps1
│   └── stop-openai-oauth.ps1
├── proxy-setup.bat                      # Windows 프록시 설정 도구
├── start-proxy-hidden.bat
├── stop-proxy.bat
├── wxt.config.ts
├── package.json
└── README.md
```

---

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

Windows PowerShell에서 `npm` 실행 정책 문제가 생기면 `npm.cmd`를 사용할 수 있습니다.

```powershell
npm.cmd install
```

### 2. 로컬 프록시 실행

확장은 `openai-oauth`가 제공하는 로컬 OpenAI 호환 프록시와 통신합니다.

```bash
npx openai-oauth
```

Windows에서 백그라운드 실행 스크립트를 사용할 수도 있습니다.

```bash
npm run proxy:start
```

중지:

```bash
npm run proxy:stop
```

### 3. 개발 실행

```bash
npm run dev
```

Firefox 대상 개발 실행:

```bash
npm run dev:firefox
```

### 4. 타입 검사

```bash
npm run compile
```

### 5. 확장 프로그램 빌드

```bash
npm run build
```

빌드 결과는 Chrome에서 바로 로드할 수 있도록 `dist/` 폴더에 생성됩니다.

### 6. Chrome에 로드

```text
chrome://extensions
→ Developer mode ON
→ Load unpacked
→ 이 저장소의 dist 폴더 선택
```

이후 YouTube 영상에서 자막을 켠 뒤 확장 프로그램의 `AI` 버튼 또는 팝업으로 번역 기능을 사용할 수 있습니다.

---

## 권한과 동작 범위

| 권한/범위 | 사용 목적 |
| --- | --- |
| `storage` | 사용자 설정 저장 |
| `http://127.0.0.1/*` | 로컬 OpenAI 호환 프록시 호출 |
| `https://www.youtube.com/watch*` | YouTube 영상 페이지 content script 실행 |
| `https://www.youtube.com/shorts/*` | YouTube Shorts 페이지 content script 실행 |
| `web_accessible_resources` | page-world hook 스크립트 주입 |

---

## 알려진 한계

- YouTube의 내부 API와 DOM 구조 변화에 영향을 받을 수 있습니다.
- 라이브 영상은 일반 VOD와 자막 처리 방식이 달라 일부 기능이 제한될 수 있습니다.
- 자막 트랙이 없는 영상은 번역 오버레이를 표시할 수 없습니다.
- 자동 생성 자막은 원본 인식 품질에 따라 번역 품질도 함께 달라집니다.
- 로컬 프록시가 실행 중이지 않으면 번역 요청이 실패합니다.
- 모델 응답 속도와 네트워크 상태에 따라 자막 표시 지연이 발생할 수 있습니다.

---

<div align="center">

**Open_Translator** · Chrome MV3 YouTube subtitle translation project

</div>
