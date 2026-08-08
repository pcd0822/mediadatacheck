/**
 * Netlify Function: Gemini 프록시 (VAPM v5.0)
 *
 * 두 가지 모드 지원:
 *  - mode: "map"      → 체크리스트 항목 → 5대 검증 행동(V1~V5) 자동 분류 (분석·표시용 라벨)
 *  - mode: "evaluate" → 미디어 자료 → **그 모둠의 체크리스트 항목마다** 1~5점 + 근거
 *                       (미디어당 단일 호출. 판단 단서가 없는 항목은 N/A + 사유)
 *
 * v4.0까지는 evaluate가 5대 검증 행동 5개에 점수를 매겼지만, v5.0에서는
 * 채점 단위가 "학생이 만든 체크리스트 항목"으로 바뀌었다.
 *
 * GEMINI_API_KEY는 서버에서만 사용 (클라이언트 미노출).
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const VERIFICATION_GUIDE = `
[5대 검증 행동 — 체크리스트 항목 분류용 라벨]
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
   그림자 불일치).

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
다음 팩트체킹 질문들을 5대 검증 행동(V1~V5) 중 가장 적합한 단일 행동으로 분류하세요.
이 분류는 점수 계산에 쓰이지 않고, 학생에게 "이 질문이 어떤 검증 행동에 해당하는지"를
보여주고 지표별 평균을 표시하기 위한 라벨입니다.

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

/* ===================== 평가 모드 (체크리스트 항목별 채점) ===================== */

/** 루브릭({1:"...",...})을 프롬프트에 넣을 한 줄 문자열로. 비어 있으면 null. */
function formatRubric(rubric) {
  if (!rubric || typeof rubric !== "object") return null;
  const lines = [];
  for (const score of [1, 2, 3, 4, 5]) {
    const text = rubric[score] ?? rubric[String(score)];
    if (typeof text === "string" && text.trim()) {
      lines.push(`${score}점 = ${text.trim()}`);
    }
  }
  return lines.length ? lines.join(" / ") : null;
}

function buildChecklistBlock(items) {
  return items
    .map((it, idx) => {
      const rubric = formatRubric(it?.rubric);
      const head = `[항목 ${idx}] ${it?.question || "(빈 질문)"}`;
      // 학생이 직접 쓴 루브릭 서술이 있으면 그대로 넣어 그 기준으로 채점하게 한다.
      return rubric ? `${head}\n    채점 기준: ${rubric}` : head;
    })
    .join("\n");
}

