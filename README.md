# ClipShot 공식 웹사이트

ClipShot(화면 캡처 도구)의 공식 랜딩/마케팅 웹사이트. 앱 본체(비공개 repo)와 분리된 **공개 정적 사이트**다.

- **앱 다운로드**: [Microsoft Store](https://apps.microsoft.com/detail/9PPDRC62BRP4) (Store 단독 배포 — 신뢰·서명·자동 업데이트는 Store가 담당. 자체 .exe 직접배포는 안 함)
- **배포**: Cloudflare Pages (`clipshot-6mr.pages.dev`)
- **스택**: 빌드 도구 없는 정적 HTML/CSS (한국어 `/` · 영어 `/en/`)

## 구조

```
index.html        # 한국어 (기본)
en/index.html     # 영어
styles.css        # 공용 스타일
assets/           # 로고·워드마크·favicon·OG 이미지
version.json      # ← 버전 단일 소스 (아래)
```

## 버전 갱신

푸터의 버전 표기는 런타임에 `/version.json`을 fetch 해 ko/en 양쪽에 자동 반영된다(각 페이지 인라인 스크립트). 앱이 새 버전으로 Store 에 게시되면 **두 곳**을 같은 버전으로 갱신한다:

1. `version.json` 의 `version` — 실제 표시 소스
2. `index.html`·`en/index.html` 의 `<span id="appVersion">` 초기값 — 폴백(fetch 실패·첫 페인트 대비). 2026-06-06 정룡 방침으로 출시마다 함께 동기화.

```json
{ "version": "1.0.1" }
```

> 참고: MS Store는 공개 버전 API가 없어 완전 무인 동기화는 어렵다. 실제 표시는 `version.json` 한 곳이 구동하고, 폴백 초기값만 출시 때 함께 맞춘다.
