# Product Build Checklist

이 문서는 "내 컴퓨터에서는 됐는데 실제 사용자 환경에서 깨지는" 문제를 줄이기 위한 범용 체크리스트다.
확장 프로그램, 게임, 웹앱, SaaS, AI 기능을 만들 때 놓치기 쉬운 운영/UX/보안/배포 관점을 한곳에 모았다.

사용법:

- 기획 초반에는 "이 프로젝트에 해당하는 섹션"만 훑고 위험한 의존성을 표시한다.
- 구현 중에는 기능 PR마다 "공통 체크리스트"와 해당 분야 섹션을 확인한다.
- 출시 전에는 "출시 전 필수 점검"을 그대로 QA 시나리오로 바꾼다.
- 사고가 났을 때는 "진단 정보 템플릿"으로 재현 정보를 먼저 모은다.

## Core Principle

좋은 제품은 happy path뿐 아니라 아래 상황에서도 설명 가능해야 한다.

- 처음 설치한 사람
- 느린 네트워크를 쓰는 사람
- 권한을 거부한 사람
- 오래 켜둔 사람
- 업데이트 직후의 사람
- 다른 브라우저/해상도/입력 장치를 쓰는 사람
- 로컬 포트, 보안 프로그램, 회사 VPN, 방화벽 같은 환경 차이를 가진 사람
- API가 느리거나 실패하거나 이상한 응답을 돌려받은 사람

핵심 질문:

1. 필요한 의존성이 없으면 사용자가 알 수 있는가?
2. 실패했을 때 다음 행동이 보이는가?
3. 업데이트 후 기존 데이터가 깨지지 않는가?
4. 사용자가 설명하지 못해도 내가 진단할 정보가 남는가?
5. 권한, 비용, 개인정보, 삭제 같은 위험한 행동에 안전장치가 있는가?

## Common Checklist

### First Run And Environment

- [ ] 새 PC/새 계정/새 브라우저 프로필에서 처음 설치해봤다.
- [ ] 필요한 런타임 버전이 명시되어 있다. 예: Node, Python, GPU driver, browser version.
- [ ] 외부 서비스, 로컬 서버, 포트, 권한, 인증 파일 같은 의존성을 앱이 스스로 확인한다.
- [ ] 포트는 하나만 고정하지 않고 fallback 또는 설정값을 제공한다.
- [ ] "설치 성공"과 "실제로 사용 가능"을 구분한다.
- [ ] 로컬 경로에 공백, 한글, 긴 경로가 있어도 동작한다.
- [ ] 회사 VPN, 백신, 보안 프로그램, 프록시 환경에서 실패 메시지가 읽힌다.

### State Design

- [ ] 빈 상태, 로딩 상태, 에러 상태, 권한 없음, 결과 없음, 필터 결과 없음이 따로 설계되어 있다.
- [ ] 사용자가 입력한 값은 에러 발생 후에도 유지된다.
- [ ] 저장 중, 저장됨, 저장 실패, 동기화 대기, 충돌 상태가 구분된다.
- [ ] 낙관적 UI를 쓴다면 실패 시 되돌림 전략이 있다.
- [ ] 같은 화면을 여러 탭/여러 기기에서 열었을 때 충돌을 처리한다.
- [ ] 장시간 세션, 절전 복귀, 탭 비활성화, 앱 재시작을 테스트했다.

### Error UX

- [ ] `[object Object]`, `unknown error`, `failed` 같은 에러가 사용자/개발자 화면에 그대로 나오지 않는다.
- [ ] 에러 메시지는 원인, 영향, 다음 행동을 포함한다.
- [ ] 재시도 가능한 오류와 재시도해도 소용없는 오류를 구분한다.
- [ ] 타임아웃, 네트워크 실패, 인증 만료, 권한 부족, rate limit, 서버 오류가 다른 코드로 기록된다.
- [ ] 사용자에게 보이는 메시지와 개발자용 로그를 분리한다.
- [ ] 고객 지원용 "진단 정보 복사"가 있다.

좋은 에러 메시지 예:

```text
[PROXY_PORT_BUSY] 127.0.0.1:10531 포트가 다른 프로그램에서 사용 중입니다.
10532 포트로 프록시를 다시 시작했습니다. YouTube 탭을 새로고침하세요.
```

### Data And Migration

