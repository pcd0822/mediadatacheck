/**
 * 세션 인메모리 read-through 캐시.
 * 같은 데이터를 화면 전환마다 다시 읽지 않게 해 Firestore 일일 읽기 쿼터를 아낀다.
 * - TTL 내 재요청은 메모리에서 반환.
 * - 동시 요청은 inflight 프라미스를 공유해 중복 호출 제거.
 * 실시간성이 꼭 필요한 데이터는 캐시 대신 onSnapshot 구독을 사용한다.
 */
const store = new Map();
const inflight = new Map();

export async function cached(key, loader, { ttlMs = 60000 } = {}) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, at: Date.now() });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** prefix로 시작하는 키(또는 전체)를 무효화. 쓰기 후 호출. */
export function invalidate(prefix) {
  for (const k of store.keys()) {
    if (!prefix || k.startsWith(prefix)) store.delete(k);
  }
}
