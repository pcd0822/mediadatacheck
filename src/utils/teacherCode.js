/**
 * 교사 인증 코드 해싱 유틸 (Web Crypto, 브라우저).
 *
 * 코드 평문을 저장하지 않고 salt + SHA-256 해시만 Firestore(config/teacher)에 보관한다.
 * 이는 "강한 비밀번호"가 아니라 학생의 우발적 교사 진입을 막는 소프트 게이트이며,
 * 실제 데이터 격리는 "교사당 Firebase 1개" 구조로 보장한다.
 *
 * crypto.subtle은 보안 컨텍스트(https, localhost)에서만 동작한다.
 * netlify dev(http://localhost:8888)와 운영(https)은 모두 보안 컨텍스트라 정상 동작한다.
 */

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 16바이트 무작위 salt를 base64로 반환. */
export function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes);
}

/** (salt + code)의 SHA-256 해시를 hex 문자열로 반환. */
export async function hashCode(code, saltB64) {
  const salt = b64ToBytes(saltB64);
  const codeBytes = new TextEncoder().encode(String(code));
  const combined = new Uint8Array(salt.length + codeBytes.length);
  combined.set(salt, 0);
  combined.set(codeBytes, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return bufToHex(digest);
}

/** 새 코드 → 저장용 레코드 { salt, codeHash } 생성. */
export async function makeCodeRecord(code) {
  const salt = generateSalt();
  const codeHash = await hashCode(code, salt);
  return { salt, codeHash };
}

/** 입력 코드가 저장된 레코드와 일치하는지 검증. */
export async function verifyCode(code, record) {
  if (!record?.salt || !record?.codeHash) return false;
  const h = await hashCode(code, record.salt);
  return h === record.codeHash;
}