- [ ] 모든 저장 데이터에 schema version이 있다.
- [ ] migration은 재실행해도 안전하다.
- [ ] migration 전 백업 또는 복구 경로가 있다.
- [ ] 대용량 데이터 migration은 진행률, 중단, 재시작을 고려한다.
- [ ] import/export는 스키마 버전, 실패 row, 중복 처리, 권한 검사를 포함한다.
- [ ] 삭제는 soft delete, retention, undo, 백업 중 하나 이상의 복구 전략이 있다.
- [ ] 설정과 사용자 데이터, 캐시, 임시 export payload를 분리한다.

### Observability And Diagnostics

- [ ] request id 또는 trace id가 있다.
- [ ] 로그는 구조화되어 있고, error class, latency, retry count, version, environment를 포함한다.
- [ ] 민감정보, 토큰, API key, prompt 전문, 개인정보가 기본 로그에 남지 않는다.
- [ ] 최근 실패 원인을 사용자 진단 화면에서 볼 수 있다.
- [ ] crash/error reporting은 opt-in, retention, redaction 정책을 갖는다.
- [ ] 로그가 없을 때도 최소한의 self-test 명령 또는 상태 확인 버튼이 있다.
- [ ] 백그라운드 작업, webhook, scheduled job 실패를 감지한다.

### Security And Privacy

- [ ] 최소 권한 원칙을 적용했다.
- [ ] 클라이언트 권한 검사는 편의 기능이고, 서버/백엔드에서 최종 권한 검사를 한다.
- [ ] token, session, refresh, logout, password reset token은 만료와 무효화가 있다.
- [ ] 파일 업로드는 size, type, content, storage location, malware scan 정책을 갖는다.
- [ ] destructive action은 확인, undo, audit log 중 적절한 장치를 둔다.
- [ ] 개인정보 수집 목적, 보존 기간, 삭제/내보내기 방법이 정리되어 있다.
- [ ] dependency lockfile, vulnerability scan, secret scan을 사용한다.
- [ ] CSP, CORS, CSRF, XSS, rate limit, tenant isolation을 확인한다.

### Accessibility And Input

- [ ] 키보드만으로 핵심 플로우를 완료할 수 있다.
- [ ] focus indicator와 focus order가 자연스럽다.
- [ ] 에러, 저장 완료, 진행률 같은 상태 변화가 스크린리더에 전달된다.
- [ ] 색상만으로 정보를 전달하지 않는다.
- [ ] 200% zoom, 큰 글자, 긴 텍스트, 다국어 문자열에서 UI가 깨지지 않는다.
- [ ] hover 없이 터치 환경에서도 사용할 수 있다.
- [ ] reduced motion, 고대비, 자막/대체 텍스트 같은 설정을 검토했다.

### Build And Release

- [ ] clean checkout에서 설치, 빌드, 테스트가 된다.
- [ ] 빌드 산출물과 소스 저장소 정책이 명확하다. 예: `dist`는 빌드 산출물이라 Git 제외.
- [ ] dev/staging/prod 환경이 분리되어 있다.
- [ ] 버전 번호, changelog, migration note, rollback plan이 있다.
- [ ] 릴리즈 빌드에는 debug secret, test endpoint, dev-only flag가 없다.
- [ ] 릴리즈 후 사용자가 새 버전을 실제로 받았는지 확인할 수 있다.
- [ ] 이전 버전 사용자가 새 서버/API와 호환되는지 검토했다.

## Browser Extension Checklist

브라우저 확장은 "페이지", "content script", "background/service worker", "browser vendor review"가 모두 다른 수명과 권한 모델을 가진다.

### Architecture

- [ ] Manifest V3 service worker는 언제든 종료될 수 있다고 가정한다.
- [ ] 전역 변수, 메모리 캐시, 초기화 완료 플래그에 의존하지 않는다.
- [ ] 핵심 event listener는 top-level에서 동기 등록한다.
- [ ] long-running 작업은 storage, alarm, offscreen document, native app, backend 등으로 분리한다.
- [ ] service worker에는 DOM이 없다는 전제로 설계한다.
- [ ] DevTools가 열려 있을 때와 닫혀 있을 때를 모두 테스트한다.

### Content Script And Page World

