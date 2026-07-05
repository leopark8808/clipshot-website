# ClipShot 공식 웹사이트

ClipShot(화면 캡처 도구)의 공식 랜딩/마케팅 웹사이트. 앱 본체(비공개 repo)와 분리된 **공개 정적 사이트**다.

- **앱 다운로드**: 주 배포는 [Microsoft Store](https://apps.microsoft.com/detail/9PPDRC62BRP4)(신뢰·서명·자동 업데이트는 Store가 담당). 더불어 지인 배포용 **미서명 `.exe` 직접 다운로드** 보조 채널을 제공한다(`/downloads/`).
- **배포**: Cloudflare Pages — 라이브 도메인 **`clipshot-website.pages.dev`** (main 에 push 하면 자동 배포). `clipshot-6mr.pages.dev` 는 과거 오기로, 사용하지 않는다.
- **스택**: 빌드 도구 없는 정적 HTML/CSS (한국어 `/` · 영어 `/en/`). 단, 피드백 수신은 Cloudflare Pages Functions(`functions/`) 사용.

## 구조

```
index.html             # 한국어 메인 (기본)
en/index.html          # 영어 메인
privacy.html           # 한국어 개인정보 처리방침
en/privacy.html        # 영어 개인정보 처리방침
styles.css             # 공용 스타일 (.doc = 문서 페이지 레이아웃 포함)
assets/                # 로고·워드마크·favicon·OG 이미지
downloads/             # 미서명 .exe 설치본 (보조 배포 채널)
updater/               # exe 채널 자동 업데이트용 latest.json·서명(.sig)
functions/api/feedback.ts   # 인앱 피드백/진단 로그 수신 엔드포인트 (Workers KV 저장)
version.json           # ← 버전 단일 소스 (아래)
sitemap.xml · robots.txt · _headers
```

## 다운로드 UI 구조 (2026-07-05)

다운로드 버튼은 **히어로 + 다운로드 섹션 두 곳**에 있다(ko/en 동일). OS·기기별 노출은 각 페이지 인라인 스크립트의 UA 감지가 담당한다:

- **OS 분기**: `.os-win` / `.os-mac` 블록을 UA로 토글(반대 OS는 다운로드 섹션의 전환 버튼으로 접근).
- **모바일 처리**: Android/iPhone/iPad UA 또는 "Mac UA + 멀티터치"(최신 아이패드)면 `<html>`에 `is-mobile` 클래스 부여 →
  - `.pc-only` 요소 숨김 = 직접 다운로드 exe 버튼·SmartScreen 경고 안내, macOS dmg 버튼·터미널 설치 가이드 (Store 버튼은 모바일에도 노출)
  - `.mobile-only` 요소 노출 = "ClipShot은 PC 전용 앱" 라운드 배지 안내(히어로·다운로드 섹션 각 1곳)
- **유지보수 규칙**: 설치 파일 다운로드 버튼·설치 안내를 새로 추가하면 `pc-only` 클래스를 같이 달아야 모바일에서 숨겨진다. exe 버전업 시 직접다운로드 href 는 **히어로+다운로드 섹션 × ko/en = 4곳** 전부 갱신(`grep -r "x64-setup.exe" index.html en/index.html`).

## 버전 갱신

푸터의 버전 표기는 런타임에 `/version.json`을 fetch 해 자동 반영된다(각 페이지 인라인 스크립트). 앱이 새 버전으로 Store 에 게시되면 **두 곳**을 같은 버전으로 갱신한다:

1. `version.json` 의 `version` — 실제 표시 소스
2. `index.html`·`en/index.html` 의 `<span id="appVersion">` 초기값 — 폴백(fetch 실패·첫 페인트 대비). 2026-06-06 정룡 방침으로 출시마다 함께 동기화.

```json
{ "version": "1.0.1" }
```

> 참고: MS Store는 공개 버전 API가 없어 완전 무인 동기화는 어렵다. 실제 표시는 `version.json` 한 곳이 구동하고, 폴백 초기값만 출시 때 함께 맞춘다.
> 개인정보 처리방침 페이지(`privacy.html`·`en/privacy.html`)는 폴백 초기값 없이 fetch 로만 버전을 채우므로 **유지보수 대상이 아니다**(위 2곳만 맞추면 됨).

## 개인정보 처리방침 · 피드백 엔드포인트

- **개인정보 처리방침**(`privacy.html`·`en/privacy.html`): 자체 호스팅. 핵심 = 캡처·녹화·보관함은 모두 로컬 저장, 계정/추적/자동 전송 없음, 진단 정보는 사용자가 직접 전송에 동의한 경우에만 전송. 메인/푸터에서 `/privacy` 로 링크(과거 Notion 외부 링크에서 전환).
- **피드백 엔드포인트**(`functions/api/feedback.ts`): 앱의 "피드백 보내기"/크래시 보고가 POST 하는 곳. 받은 진단 제출물(버전·OS·언어·의견·마스킹된 로그)은 Cloudflare **Workers KV** 에 저장하며 `expirationTtl` 로 **90일 후 자동 삭제**한다. 크기·종류 검증(fail-closed) 적용. 방침의 보관 관련 문구는 이 동작과 일치해야 한다.

> Cloudflare Pages 는 `.html` 을 clean URL(`/privacy`)로 308 리다이렉트한다(정상). curl 검증 시 `-L` 로 리다이렉트를 따라가야 본문이 보인다.
