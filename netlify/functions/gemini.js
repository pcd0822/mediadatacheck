/**
 * Netlify Function: Gemini 프록시 (VAPM v3.0 지원)
 *
 * 두 가지 모드 지원:
 *  - mode: "map"      → 체크리스트 항목 → 5대 검증 행동(V1~V5) 자동 분류
 *  - mode: "evaluate" → 미디어 자료 → 5대 검증 행동 1~5점 평가 (단일 호출에서 5개 결과)
 *
 * GEMINI_API_KEY는 서버에서만 사용 (클라이언트 미노출).
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const VERIFICATION_GUIDE = `
[VAPM v3.0 — 5대 검증 행동]
V1 출처 확인 (Source Check):
   매체 도메인의 정확성(타이포스쿼팅 여부), 매체 운영 이력·평판, "회사 소개"·연락처의
   충실성, 알려진 신뢰 매체 위장 여부, HTTPS·디자인 품질·광고 비율 등 매체 자체의 진위.

V2 저자 확인 (Author Check):
   작성자명·이력·소속의 검증 가능성, 이전 글들의 일관성, 봇/자동화 계정 신호
   (비정상 게시 빈도, 새벽 시간대 일관 활동, 동일 문구 반복, 프로필 부실), 이해관계 공개.

V3 콘텐츠 교차 확인 (Content Cross-check):
   주요 일간지·방송, 공공기관, NGO·연구기관 보도와의 일치, 인용 통계의 원자료 추적,
   단일 출처 의존 여부, 사실 진술과 의견 진술의 구분.

V4 이미지·영상 확인 (Visual Verification):
   본문에 포함되거나 인용된 시각 자료(사진·영상·그래프·차트·스크린샷)의 출처·맥락 정합성,
   다른 사건 이미지의 재사용 여부, 딥페이크·AI 생성 신호(어색한 손가락, 깨진 글자, 입모양·
   그림자 불일치). 본문에 시각 자료 언급이 전혀 없으면 score를 null로 두고 skipped: true.

V5 감정 반응 점검 (Emotional Reaction Check):
   자극적 어휘 빈도(충격·경악·비밀·절대 등), 클릭베이트 헤드라인, 분노·공포·혐오 유발,
   사실보다 감정 호소 우선 여부, 즉각 공유·반응 유도 문구. 메타인지: 독자가 강한 감정을
   느끼도록 유도되는 정도.
`.trim();

/* ===================== 매핑 모드 ===================== */

function buildMapPrompt(items) {
  const list = items
    .map((it, idx) => `${idx}. ${it.question || "(빈 항목)"}`)
    .join("\n");
  return `당신은 미디어 리터러시 전문가입니다.
다음 팩트체킹 질문들을 5대 검증 행동(VAPM v3.0의 V1~V5) 중 가장 적합한 단일 행동으로 분류하세요.

${VERIFICATION_GUIDE}

[질문 목록]
${list}

규칙:
- 각 질문에 가장 적합한 검증 행동 1개만 부여한다.
- 어디에도 명확히 속하지 않으면 "V6" (사용자 정의)로 분류한다.
- confidence는 0~1 사이 실수.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"mappings":[{"index":0,"verification":"V3","confidence":0.87,"reason":"..."}, ...]}`;
}

/* ===================== 평가 모드 ===================== */