- [ ] isolated world와 page world를 구분한다.
- [ ] 페이지의 `window.fetch`, XHR, global variable을 건드려야 한다면 page-injected script 또는 `MAIN` world 전략을 명시한다.
- [ ] `postMessage`/custom event bridge는 페이지가 읽거나 조작할 수 있다는 전제로 validation한다.
- [ ] content script에서 받은 데이터는 background가 신뢰하지 않는다.
- [ ] SPA route change를 감지한다.
- [ ] 확장 reload 후 기존 탭의 `Extension context invalidated` 상황을 처리한다.

### Permissions And Review

- [ ] `activeTab`, optional permissions, optional host permissions를 우선 검토한다.
- [ ] `<all_urls>`, `tabs`, broad host permission이 꼭 필요한지 설명 가능하다.
- [ ] 설치/업데이트 permission warning을 실제 Chrome에서 확인했다.
- [ ] 원격 실행 코드를 사용하지 않는다. CDN script, remote eval, remote command loader는 심사 리스크다.
- [ ] `web_accessible_resources`는 필요한 파일과 host만 공개한다.
- [ ] extension listing의 기능 설명, privacy disclosure, 실제 권한이 일치한다.

### Storage And Messaging

- [ ] `storage.sync` quota에 맞게 작은 설정만 저장한다.
- [ ] 큰 데이터, 임시 payload, 캐시는 `storage.local`, IndexedDB, 파일, backend로 분리한다.
- [ ] 메시지는 JSON 직렬화 가능한 값으로 제한한다.
- [ ] `runtime.sendMessage`, `tabs.sendMessage`, long-lived port의 방향과 실패 처리 로직이 있다.
- [ ] background가 cold start 상태여도 메시지를 처리할 수 있다.

### Cross-Browser

- [ ] Chrome, Edge, Firefox의 manifest 차이를 빌드 단계에서 분리한다.
- [ ] `chrome.*` callback과 `browser.*` Promise 스타일을 혼용하지 않는다.
- [ ] Firefox MV3 지원 상태와 API 차이를 확인한다.
- [ ] Chrome Web Store와 Firefox Add-ons 심사 정책을 각각 확인한다.

### Extension Test Matrix

- [ ] unpacked load 후 정상 동작
- [ ] packed/store 설치 후 정상 동작
- [ ] 확장 reload 후 기존 탭 새로고침 전/후
- [ ] 브라우저 재시작 직후
- [ ] service worker idle 이후
- [ ] 권한 거부/권한 회수
- [ ] 대상 사이트 SPA navigation
- [ ] 대상 사이트 DOM 변경
- [ ] storage quota 초과
- [ ] offline/slow network

## Game Checklist

게임은 "정상 실행"보다 "계속 플레이 가능한 감각"이 중요하다.

### Time And Simulation

- [ ] 이동, 쿨다운, 도트 데미지, 카메라 보간, UI 애니메이션이 프레임레이트 독립적이다.
- [ ] 렌더 루프와 물리 루프를 구분한다.
- [ ] 일시정지, 슬로모션, 메뉴 화면에서 scaled/unscaled time을 구분한다.
- [ ] 30fps, 60fps, 144fps, 프레임 드랍 상황에서 속도가 유지된다.
- [ ] frame spike로 충돌 판정이 터널링되지 않는다.

### Input

- [ ] 액션 맵 기반으로 keyboard/mouse/gamepad/touch를 추상화했다.
- [ ] 리바인딩 저장, 중복 바인딩, reset default가 있다.
- [ ] gamepad 연결/해제, 동일 모델 패드 2개, local multiplayer pairing을 테스트했다.
- [ ] 감도, dead zone, invert axis, hold/toggle 옵션을 제공한다.
- [ ] 화면의 버튼 프롬프트가 현재 입력 장치에 맞게 바뀐다.

### Save And Recovery

- [ ] 설정, 진행 세이브, unlock, cloud save를 분리한다.
- [ ] 세이브 파일에 version이 있다.
- [ ] 저장은 temp file에 먼저 쓰고 검증 후 교체한다.
- [ ] backup slot 또는 recovery slot이 있다.
- [ ] autosave 시점이 플레이어에게 예측 가능하다.
- [ ] 업데이트 후 기존 세이브 호환성을 테스트한다.

### Resolution And UI

- [ ] 16:9, 16:10, 21:9, 4:3, Steam Deck, 모바일 safe area를 테스트한다.
- [ ] HUD, 자막, 버튼, 중요한 UI가 잘리지 않는다.
- [ ] UI anchor, layout, scaling rule이 명확하다.
- [ ] pixel art라면 integer scaling과 letterbox/pillarbox 정책을 정한다.
- [ ] 전체화면, 창모드, alt-tab, 모니터 변경, DPI scaling을 테스트한다.

