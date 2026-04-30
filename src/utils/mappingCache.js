import { mapChecklistItems } from "../services/gemini.js";

/**
 * 항목 리스트에 차원 매핑이 없거나, 질문 텍스트가 변경된 항목만 다시 매핑한다.
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
    if (!it.dimension || cached !== q) {
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