function buildEvaluatePrompt(media, { hasImage }) {
  const v4Rule = hasImage
    ? `- V4(이미지·영상 확인): 첨부된 이미지를 직접 분석하라. 이미지의 출처·맥락 정합성,
    다른 사건 이미지의 재사용 흔적, 딥페이크·AI 생성 신호(어색한 손가락, 깨진 글자,
    입모양·그림자 불일치 등)를 종합해 1~5점 정수로 평가한다. **이미지가 첨부되어 있으므로
    절대 skipped 처리하지 말고 반드시 1~5점 정수 점수를 부여한다.** 이미지에서 발견한
    구체적인 단서를 reason에 1~2문장으로 적는다.`
    : `- V4(이미지·영상 확인): 본문에 시각 자료 언급이 전혀 없을 때에 한해
    score를 null, skipped를 true로 표시하고 reason에 "본문에 시각 자료 언급 없음"으로 적는다.
    본문에 사진·영상·그래프·차트·스크린샷 인용이 조금이라도 언급되면 일반 점수를 부여한다.`;
  return `당신은 미디어 리터러시 보조 AI입니다.
다음 미디어 자료를 5대 검증 행동(VAPM v3.0의 V1~V5) 각각에 대해 1~5점 정수로 평가하세요.
각 행동의 평가 근거를 1~2문장 한국어로 작성합니다.

${VERIFICATION_GUIDE}

[미디어 자료]
제목: ${media.title || "(제목 없음)"}
링크: ${media.link || "(없음)"}
첨부 이미지: ${hasImage ? "있음 (별도 파트로 전달됨)" : "없음"}
본문:
${media.content || ""}

규칙:
- 점수는 1, 2, 3, 4, 5 중 하나의 정수.
- V1~V5 5개 행동 모두 평가.
${v4Rule}
- redFlags는 발견된 위험 신호(예: "타이포스쿼팅 의심 도메인", "분노 유발 헤드라인",
  "딥페이크 의심 합성 흔적")가 있을 때만 배열로 채우고, 없으면 빈 배열을 둔다.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"verifications":{"V1":{"score":4,"reason":"...","redFlags":[]},"V2":{"score":3,"reason":"..."},"V3":{"score":5,"reason":"..."},"V4":{"score":${hasImage ? "3" : "null"},${hasImage ? "" : "\"skipped\":true,"}"reason":"..."},"V5":{"score":2,"reason":"..."}}}`;
}

/* ===================== 유틸 ===================== */

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB, storage.rules와 동일
const ALLOWED_IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i;

async function fetchImageInline(imageUrl) {
  if (!imageUrl) return null;
  const res = await fetch(imageUrl);
  if (!res.ok) {
    const err = new Error("첨부 이미지를 불러오지 못했어요.");
    err.status = 400;
    err.detail = `imageUrl fetch failed: ${res.status}`;
    throw err;
  }
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (!ALLOWED_IMAGE_MIME.test(contentType)) {
    const err = new Error(`지원하지 않는 이미지 형식: ${contentType}`);
    err.status = 400;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    const err = new Error(
      `이미지 용량 초과 (${(buf.length / 1024 / 1024).toFixed(1)}MB). 10MB 이하로 압축해주세요.`
    );
    err.status = 400;
    throw err;
  }
  return { mimeType: contentType, data: buf.toString("base64") };
}

// Gemini가 일시적으로 돌려주는 상태 코드. 재시도하면 대개 회복됨.
//  429 rate limit / 500 internal / 502 bad gateway / 503 overloaded / 504 timeout
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
// Netlify 함수 기본 timeout(10초)을 넘기지 않도록 백오프 상한을 짧게 둔다.
const MAX_BACKOFF_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 지수 백오프 + 지터. Retry-After 헤더가 있으면 그 값을 우선하되 상한으로 캡한다. */
function backoffDelay(attempt, retryAfterHeader) {
  const retryAfterSec = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, MAX_BACKOFF_MS);
  }
  const expo = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(expo + jitter, MAX_BACKOFF_MS);
}

async function callGemini(apiKey, prompt, inlineImage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const parts = [{ text: prompt }];
  if (inlineImage) {
    parts.push({
      inline_data: {
        mime_type: inlineImage.mimeType,
        data: inlineImage.data,
      },
    });
  }
  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
    } catch (networkErr) {
      // 네트워크/연결 단절 — 일시적일 수 있으니 재시도
      lastError = Object.assign(new Error("Gemini API 연결에 실패했어요."), {
        status: 503,
        detail: String(networkErr?.message ?? networkErr),
      });
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastError;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        lastError = Object.assign(new Error("Gemini API 일시 오류"), {
          status: res.status,
          detail: errText,
        });
        await sleep(backoffDelay(attempt, res.headers.get("retry-after")));
        continue;
      }
      const err = new Error(
        res.status === 429
          ? "AI 요청이 잠시 몰렸어요. 잠시 후 다시 시도해주세요."
          : "Gemini API 오류"
      );
      err.status = res.status;
      err.detail = errText;
      throw err;
    }

    const data = await res.json().catch(() => null);
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
    const parsed = extractJson(text);
    if (parsed) return parsed;

    // 빈 응답·잘림·안전 필터 등으로 파싱 실패 — 일시적인 경우가 많아 재시도
    lastError = Object.assign(new Error("Gemini 응답 파싱 실패"), {
      status: 502,
      detail: (text || JSON.stringify(data ?? {})).slice(0, 500),
    });
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt));
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error("Gemini 호출 실패");
}