### Audio And Accessibility

- [ ] Master, Music, SFX, Voice, UI volume을 분리한다.
- [ ] mute, subtitle, caption, text size, high contrast를 검토한다.
- [ ] 색상만으로 위험/희귀도/팀 구분을 하지 않는다.
- [ ] 광과민성 플래시, 화면 흔들림, motion blur를 줄이는 옵션이 있다.
- [ ] 튜토리얼은 한 번에 설명하지 않고 필요한 순간에 하나씩 안내한다.

### Performance And QA

- [ ] 평균 FPS뿐 아니라 frame time spike와 GC allocation을 본다.
- [ ] texture, audio, mesh, shader, particle의 memory budget이 있다.
- [ ] loading hitch와 shader compile hitch를 테스트한다.
- [ ] QA용 cheat/debug menu, teleport, state editor가 있다.
- [ ] crash log, replay, seed, build version으로 재현 가능성을 높인다.

## Web App And SaaS Checklist

웹앱/SaaS는 "기능"보다 "계정, 데이터, 복구, 운영"에서 늦게 터지는 일이 많다.

### UX States

- [ ] 첫 사용 empty state가 있다.
- [ ] 검색 결과 없음과 데이터 없음이 다르게 보인다.
- [ ] 권한 없음, 결제 필요, 초대 필요, 세션 만료가 다른 상태로 보인다.
- [ ] loading skeleton, partial data, retry, cancel을 지원한다.
- [ ] 폼 검증은 어떤 필드가 왜 틀렸고 어떻게 고칠지 말한다.
- [ ] 에러가 나도 사용자의 입력값을 지우지 않는다.

### Auth, Accounts, Billing

- [ ] 보호 라우트는 서버에서 권한을 검사한다.
- [ ] session idle timeout, absolute timeout, logout invalidation을 정의한다.
- [ ] password reset, email verification, invitation link는 단회성/만료가 있다.
- [ ] 계정 삭제, workspace leave, owner transfer, billing owner 변경을 처리한다.
- [ ] 결제 실패, webhook 재시도, invoice, refund, plan downgrade를 테스트한다.
- [ ] trial 종료, quota 초과, payment required 상태가 UX로 보인다.

### Data And Operations

- [ ] DB backup뿐 아니라 restore test를 했다.
- [ ] migration dry run, rollback 또는 forward-fix runbook이 있다.
- [ ] background job은 retry, dead letter, idempotency key를 가진다.
- [ ] import/export는 비동기로 처리하고 진행률과 실패 row를 제공한다.
- [ ] audit log에는 actor, target, action, timestamp, tenant, request id가 있다.
- [ ] tenant isolation 테스트가 있다.

### Offline, Slow Network, Mobile

- [ ] offline과 high latency를 구분한다.
- [ ] 네트워크가 불안정해도 저장 중 상태가 보인다.
- [ ] POST/PUT 중 중복 클릭을 막고 idempotency를 고려한다.
- [ ] stale data임을 표시한다.
- [ ] 모바일 키보드가 올라와도 입력/버튼이 가려지지 않는다.
- [ ] input type, inputmode, autocomplete이 적절하다.
- [ ] browser zoom 125%, 150%, 200%에서 깨지지 않는다.

### Launch Readiness

- [ ] production과 staging이 분리되어 있다.
- [ ] production email/SMS/webhook가 실제로 테스트되었다.
- [ ] uptime monitoring, error tracking, log drain이 설정되었다.
- [ ] analytics는 없어도 앱 기능이 동작한다.
- [ ] CSP, security headers, rate limit, dependency scan이 적용되었다.
- [ ] support contact, status page, incident process가 있다.

## AI Feature Checklist

AI 기능은 모델 호출보다 "응답이 깨졌을 때의 제품 동작"이 더 중요하다.

### Output Shape And Validation

- [ ] JSON mode만 믿지 않고 가능한 경우 structured output 또는 tool schema를 쓴다.
- [ ] runtime validator로 schema를 검증한다. 예: Zod, Pydantic, Valibot.
- [ ] `JSON.parse()` 성공과 비즈니스적으로 올바른 결과를 구분한다.
- [ ] parse failure, schema failure, semantic failure, refusal, truncation을 다른 오류로 처리한다.
- [ ] max token에 걸려 JSON이 잘리는 경우를 감지한다.
- [ ] 모델이 빈 응답, extra text, duplicate items, wrong enum을 반환해도 복구한다.

