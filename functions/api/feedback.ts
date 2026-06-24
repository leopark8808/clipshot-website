// B-9: ClipShot 앱 피드백·오류 로그 수신 엔드포인트 (Cloudflare Pages Function).
// POST https://clipshot-website.pages.dev/api/feedback
//
// 수신 형식(JSON, 앱 src-tauri commands/feedback.rs 와 동기):
//   { kind: "feedback"|"panic", version, arch, locale, message?,
//     files?: [{ name, orig_size, gzip_base64 }] }
// 저장: Workers KV(바인딩 이름 FEEDBACK)에 feedback/<UTC시각>_<uuid8> 키로 원문 보관.
// ※ R2 가 아닌 KV 인 이유: R2 는 무료 한도여도 결제수단 등록을 요구 — 정룡 "결제 안 하고
//   싶어"(2026-06-11) → KV(무료 플랜 카드 불필요, 쓰기 1,000/일·키당 25MB)로 결정.
//   리포트당 ~수백KB·일 수십 건 규모라 한도 여유 큼.
//
// ⚠ 1회 설정(대시보드): Storage & databases > KV 에서 namespace 생성(예: clipshot-feedback)
//   → Pages 프로젝트 Settings 의 KV namespace bindings 에 변수명 FEEDBACK 으로 연결 → 재배포.
//   바인딩 없이 호출되면 500("storage not configured")을 돌려준다.
//
// 남용 가드: ① 본문 크기 2중 체크(Content-Length + 실제 text 길이 — 헤더 위조/청크 우회 차단)
//   ② kind 화이트리스트("feedback"|"panic") + version/message/files 길이·개수 cap(임의 블롭·메타
//   오염 차단) ③ KV expirationTtl 90일(무한 누적·스토리지 DoS 방지). 키는 서버 생성이라 키 주입 불가.
//   ⚠ 요청 빈도 제한(rate limit): 이 사이트는 커스텀 도메인 없이 *.pages.dev 단독이라 Cloudflare WAF
//   rate-limit 룰(zone 단위)을 걸 대상이 없고, Pages Functions 는 네이티브 ratelimit 바인딩도 미지원
//   (지원: KV/D1/R2/DO/Queues/Service 등). KV 카운터는 쓰기 증폭·부정확이라 회피. → 현 구성에선 위
//   cap/TTL/서버생성키 기반 fail-closed 로 수용(최악도 데이터 유출 아닌 KV 쓰기한도 일시 소진·자가회복).
//   재검토 트리거: KV 소진·피드백 스팸 관측 시 전용 rate-limit Worker(Service 바인딩)로, 또는 커스텀
//   도메인 추가 시 WAF rate-limit. (보안 점검 2026-06-20 / 재결정: C 수용)

interface FeedbackFile {
  name: string;
  orig_size: number;
  gzip_base64: string;
}

interface FeedbackBody {
  kind: string;
  version: string;
  arch?: string;
  locale?: string;
  message?: string;
  files?: FeedbackFile[];
}

interface Env {
  FEEDBACK: KVNamespace;
}

const MAX_BODY = 10 * 1024 * 1024; // 10MB — 로그 gzip(5MB 로테이션 원문) 대비 넉넉
const MAX_MESSAGE = 5000; // 피드백 자유 텍스트 상한(자)
const MAX_FILES = 4; // 앱은 ClipShot.log + panic.log 2개만 보냄 — 여유 4
const MAX_FILE_B64 = 9 * 1024 * 1024; // 파일당 gzip_base64 상한(원문 ~6.7MB)
const TTL_SECONDS = 60 * 60 * 24 * 90; // 저장 90일 후 자동 만료(무한 누적·스토리지 DoS 방지)

// ⚠ 임시 진단 핸들러(바인딩 불일치 추적용) — 검증 후 제거 예정.
//   GET /api/feedback?diag=clipdiag2026 → 런타임 env.FEEDBACK 이 실제로 보는 키 목록을 반환.
//   대시보드는 FEEDBACK→clipshot-feedback(4cdb…)인데 wrangler 로 읽으면 비어 있어,
//   런타임 바인딩이 어떤 네임스페이스를 가리키는지 같은 바인딩으로 직접 확인한다.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("diag") !== "clipdiag2026") {
    return new Response("not found", { status: 404 });
  }
  if (!env.FEEDBACK) {
    return Response.json({ bound: false });
  }
  const list = await env.FEEDBACK.list({ limit: 50 });
  return Response.json({
    bound: true,
    list_complete: list.list_complete,
    count: list.keys.length,
    keys: list.keys.map((k) => ({ name: k.name, metadata: k.metadata })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.FEEDBACK) {
    return new Response("storage not configured", { status: 500 });
  }
  // 크기 가드 2중: ① Content-Length 헤더로 빠른 거절 ② 실제 본문 길이(헤더 위조·청크
  //   전송으로 ①을 우회해도 차단). request.json() 대신 text() 로 받아 실측 후 파싱한다.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) {
    return new Response("payload too large", { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return new Response("payload too large", { status: 413 });
  }
  let body: FeedbackBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  // 검증: kind 화이트리스트 + version/message/files 길이·개수 cap(임의 블롭·메타 오염 차단).
  if (
    (body?.kind !== "feedback" && body?.kind !== "panic") ||
    typeof body?.version !== "string" ||
    body.version.length > 32
  ) {
    return new Response("invalid payload", { status: 400 });
  }
  if (
    body.message !== undefined &&
    (typeof body.message !== "string" || body.message.length > MAX_MESSAGE)
  ) {
    return new Response("invalid message", { status: 400 });
  }
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || body.files.length > MAX_FILES) {
      return new Response("invalid files", { status: 400 });
    }
    for (const f of body.files) {
      if (
        typeof f?.name !== "string" ||
        f.name.length > 64 ||
        typeof f?.gzip_base64 !== "string" ||
        f.gzip_base64.length > MAX_FILE_B64
      ) {
        return new Response("invalid file", { status: 400 });
      }
    }
  }

  // 키 = 도착 시각 + 무작위 8자 (정렬 가능 + 충돌 없음). 예: feedback/2026-06-11T01-23-45Z_ab12cd34
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${ts}_${crypto.randomUUID().slice(0, 8)}`;
  await env.FEEDBACK.put(`feedback/${id}`, JSON.stringify(body), {
    expirationTtl: TTL_SECONDS, // 90일 후 자동 만료 — 무한 누적/스토리지 DoS 방지
    metadata: { kind: body.kind, version: body.version },
  });
  return Response.json({ ok: true, id });
};
