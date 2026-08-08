/**
 * 수업 활동(순차 게이트) 공통 상수.
 *
 * 흐름: ① 지표 할당 → ② 자료 등록 → ③ 블라인드 채점 → ④ AI 판정·비교
 * 앞 단계를 마쳐야 다음 단계가 열린다. 진행 상태는 groups/{gid}/progress/current 에 저장.
 *
 * ⚠️ 이 흐름은 **모둠 작업실 전용**이다. 개인 작업실은 기존 자유 팩트체크를 그대로 쓴다.
 *    (조장 등록·블라인드 채점·제출 현황판이 모두 모둠을 전제로 하기 때문)
 */

export const STAGES = [
  {
    n: 1,
    key: "assign",
    title: "지표 할당",
    short: "체크리스트 항목을 5대 지표에 배정",
    path: "/student/lesson/assign",
  },
  {
    n: 2,
    key: "media",
    title: "자료 등록",
    short: "평가할 자료 2건 확인·등록",
    path: "/student/lesson/media",
  },
  {
    n: 3,
    key: "blind",
    title: "블라인드 채점",
    short: "AI를 보기 전에 내 판단으로 채점",
    path: "/student/lesson/blind",
  },
  {
    n: 4,
    key: "reveal",
    title: "AI 판정·비교",
    short: "AI 채점 공개와 비교 대시보드",
    path: "/student/lesson/reveal",
  },
];

export const FIRST_STAGE = 1;
export const LAST_STAGE = 4;

export function stageMeta(n) {
  return STAGES.find((s) => s.n === n) ?? STAGES[0];
}

/** 지표당 권고 최소 문항 수. 미만이면 통과시키되 경고를 띄운다. */
export const RECOMMENDED_ITEMS_PER_DIMENSION = 2;

/** 이 값 이상 차이나는 항목은 결과 화면에서 강조하고 원인 유형 서술을 **필수**로 요구한다. */
export const BIG_DIFF_THRESHOLD = 2;

/**
 * 학생-AI 점수 차이의 원인 유형.
 * ⚠️ 네 유형은 **우열이 없다.** 무엇이 맞고 틀린지가 아니라 "차이의 성격"을 분류하는 것이므로
 *    UI에서도 동일한 크기·색으로 대등하게 배치해야 한다(순서만 있는 목록).
 */
export const CAUSE_TYPES = [
  {
    key: "interpretation",
    label: "자료 해석의 차이",
    hint: "같은 문장을 읽고도 다르게 해석했다",
  },
  {
    key: "ambiguous_item",
    label: "우리 체크리스트 문항이 모호함",
    hint: "질문이 여러 뜻으로 읽혀 기준이 갈렸다",
  },
  {
    key: "ai_cannot_verify",
    label: "AI가 실제로 확인할 수 없는 항목",
    hint: "검색·역이미지 검색 등이 필요해 AI가 판단할 수 없다",
  },
  {
    key: "value_judgment",
    label: "정답이 없는 가치 판단 영역",
    hint: "무엇이 자극적인지 등 사람마다 다를 수 있다",
  },
];

export function causeTypeLabel(key) {
  return CAUSE_TYPES.find((c) => c.key === key)?.label ?? key;
}

/** 성찰 서술형 3문항 (4단계 하단). */
export const REFLECTION_QUESTIONS = [
  {
    key: "q1",
    title:
      "우리 모둠 데이터를 근거로, 다섯 지표 중 AI에 맡겨도 되는 것과 사람이 반드시 봐야 하는 것을 나누고 그 이유를 쓰시오.",
    hint: "위 표의 지표별 수치를 보고 판단해보세요.",
    needsNumber: false,
  },
  {
    key: "q2",
    title: "미디어 팩트체크에서 가장 중요한 것은 무엇이라고 생각하는가?",
    hint: "우리 모둠 수치를 최소 하나 인용해 주세요. (예: \"V4의 차이 평균이 2.14로…\")",
    needsNumber: true,
  },
  {
    key: "q3",
    title: "AI를 활용한 팩트체크의 실현 가능성을 어떻게 보는가?",
    hint: "우리 모둠 수치를 최소 하나 인용해 주세요.",
    needsNumber: true,
  },
];

/** 답변에 숫자가 인용됐는지 (강제하지 않고 안내만 한다). */
export function citesNumber(text) {
  return /\d/.test(String(text ?? ""));
}