### Timeout, Cancel, Retry

- [ ] 사용자 취소가 provider request까지 전파된다.
- [ ] retry는 429, 5xx, network timeout 같은 재시도 가능한 오류에만 한다.
- [ ] exponential backoff와 jitter를 사용한다.
- [ ] 최대 재시도 횟수와 전체 deadline이 있다.
- [ ] 실패한 요청도 rate limit과 비용에 영향을 줄 수 있음을 고려한다.
- [ ] 같은 작업이 중복 실행되지 않도록 idempotency key를 둔다.

### Cost And Rate Limits

- [ ] user/org/project별 quota와 daily budget이 있다.
- [ ] 요청 전 token estimate와 요청 후 actual usage를 기록한다.
- [ ] max input length, max output tokens, chunk size를 제한한다.
- [ ] long context, repeated prompt는 caching을 검토한다.
- [ ] 모델별 RPM, TPM, RPD, concurrent request 제한을 문서화한다.
- [ ] 과금 실패 또는 quota 초과 UX가 있다.

### Prompt Injection And Tool Safety

- [ ] untrusted input, retrieved document, webpage, email, PDF, tool result를 명시적으로 구분한다.
- [ ] 프롬프트만으로 보안을 해결하려 하지 않는다.
- [ ] tool permission은 least privilege로 제한한다.
- [ ] 읽기 작업과 쓰기/삭제/메일발송/결제 같은 side effect 작업을 분리한다.
- [ ] 위험한 tool call은 human approval 또는 deterministic policy gate를 통과해야 한다.
- [ ] 모델 출력은 HTML, SQL, shell, URL, Markdown 링크 등 실행/렌더링 전에 sanitize한다.

### Privacy And Logging

- [ ] prompt/output 전문을 기본 로그에 저장하지 않는다.
- [ ] 저장이 필요하면 opt-in, redaction, retention, access control을 둔다.
- [ ] 로그에는 metadata 중심으로 남긴다. 예: model, latency, token usage, finish reason, validator result.
- [ ] vendor별 data retention과 training policy를 문서화한다.
- [ ] 민감 데이터는 provider로 보내기 전에 masking 또는 user confirmation을 검토한다.
- [ ] tenant별 데이터가 prompt context에서 섞이지 않도록 테스트한다.

### Streaming And UX

- [ ] streaming을 완성된 문자열이 아니라 이벤트 상태 머신으로 다룬다.
- [ ] partial text, tool call delta, error event, done event를 구분한다.
- [ ] streaming 중 JSON은 아직 완성되지 않았다고 가정한다.
- [ ] 중간 취소, 다시 시도, 편집 후 적용, 원본 비교 UI가 있다.
- [ ] refusal, safety block, uncertain answer, partial answer를 다르게 표시한다.
- [ ] fallback model은 비용이 아니라 capability matrix로 선택한다.

### Evals

- [ ] prompt와 model version을 eval 결과와 연결한다.
- [ ] happy path, edge case, adversarial prompt, privacy redaction, schema failure, refusal, long context, multilingual case를 포함한다.
- [ ] 배포 전후 같은 eval set으로 회귀를 확인한다.
- [ ] 실패한 실제 사용자 케이스를 regression eval로 편입한다.

## Launch Gate

출시 전 최소 기준:

- [ ] 새 환경에서 설치부터 핵심 플로우까지 완료했다.
- [ ] 권한 거부, 네트워크 실패, 인증 만료, quota 초과를 테스트했다.
- [ ] update/migration을 실제 이전 버전 데이터로 테스트했다.
- [ ] 로그/진단 정보로 최근 실패 원인을 설명할 수 있다.
- [ ] destructive action은 복구 또는 확인 단계가 있다.
- [ ] 접근성 smoke test를 했다. 키보드, zoom, contrast, screen reader status.
- [ ] rollback 또는 hotfix 계획이 있다.
- [ ] README 또는 docs에 설치, 빌드, 실행, 문제 해결 경로가 있다.

## Diagnostic Info Template

사용자에게 "안 돼요"만 들었을 때 먼저 모을 정보:

