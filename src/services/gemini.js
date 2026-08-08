/**
 * Netlify Function 프록시 호출 (VAPM v5.0 두 가지 모드).
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
 * 체크리스트 항목 → 5대 검증 행동(V1~V5, 미분류는 V6) 분류.
 * v5.0에서 이 분류는 **점수 계산에 쓰이지 않는다.** 항목이 어떤 검증 행동에
 * 해당하는지 학생에게 보여주고 지표별 평균을 표시하기 위한 라벨이다.
 * @param {Array<{question:string}>} items
 * @returns {Promise<Array<{dimension:string, verification:string, confidence:number, reason:string}>>}
 */
export async function mapChecklistItems(items) {
  if (!items?.length) return [];
  const data = await postJson({ mode: "map", items });
  return data.mappings ?? [];
}

/**
 * 미디어 자료를 **그 모둠의 체크리스트 항목**으로 채점한다 (미디어당 단일 호출).
 *
 * - 항목에 루브릭 서술이 있으면 프록시가 프롬프트에 그대로 포함시킨다.
 * - 자료에 판단 단서가 없는 항목은 score=null, na=true와 그 사유가 돌아온다.
 * - AI는 입력된 언론사·작성일·링크를 검증 없이 사실로 전제하고 채점한다(수업에서 다루는 한계).
 *
 * @param {{title:string, subtitle?:string, content:string, link?:string,
 *          imageUrl?:string, publisher?:string, publishedAt?:string}} media
 * @param {Array<{question:string, rubric?:object}>} items 체크리스트 항목(순서 = index)
 * @returns {Promise<Array<{index:number, score:number|null, na:boolean, reason:string, redFlags:string[]}>>}
 */
export async function evaluateMediaByChecklist(media, items) {
  if (!items?.length) {
    throw new Error("체크리스트 항목이 없어요. 먼저 체크리스트를 작성해주세요.");
  }
  // 프롬프트에 필요한 필드만 추려 보낸다(불필요한 본문 필드 전송 방지).
  const payloadItems = items.map((it) => ({
    question: it?.question ?? "",
    rubric: it?.rubric ?? null,
  }));
  const data = await postJson({ mode: "evaluate", media, items: payloadItems });
  const results = Array.isArray(data.items) ? data.items : null;
  if (!results) {
    throw new Error("AI 평가 응답이 도착하지 않았어요. 다시 시도해주세요.");
  }
  return results;
}
