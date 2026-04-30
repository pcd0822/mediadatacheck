/**
 * Netlify Function: Gemini 프록시 (HPFM 지원)
 *
 * 두 가지 모드 지원:
 *  - mode: "map"      → 체크리스트 항목 → 7대 차원(D1~D7) 자동 분류
 *  - mode: "evaluate" → 미디어 자료 → 7대 차원 1~5점 평가 (단일 호출에서 7개 결과)
 *
 * GEMINI_API_KEY는 서버에서만 사용 (클라이언트 미노출).
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const DIMENSION_GUIDE = `
[7대 표준 차원]
D1 출처 권위성 (Authority, CRAAP·SIFT-Investigate): 작성자/매체/기관의 신뢰성 — 작성자 명시, 매체의 발행 이력, 도메인 평판
D2 내용 정확성 (Accuracy, CRAAP·FEVER-Verdict): 사실 검증 가능 여부 — 검증 가능한 사실 진술 비율, 통계·수치의 출처
D3 시의성 (Currency, CRAAP): 정보의 최신성 — 보도-사건 시점 격차, 인용 자료의 최신성
D4 근거 제시 (Evidence, FEVER-Retrieval·SIFT-Trace): 출처·인용·데이터 — 1차 출처, 다중 교차 인용, 데이터·전문가 인용
D5 편향성·목적 (Bias/Purpose, CRAAP·IFCN): 편향·의도·광고성 — 한쪽 입장만, 정파적 어휘, 광고성·홍보성 단서
D6 언어 건전성 (Language Integrity, IFCN): 선정성·감정 자극 — 자극 어휘, 클릭베이트, 단정·과장 표현
D7 검증 가능성 (Verifiability, FEVER·IFCN): 교차검증 단서 — 외부 교차검증, 원자료 접근, 반증 가능성
`.trim();

/* ===================== 매핑 모드 ===================== */

function buildMapPrompt(items) {
  const list = items
    .map((it, idx) => `${idx}. ${it.question || "(빈 항목)"}`)
    .join("\n");
  return `당신은 미디어 리터러시 전문가입니다.
다음 팩트체킹 질문들을 7대 표준 차원 중 가장 적합한 단일 차원으로 분류하세요.

${DIMENSION_GUIDE}

[질문 목록]
${list}

규칙:
- 각 질문에 가장 적합한 차원 1개만 부여한다.
- 어디에도 명확히 속하지 않으면 "D8" (사용자 정의)로 분류한다.
- confidence는 0~1 사이 실수.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"mappings":[{"index":0,"dimension":"D2","confidence":0.87,"reason":"..."}, ...]}`;
}

/* ===================== 평가 모드 ===================== */

function buildEvaluatePrompt(media) {
  return `당신은 미디어 리터러시 보조 AI입니다.
다음 미디어 자료를 7대 차원 각각에 대해 1~5점 정수로 평가하세요. 각 차원의 평가 근거를 1~2문장 한국어로 작성합니다.

${DIMENSION_GUIDE}

[미디어 자료]
제목: ${media.title || "(제목 없음)"}
링크: ${media.link || "(없음)"}
본문:
${media.content || ""}

규칙:
- 점수는 1, 2, 3, 4, 5 중 하나의 정수.
- 7개 차원 모두 평가.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"dimensions":{"D1":{"score":4,"reason":"..."},"D2":{"score":3,"reason":"..."},"D3":{"score":5,"reason":"..."},"D4":{"score":3,"reason":"..."},"D5":{"score":2,"reason":"..."},"D6":{"score":4,"reason":"..."},"D7":{"score":3,"reason":"..."}}}`;
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

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error("Gemini API 오류");
    err.status = res.status;
    err.detail = errText;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  const parsed = extractJson(text);
  if (!parsed) {
    const err = new Error("Gemini 응답 파싱 실패");
    err.status = 502;
    err.detail = text;
    throw err;
  }
  return parsed;
}

const VALID_DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];

function normalizeMappings(parsed, items) {
  const arr = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
  const byIndex = {};
  for (const m of arr) {
    const idx = Number(m?.index);
    if (!Number.isInteger(idx)) continue;
    const dim = String(m?.dimension ?? "").toUpperCase();
    byIndex[idx] = {
      dimension: VALID_DIMS.includes(dim) ? dim : "D8",
      confidence: clamp01(Number(m?.confidence)),
      reason: typeof m?.reason === "string" ? m.reason : "",
    };
  }
  return items.map((_, i) =>
    byIndex[i] ?? { dimension: "D8", confidence: 0, reason: "분류 실패" }
  );
}

function normalizeEvaluation(parsed) {
  const dims = parsed?.dimensions ?? {};
  const out = {};
  for (const code of ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]) {
    const v = dims[code] ?? {};
    const raw = Math.round(Number(v.score));
    const score = Number.isFinite(raw) ? Math.max(1, Math.min(5, raw)) : 3;
    out[code] = {
      score,
      reason: typeof v.reason === "string" ? v.reason : "",
    };
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
      const parsed = await callGemini(apiKey, buildEvaluatePrompt(media));
      return jsonResponse(200, { dimensions: normalizeEvaluation(parsed) });
    }

    return jsonResponse(400, { error: "mode는 'map' 또는 'evaluate' 중 하나여야 합니다." });
  } catch (err) {
    return jsonResponse(err.status || 500, {
      error: err.message || "서버 오류",
      detail: err.detail ?? null,
    });
  }
}
