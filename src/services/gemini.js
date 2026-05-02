/**
 * Netlify Function 프록시 호출 (VAPM v3.0 두 가지 모드).
 * 개발 시 vite.config.js의 proxy 설정으로 8888 포트를 통해 호출됨.
 */
const ENDPOINT = "/.netlify/functions/gemini";

async function postJson(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Gemini 호출 실패");
  return data;
}

/**
 * 체크리스트 항목 → 5대 검증 행동(V1~V5, 미분류는 V6) 매핑.
 * @param {Array<{question:string}>} items
 * @returns {Promise<Array<{dimension:string, verification:string, confidence:number, reason:string}>>}
 */
export async function mapChecklistItems(items) {
  if (!items?.length) return [];
  const data = await postJson({ mode: "map", items });
  return data.mappings ?? [];
}

/**
 * 미디어 자료를 5대 검증 행동(V1~V5)으로 1~5점 평가.
 * - V4(이미지·영상)가 본문에 시각 자료 언급이 없을 때는 score=null, skipped=true로 반환됨.
 * - 응답이 비어있거나 모든 점수가 누락되면 throw하여 fallback 일괄 저장 방지.
 * @param {{title:string, content:string, link?:string}} media
 * @returns {Promise<Record<"V1"|"V2"|"V3"|"V4"|"V5", {score:number|null, skipped?:boolean, reason:string, redFlags?:string[]}>>}
 */
export async function evaluateMediaDimensions(media) {
  const data = await postJson({ mode: "evaluate", media });
  const dims = data.verifications ?? data.dimensions ?? null;
  if (!dims) throw new Error("AI 평가 응답이 도착하지 않았어요. 다시 시도해주세요.");

  const codes = ["V1", "V2", "V3", "V4", "V5"];
  const valid = codes.filter((c) => {
    const e = dims?.[c];
    if (!e) return false;
    if (e.skipped === true) return true; // V4 N/A도 유효한 응답으로 인정
    return Number.isFinite(Number(e.score));
  });
  if (valid.length === 0) {
    throw new Error("AI 평가 결과를 읽을 수 없어요. 잠시 후 다시 시도해주세요.");
  }
  return dims;
}
