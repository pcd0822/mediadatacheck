/**
 * Netlify Function: Gemini 프록시 (IPFM v2.0 지원)
 *
 * 두 가지 모드 지원:
 *  - mode: "map"      → 체크리스트 항목 → IFCN 5대 차원(C1~C5) 자동 분류
 *  - mode: "evaluate" → 미디어 자료 → 5대 차원 1~5점 평가 (단일 호출에서 5개 결과)
 *
 * GEMINI_API_KEY는 서버에서만 사용 (클라이언트 미노출).
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const DIMENSION_GUIDE = `
[IFCN 5대 강령 기반 5대 차원]
C1 공정성·균형 (Fairness & Balance, IFCN 강령 1 — 초당파성과 공정성):
   다양한 입장 균형, 자극·정파적 어휘 자제, 작성자 의견과 사실의 구분, 광고·홍보성 단서
C2 근거·자료의 투명성 (Source Transparency, IFCN 강령 2 — 자료 출처의 투명성):
   주요 주장의 1차 출처·인용·데이터 명시, 외부 링크·각주를 통한 검증 가능성, 다중 독립 출처의 일치
C3 출처·작성자의 투명성 (Author/Org Transparency, IFCN 강령 3 — 재원·조직의 투명성):
   작성자·매체의 신원·자격·이력, 매체의 소유 구조·재원·이해관계 공개 여부
C4 검증된 방법과 증거 (Methodology & Evidence, IFCN 강령 4 — 방법론의 투명성):
   사실 진술의 정확성, 통계 산출 방식·연구 방법 명시, 추측과 사실의 구분, 인용 맥락 보존
C5 정정 가능성과 시의성 (Correction & Currency, IFCN 강령 5 — 개방성과 정직한 수정):
   발행일 명확성, 다루는 주제 대비 최신성, 정정·갱신 정책의 공개 여부와 후속 보도 연결
`.trim();

/* ===================== 매핑 모드 ===================== */

function buildMapPrompt(items) {
  const list = items
    .map((it, idx) => `${idx}. ${it.question || "(빈 항목)"}`)
    .join("\n");
  return `당신은 미디어 리터러시 전문가입니다.
다음 팩트체킹 질문들을 IFCN 5대 강령 기반 5대 차원 중 가장 적합한 단일 차원으로 분류하세요.

${DIMENSION_GUIDE}

[질문 목록]
${list}

규칙:
- 각 질문에 가장 적합한 차원 1개만 부여한다.
- 어디에도 명확히 속하지 않으면 "C6" (사용자 정의)로 분류한다.
- confidence는 0~1 사이 실수.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"mappings":[{"index":0,"dimension":"C2","confidence":0.87,"reason":"..."}, ...]}`;
}

/* ===================== 평가 모드 ===================== */

function buildEvaluatePrompt(media) {
  return `당신은 미디어 리터러시 보조 AI입니다.
다음 미디어 자료를 IFCN 5대 강령 기반 5대 차원 각각에 대해 1~5점 정수로 평가하세요.
각 차원의 평가 근거를 1~2문장 한국어로 작성합니다.

${DIMENSION_GUIDE}

[미디어 자료]
제목: ${media.title || "(제목 없음)"}
링크: ${media.link || "(없음)"}
본문:
${media.content || ""}

규칙:
- 점수는 1, 2, 3, 4, 5 중 하나의 정수.
- 5개 차원(C1~C5) 모두 평가.
- JSON만 출력. 마크다운 금지.

응답 스키마:
{"dimensions":{"C1":{"score":4,"reason":"..."},"C2":{"score":3,"reason":"..."},"C3":{"score":5,"reason":"..."},"C4":{"score":3,"reason":"..."},"C5":{"score":2,"reason":"..."}}}`;
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

const VALID_DIMS = ["C1", "C2", "C3", "C4", "C5", "C6"];
const EVAL_DIMS = ["C1", "C2", "C3", "C4", "C5"];

function normalizeMappings(parsed, items) {
  const arr = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
  const byIndex = {};
  for (const m of arr) {
    const idx = Number(m?.index);
    if (!Number.isInteger(idx)) continue;
    const dim = String(m?.dimension ?? "").toUpperCase();
    byIndex[idx] = {
      dimension: VALID_DIMS.includes(dim) ? dim : "C6",
      confidence: clamp01(Number(m?.confidence)),
      reason: typeof m?.reason === "string" ? m.reason : "",
    };
  }
  return items.map((_, i) =>
    byIndex[i] ?? { dimension: "C6", confidence: 0, reason: "분류 실패" }
  );
}

function normalizeEvaluation(parsed) {
  const dims = parsed?.dimensions ?? {};
  const out = {};
  for (const code of EVAL_DIMS) {
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