const VALID_DIMS = ["V1", "V2", "V3", "V4", "V5", "V6"];
const EVAL_DIMS = ["V1", "V2", "V3", "V4", "V5"];

/**
 * 레거시 차원 코드(D1~D8: HPFM v1, C1~C6: IPFM v2)를 VAPM v3 코드로 매핑.
 * 매핑 규칙은 src/utils/hpfm.js의 LEGACY_TO_NEW와 동일.
 */
const LEGACY_TO_NEW = {
  D1: ["V1", "V2"],
  D2: ["V3"],
  D3: ["V1"],
  D4: ["V3"],
  D5: ["V5"],
  D6: ["V5"],
  D7: ["V3"],
  D8: ["V6"],
  C1: ["V5"],
  C2: ["V3"],
  C3: ["V1", "V2"],
  C4: ["V3"],
  C5: ["V1"],
  C6: ["V6"],
};

function resolveVerificationCode(raw) {
  const code = String(raw ?? "").toUpperCase().trim();
  if (VALID_DIMS.includes(code)) return [code];
  if (LEGACY_TO_NEW[code]) return LEGACY_TO_NEW[code];
  return null;
}

function normalizeMappings(parsed, items) {
  const arr = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
  const byIndex = {};
  for (const m of arr) {
    const idx = Number(m?.index);
    if (!Number.isInteger(idx)) continue;
    const rawCode = m?.verification ?? m?.dimension; // 레거시 키 호환
    const targets = resolveVerificationCode(rawCode);
    const dim = targets ? targets[0] : "V6";
    byIndex[idx] = {
      dimension: dim, // 클라이언트 기존 필드명 호환
      verification: dim,
      confidence: clamp01(Number(m?.confidence)),
      reason: typeof m?.reason === "string" ? m.reason : "",
    };
  }
  return items.map((_, i) =>
    byIndex[i] ?? {
      dimension: "V6",
      verification: "V6",
      confidence: 0,
      reason: "분류 실패",
    }
  );
}

/**
 * 평가 응답 정규화.
 * - 응답은 `verifications` 키 또는 레거시 `dimensions` 키 모두 허용.
 * - V4의 `skipped: true` 또는 `score: null`은 "이미지 없음"으로 보존(=N/A).
 *   단 hasImage=true이면 V4 skipped를 무시하고 평균 점수로 fallback (학생이 이미지를 첨부했으므로).
 * - 레거시 키(D1~D8, C1~C6)가 섞여 와도 V1~V5로 평균 변환.
 * - 모든 행동이 빈 채로 오면 throw.
 */