```text
App/version:
OS:
Browser/runtime:
Install method:
Last action:
Expected:
Actual:
Visible error:
Developer error code:
Network state:
Auth state:
Permission state:
Local server/port state:
Recent logs:
Repro steps:
```

확장 프로그램이면 추가:

```text
Manifest version:
Browser extension ID:
Content script injected:
Background/service worker status:
Target page URL:
Host permission granted:
Storage schema version:
```

게임이면 추가:

```text
Build version:
Platform:
Resolution/window mode:
FPS/frame time:
Input device:
Save slot/version:
Graphics preset:
Crash log/replay/seed:
```

AI 기능이면 추가:

```text
Provider/model:
Prompt version:
Schema version:
Request id:
Token usage:
Finish reason:
Validator result:
Retry count:
Fallback used:
```

## Source Notes

이 문서는 공식 문서와 커뮤니티 반복 사례를 함께 봤다. 기술 규칙과 제한은 공식 문서를 우선하고, Reddit/Hacker News/GitHub는 "자주 밟는 함정"을 찾는 보조 신호로만 사용한다.

### Browser Extensions

- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle?hl=en)
- [Chrome Manifest V3 overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage?hl=en)
- [Chrome Manifest V3 migration checklist](https://developer.chrome.com/docs/extensions/develop/migrate/checklist)
- [MDN background manifest key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Firefox Extension Workshop MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- [Extension.js MV3 troubleshooting](https://extension.js.org/docs/concepts/manifest-v3)
- [W3C WebExtensions issues](https://github.com/w3c/webextensions/issues)
- [HN Manifest V3 discussion](https://news.ycombinator.com/item?id=33064690)

### Games

- [Unity Time and frame management](https://docs.unity.cn/Manual/TimeFrameManagement.html)
- [Unity Input System](https://docs.unity.cn/Manual/com.unity.inputsystem.html)
- [Godot multiple resolutions](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html)
- [Godot audio buses](https://docs.godotengine.org/en/stable/tutorials/audio/audio_buses.html)
- [Microsoft Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/gaming/accessibility/guidelines)
- [IGDA Game Accessibility SIG Guidelines](https://igda-gasig.org/get-involved/sig-initiatives/resources-for-game-developers/sig-guidelines/)
- [Reddit gamedev overlooked systems](https://www.reddit.com/r/gamedev/comments/18e3imd)
- [HN Game Accessibility Guidelines discussion](https://news.ycombinator.com/item?id=26913554)

### Web Apps And SaaS

- [GOV.UK validation pattern](https://design-system.service.gov.uk/patterns/validation/)
- [GOV.UK error message component](https://design-system.service.gov.uk/components/error-message/)
- [GOV.UK check answers pattern](https://design-system.service.gov.uk/patterns/check-answers/)
- [USWDS accessibility documentation](https://designsystem.digital.gov/documentation/accessibility/)
- [MDN PWA caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)
- [MDN offline and background operation](https://developer.mozilla.org/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [web.dev offline fallback page](https://web.dev/articles/offline-fallback-page)
- [The Twelve-Factor App](https://12factor.net/)
- [OWASP Secure Coding Practices Checklist](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/02-checklist/)
- [OWASP Session Timeout Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/06-Session_Management_Testing/07-Testing_Session_Timeout)
- [FTC privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security)
- [HN hidden work when launching a SaaS](https://news.ycombinator.com/item?id=16360890)
- [HN web app pre-launch checklist discussion](https://news.ycombinator.com/item?id=46086132)

### AI Features

- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat)
- [OpenAI prompt injections](https://openai.com/safety/prompt-injections/)
- [OpenAI agent safety](https://platform.openai.com/docs/guides/agent-builder-safety)
- [OpenAI rate limits help](https://help.openai.com/en/articles/6891753)
- [OpenAI evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices)
- [OpenAI streaming API](https://platform.openai.com/docs/api-reference/streaming)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications)
- [Anthropic errors](https://docs.anthropic.com/en/api/errors)
- [Anthropic rate limits](https://docs.anthropic.com/en/api/rate-limits)
- [Anthropic streaming](https://docs.anthropic.com/en/docs/build-with-claude/streaming)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [Reddit LLM production checklist discussion](https://www.reddit.com/r/LLMDevs/comments/1rwfd7h/production_checklist_for_deploying_llmbased/)