function buildEvaluatePrompt(media, items, { hasImage }) {
  const imageRule = hasImage
    ? `- 이미지가 별도 파트로 첨부되어 있다. 시각 자료를 묻는 항목은 그 이미지를 직접 분석해
  점수를 부여하고, 이미지에서 발견한 구체적 단서를 reason에 적는다. 이미지가 있으므로
  시각 자료 항목을 "단서 없음"으로 처리하지 않는다.`
    : `- 첨부된 이미지가 없다. 시각 자료(사진·영상·그래프)를 직접 확인해야만 답할 수 있는
  항목인데 본문에 시각 자료 언급조차 없다면 "na": true 로 처리한다.`;

  return `당신은 미디어 리터러시 수업을 돕는 보조 AI입니다.
학생들이 직접 만든 아래 체크리스트 항목을 **하나씩 순서대로** 미디어 자료에 적용해
항목마다 1~5점을 매기고 판단 근거를 한국어 1~2문장으로 쓰세요.

${VERIFICATION_GUIDE}

[미디어 자료]
표제: ${media.title || "(없음)"}
부제: ${media.subtitle || "(없음)"}
언론사: ${media.publisher || "(없음)"}
작성일: ${media.publishedAt || "(없음)"}
링크: ${media.link || "(없음)"}
첨부 이미지: ${hasImage ? "있음 (별도 파트로 전달됨)" : "없음"}
본문:
${media.content || ""}

[체크리스트 항목 — 이 목록이 유일한 채점 기준]
${buildChecklistBlock(items)}

중요 — 당신이 할 수 없는 일:
- 위에 적힌 언론사·작성일·링크·표제는 **입력된 값을 그대로 전제**하고 판단해야 한다.
  당신은 웹을 검색할 수 없으므로 그 매체가 실재하는지, 작성일이 정확한지, 링크가 살아
  있는지 확인할 수 없다.
- 따라서 "○○일보에 확인한 결과", "다른 매체와 대조해보니"처럼 **실제로 하지 않은 확인을
  했다고 쓰지 말 것.** 대신 "제시된 정보상", "본문에 드러난 범위에서"처럼 판단 근거의
  범위를 정확히 밝힌다.
- 외부 대조가 반드시 필요한 항목인데 자료 안에 단서가 없으면 점수를 추측하지 말고
  "na": true 로 처리하고, reason에 **왜 판단할 수 없었는지**를 학생이 읽고 이해할 수 있게 쓴다.

규칙:
- 체크리스트 항목 ${items.length}개 **전부**에 대해 결과를 반환한다. index는 위 항목 번호 그대로.
- 점수는 1, 2, 3, 4, 5 중 하나의 정수. 채점 기준(루브릭)이 있으면 그 서술을 그대로 따른다.
- 판단 단서가 없는 항목만 "score": null, "na": true 로 하고 그 외에는 반드시 점수를 준다.
  단서가 조금이라도 있으면 na로 빠지지 말고 점수를 부여한다.
${imageRule}
- redFlags는 그 항목에서 발견한 위험 신호(예: "타이포스쿼팅 의심 도메인", "분노 유발 헤드라인",
  "출처 없는 통계 인용")가 있을 때만 배열로 채우고, 없으면 빈 배열.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"items":[{"index":0,"score":4,"reason":"...","redFlags":[]},{"index":1,"score":null,"na":true,"reason":"이 항목은 다른 매체와 대조해야 판단할 수 있는데 자료 안에 비교할 단서가 없었어요."}]}`;
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
  const generationConfig = {
    temperature: 0.2, // 낮춰서 더 결정적·일관된 JSON 산출
    responseMimeType: "application/json",
    maxOutputTokens: 4096, // 응답을 묶어 잘림/폭주 방지(5개 행동 JSON엔 충분)
  };
  // gemini-2.5-flash 계열은 기본 'thinking'이 출력 토큰 예산을 잠식해
  // 빈 응답·잘림으로 인한 파싱 실패를 유발할 수 있다. 구조화된 채점 작업엔
  // thinking 이득이 거의 없고 지연만 늘어나(동시 호출 겹침↑) 비활성화한다.
  // (pro 계열은 thinking 비활성화를 지원하지 않으므로 손대지 않는다.)
  if (/flash/i.test(DEFAULT_MODEL)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig,
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
 * 항목별 평가 응답 정규화.
 * - 응답 배열은 `items` 키(또는 레거시 호환 `results`)를 허용.
 * - index로 체크리스트 항목과 짝지으며, 항상 items.length 길이의 배열을 반환한다.
 * - AI가 빠뜨린 항목은 **임의의 평균값으로 채우지 않고** N/A로 둔다.
 *   근거 없는 점수를 만들지 않는 것이 이 수업의 취지에 맞기 때문.
 * - 유효 응답이 하나도 없으면 throw (일괄 N/A 저장 방지).
 */
function normalizeItemEvaluation(parsed, items) {
  const arr = Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed?.results)
    ? parsed.results
    : [];

  const byIndex = new Map();
  arr.forEach((r, order) => {
    if (!r || typeof r !== "object") return;
    // index가 없으면 응답 배열 순서를 사용(모델이 index를 빠뜨리는 경우 대비).
    const idx = Number.isInteger(Number(r.index)) ? Number(r.index) : order;
    if (idx < 0 || idx >= items.length) return;
    if (!byIndex.has(idx)) byIndex.set(idx, r);
  });

  if (byIndex.size === 0) {
    const err = new Error("AI 평가 응답이 비어 있어요. 잠시 후 다시 시도해주세요.");
    err.status = 502;
    err.detail = JSON.stringify(parsed ?? {}).slice(0, 500);
    throw err;
  }

  const out = items.map((_, i) => {
    const r = byIndex.get(i);
    if (!r) {
      return {
        index: i,
        score: null,
        na: true,
        reason: "AI가 이 항목에 대한 응답을 돌려주지 않았어요. 다시 실행하면 채점될 수 있어요.",
        redFlags: [],
      };
    }
    const isNa =
      r.na === true ||
      r.skipped === true ||
      r.score === null ||
      r.score === "null" ||
      r.score === undefined;
    const raw = isNa ? NaN : Math.round(Number(r.score));
    const score = Number.isFinite(raw) ? Math.max(1, Math.min(5, raw)) : null;
    return {
      index: i,
      score,
      na: score === null,
      reason:
        typeof r.reason === "string" && r.reason.trim()
          ? r.reason.trim()
          : score === null
          ? "자료 안에서 이 항목을 판단할 단서를 찾지 못했어요."
          : "",
      redFlags: Array.isArray(r.redFlags)
        ? r.redFlags.filter((s) => typeof s === "string" && s.trim()).slice(0, 5)
        : [],
    };
  });

  if (out.every((r) => r.score === null)) {
    const err = new Error(
      "AI가 모든 항목을 판단하지 못했어요. 본문이 너무 짧거나 일시적인 오류일 수 있어요."
    );
    err.status = 502;
    err.detail = JSON.stringify(parsed ?? {}).slice(0, 500);
    throw err;
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

  // 두 모드 모두 items를 쓰므로(map=분류 대상, evaluate=채점 기준) media 유무로 먼저 가른다.
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
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length === 0) {
        return jsonResponse(400, {
          error: "채점할 체크리스트 항목(items)이 필요합니다.",
        });
      }
      const inlineImage = media.imageUrl
        ? await fetchImageInline(media.imageUrl)
        : null;
      const parsed = await callGemini(
        apiKey,
        buildEvaluatePrompt(media, items, { hasImage: Boolean(inlineImage) }),
        inlineImage
      );
      return jsonResponse(200, {
        items: normalizeItemEvaluation(parsed, items),
      });
    }

    return jsonResponse(400, { error: "mode는 'map' 또는 'evaluate' 중 하나여야 합니다." });
  } catch (err) {
    return jsonResponse(err.status || 500, {
      error: err.message || "서버 오류",
      detail: err.detail ?? null,
    });
  }
}