function normalizeEvaluation(parsed, { hasImage = false } = {}) {
  const dims = parsed?.verifications ?? parsed?.dimensions ?? {};
  const sums = {};
  const counts = {};
  const reasons = {};
  const redFlags = {};
  const skipped = {};

  for (const rawCode of Object.keys(dims)) {
    const v = dims[rawCode];
    if (!v || typeof v !== "object") continue;
    const targets = resolveVerificationCode(rawCode);
    if (!targets) continue;

    // hasImage가 true면 V4의 skipped 응답을 무시 (학생이 이미지를 첨부했으므로 평가해야 함).
    const isV4Target = targets.includes("V4");
    const rawSkipped =
      v.skipped === true || v.score === null || v.score === "null";
    const isSkipped = rawSkipped && !(isV4Target && hasImage);
    const raw = isSkipped ? null : Math.round(Number(v.score));
    const score = isSkipped
      ? null
      : Number.isFinite(raw)
      ? Math.max(1, Math.min(5, raw))
      : null;

    for (const t of targets) {
      if (!EVAL_DIMS.includes(t)) continue;
      if (score === null) {
        // skipped: 점수 없이 reason과 skipped만 기록
        if (skipped[t] === undefined) skipped[t] = isSkipped;
        if (!reasons[t] && typeof v.reason === "string" && v.reason.trim()) {
          reasons[t] = v.reason;
        }
        continue;
      }
      sums[t] = (sums[t] ?? 0) + score;
      counts[t] = (counts[t] ?? 0) + 1;
      if (!reasons[t] && typeof v.reason === "string" && v.reason.trim()) {
        reasons[t] = v.reason;
      }
      if (!redFlags[t] && Array.isArray(v.redFlags) && v.redFlags.length) {
        redFlags[t] = v.redFlags
          .filter((s) => typeof s === "string" && s.trim())
          .slice(0, 5);
      }
    }
  }

  const filledCount = EVAL_DIMS.filter((d) => counts[d]).length;
  const skippedCount = EVAL_DIMS.filter((d) => skipped[d] && !counts[d]).length;
  if (filledCount === 0 && skippedCount === 0) {
    const err = new Error("AI 평가 응답이 비어 있어요. 잠시 후 다시 시도해주세요.");
    err.status = 502;
    err.detail = JSON.stringify(parsed).slice(0, 500);
    throw err;
  }

  const out = {};
  for (const code of EVAL_DIMS) {
    if (counts[code]) {
      out[code] = {
        score: Math.round(sums[code] / counts[code]),
        reason: reasons[code] ?? "",
        redFlags: redFlags[code] ?? [],
      };
    } else if (skipped[code]) {
      // V4가 N/A인 경우 (이미지·영상 언급 없음) 점수 없이 보존
      out[code] = {
        score: null,
        skipped: true,
        reason: reasons[code] ?? "본문에 해당 검증 행동의 단서가 없어 평가에서 제외했어요.",
        redFlags: [],
      };
    } else {
      // 일부 행동만 비어있는 경우 (V4 외 다른 행동) — 평균 점수로 fallback
      const present = EVAL_DIMS.filter((d) => counts[d]).map(
        (d) => sums[d] / counts[d]
      );
      const avg = present.length
        ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
        : 3;
      out[code] = {
        score: Math.max(1, Math.min(5, avg)),
        reason: "이 행동은 자료에서 단서를 찾기 어려워 평균값을 사용했어요.",
        redFlags: [],
      };
    }
  }
  return out;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

/* ===================== 핸들러 ===================== */

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: "GEMINI_API_KEY가 설정되지 않았습니다." });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "잘못된 요청 본문" });
  }

  const mode = payload.mode || (payload.media ? "evaluate" : payload.items ? "map" : null);

  try {
    if (mode === "map") {
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length === 0) return jsonResponse(400, { error: "items가 필요합니다." });
      const parsed = await callGemini(apiKey, buildMapPrompt(items));
      return jsonResponse(200, { mappings: normalizeMappings(parsed, items) });
    }

    if (mode === "evaluate") {
      const media = payload.media;
      if (!media?.content) return jsonResponse(400, { error: "media.content가 필요합니다." });
      const inlineImage = media.imageUrl
        ? await fetchImageInline(media.imageUrl)
        : null;
      const parsed = await callGemini(
        apiKey,
        buildEvaluatePrompt(media, { hasImage: Boolean(inlineImage) }),
        inlineImage
      );
      const verifications = normalizeEvaluation(parsed, {
        hasImage: Boolean(inlineImage),
      });
      // 클라이언트 호환을 위해 dimensions 키도 함께 반환
      return jsonResponse(200, { verifications, dimensions: verifications });
    }

    return jsonResponse(400, { error: "mode는 'map' 또는 'evaluate' 중 하나여야 합니다." });
  } catch (err) {
    return jsonResponse(err.status || 500, {
      error: err.message || "서버 오류",
      detail: err.detail ?? null,
    });
  }
}
