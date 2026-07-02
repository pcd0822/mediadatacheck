/**
 * VAPM 모델 버전 상수 — 단일 출처(single source of truth).
 *
 * 과거에는 이 두 값이 hpfm.js / firestore.js / groups.js 세 파일에 각각 복제되어
 * 있었고, FactCheckPage.jsx에는 문자열 리터럴로 직접 박혀 있었습니다.
 * 한 곳만 고치면 나머지와 어긋나 Firestore에 버전이 뒤섞여 저장되는 위험이 있어
 * 이 파일 하나로 통합했습니다. 버전을 올릴 때는 여기만 수정하세요.
 *
 * ⚠️ 이 값들은 Firestore 문서 스키마(`version`, `standard_basis`)에 그대로 기록됩니다.
 *    바꾸면 기존 문서와의 호환/마이그레이션에 영향을 줄 수 있으니 주의하세요.
 *
 * 참고: 동일한 의미의 레거시 매핑 테이블(LEGACY_TO_NEW)은 클라이언트 번들(hpfm.js)과
 *      Netlify Function(gemini.js)이 서로 다른 배포 단위라 import를 공유하지 못해
 *      의도적으로 양쪽에 복제되어 있습니다. 그쪽은 이 파일로 합치지 않습니다.
 */

/** 현재 모델 버전. Firestore 문서의 `version` 필드에 저장됩니다. */
export const MODEL_VERSION = "VAPM-4.0";

/** 평가 기준 체계 식별자. Firestore 문서의 `standard_basis` 필드에 저장됩니다. */
export const STANDARD_BASIS = "5_verification_actions";
