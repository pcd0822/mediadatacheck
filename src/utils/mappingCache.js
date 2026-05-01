import { mapChecklistItems } from "../services/gemini.js";

/** 현재(v2) 유효한 차원 코드. v1 잔재(D1~D7, D8)는 자동 재매핑 대상. */
const VALID_DIMS = new Set(["C1", "C2", "C3", "C4", "C5", "C6"]);

/**
 * 항목 리스트에 차원 매핑이 없거나, 질문 텍스트가 변경되었거나, v1 잔재 차원 코드인 항목만 다시 매핑한다.
 * 캐시 키는 dimensionMapKey 필드(저장 시점의 질문 텍스트).
 *
 * @param {Array<{question:string, dimension?:string, dimensionConfidence?:number, dimensionMapKey?:string}>} items
 * @returns {Promise<Array>} 같은 순서의 새 items 배열
 */
export async function ensureItemMappings(items) {
  if (!items?.length) return items;
  const todoIndices = [];
  const todoItems = [];
  items.forEach((it, idx) => {
    const q = (it?.question ?? "").trim();
    if (!q) return;
    const cached = it.dimensionMapKey;
    const validDim = VALID_DIMS.has(it.dimension);
    if (!validDim || cached !== q) {
      todoIndices.push(idx);
      todoItems.push({ question: q });
    }
  });

  if (todoItems.length === 0) return items;

  const mappings = await mapChecklistItems(todoItems);

  const next = items.map((it) => ({ ...it }));
  todoIndices.forEach((origIdx, i) => {
    const m = mappings[i];
    if (!m) return;
    next[origIdx] = {
      ...next[origIdx],
      dimension: m.dimension,
      dimensionConfidence: m.confidence,
      dimensionReason: m.reason,
      dimensionMapKey: (next[origIdx].question ?? "").trim(),
    };
  });
  return next;
}
