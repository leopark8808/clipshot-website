// B-9: ClipShot 앱 피드백·오류 로그 수신 엔드포인트 (Cloudflare Pages Function).
// POST https://clipshot-website.pages.dev/api/feedback
//
// 수신 형식(JSON, 앱 src-tauri commands/feedback.rs 와 동기):
//   { kind: "feedback"|"panic", version, arch, locale, message?,
//     files?: [{ name, orig_size, gzip_base64 }] }
// 저장: R2 버킷(바인딩 이름 FEEDBACK)에 feedback/<UTC시각>_<uuid8>.json 으로 원문 보관.
//
// ⚠ 1회 설정(대시보드): R2 버킷 생성(예: clipshot-feedback) → Pages 프로젝트
//   Settings > Functions > R2 bucket bindings 에 변수명 FEEDBACK 으로 연결 → 재배포.
//   바인딩 없이 호출되면 500("storage not configured")을 돌려준다.
//
// 남용 가드: 본문 10MB 상한 + JSON 형식 검증. (개인 도구 트래픽 규모라 rate limit 은
// 보류 — 문제가 생기면 Cloudflare WAF rule 또는 KV 카운터 추가.)

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
  FEEDBACK: R2Bucket;
}

const MAX_BODY = 10 * 1024 * 1024; // 10MB — 로그 gzip(5MB 로테이션 원문) 대비 넉넉

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.FEEDBACK) {
    return new Response("storage not configured", { status: 500 });
  }
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) {
    return new Response("payload too large", { status: 413 });
  }
  let body: FeedbackBody;
  try {
    body = await request.json<FeedbackBody>();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (
    typeof body?.version !== "string" ||
    typeof body?.kind !== "string" ||
    body.version.length > 32 ||
    (body.files && !Array.isArray(body.files))
  ) {
    return new Response("invalid payload", { status: 400 });
  }

  // 키 = 도착 시각 + 무작위 8자 (정렬 가능 + 충돌 없음). 예: feedback/2026-06-11T01-23-45Z_ab12cd34.json
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${ts}_${crypto.randomUUID().slice(0, 8)}`;
  await env.FEEDBACK.put(`feedback/${id}.json`, JSON.stringify(body), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { kind: body.kind, version: body.version },
  });
  return Response.json({ ok: true, id });
};
