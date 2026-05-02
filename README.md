# 미디어 리터러시 · 팩트체크 학습 플랫폼 (VAPM v3.0)

중·고등학생이 직접 **팩트체크 체크리스트를 설계**하고, 그것을 기반으로 한
**VAPM(Verification Action-based Progressive fact-check Model) v3.0** 으로 미디어 자료를 평가·정교화하는 AI 활용 탐구형 학습 플랫폼.

> 본 모델은 **실제 미디어 자료를 평가할 때 학생이 수행하는 5가지 검증 행동**(출처 확인 / 저자 확인 / 콘텐츠 교차 확인 / 이미지·영상 확인 / 감정 반응 점검)에 기반합니다.
> 이전 버전인 IPFM v2.0(IFCN 5대 강령 기반)에서 미디어 리터러시 교육에 더 적합한 **5가지 실행적 검증 행동(V1~V5)** 으로 재설계되었습니다.

> 학생 학습 흐름
> ① 체크리스트 만들기 → ② 교사 등록 미디어를 평가해 베이지안 가중치 학습 → ③ 새 미디어를 Gemini로 5대 검증 행동 평가 → ④ 50점 환산 + 신뢰구간 → ⑤ 수용(σ↓) 또는 정교화(η×1.5) → ⑥ 검증 행동별 마스터리(Mastery) 추적

---

## 🧰 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vite + React 18 + React Router |
| 스타일 | Tailwind CSS, Pretendard |
| 인증 | Firebase Auth (Google OAuth) |
| 데이터 | Firebase Firestore |
| 파일 | Firebase Storage (썸네일) |
| AI | Google Gemini API (Netlify Function 프록시) |
| 디자인 | Stitch MCP 프로젝트 연동 |
| 호스팅 | Netlify (GitHub 자동 배포) |

---

## 🧠 VAPM v3.0 (Verification Action-based Progressive fact-check Model)

학생의 **개인화된 체크리스트** + **5대 검증 행동** + **베이지안 점진 학습** + **검증 행동별 마스터리**를 결합한 교육용 모델.

### 5대 검증 행동 (V1~V5)

| 코드 | 검증 행동 | 핵심 활동 |
|------|-----------|----------|
| **V1** | **출처 확인** (Source Check) | 매체의 익숙함과 진위 점검, 위장 사이트 식별 |
| **V2** | **저자 확인** (Author Check) | 작성자 이력 추적, 봇 계정 특징 인지 |
| **V3** | **콘텐츠 교차 확인** (Content Cross-check) | 전통 매체·공공기관·NGO 보도와 일치 여부 |
| **V4** | **이미지·영상 확인** (Visual Verification) | 맥락 재사용·딥페이크 점검, 역이미지 검색 |
| **V5** | **감정 반응 점검** (Emotional Reaction Check) | 의도적 감정 자극 여부 자기 점검 (메타인지) |
| (V6) | 사용자 정의 (5대 검증 행동 어디에도 매핑되지 않은 항목) | — |

### 7층 아키텍처

```
Layer 7 · 최종 점수(50점) + 95% 신뢰구간 + 검증 행동별 마스터리
Layer 6 · 베이지안 가중치 갱신 (μ, σ) + Mastery 산출
Layer 5 · 교사 격차 분석 + 메타인지 피드백 카드
Layer 4 · 학생 가중치 적용 (V4 N/A 자동 재분배 포함)
Layer 3 · 5대 검증 행동 Gemini 평가 (단일 호출 5개 결과)
Layer 2 · 체크리스트 → 5대 검증 행동 자동 매핑 (캐싱)
Layer 1 · 학생 커스텀 체크리스트
```

### 핵심 수식 (`src/utils/hpfm.js`)

```text
사전(Prior):  W = { Vi: { mu, sigma } }, Σ μ_i = 1, n = 5, 초기 μ = 0.20
관측(Obs):    (V_i_score, gap_i = teacher_i - student_i)
갱신(Update): w_i^(t+1) = w_i^(t) + η · gap_i · V_i_score / Σ(V_j_score²)
              η(t) = max(0.05, 0.2 · exp(-0.05 · t))
              σ_i^(t+1) = max(0.02, σ_i^(t) · 0.95)
정규화:        μ_i ← μ_i / Σ μ_j

50점 점수:    S = (Σ μ_i · V_i_score / Σ μ_active) · 10
              ※ V4 N/A인 경우 활성 가중치만으로 자동 재정규화
점수 분산:    Var(S) = 100 · Σ V_i_score² · σ_i²  (활성 행동만)
95% 신뢰구간: S ± 1.96 · √Var(S)

수렴도:       1 - ||W_student - W_teacher_implicit|| / √5   (0~1)
마스터리:     Mastery(V_i) = (1 - σ_i) · (1 - |avg_gap_i| / 4)   (0~1)
```

### 학습 단계 정책

- **Cold Start (t < 3)**: 균등 가중치만 사용. 베이즈 갱신 비활성.
- **워밍업 (3 ≤ t < 5)**: 신중한 갱신.
- **Bayesian 활성 (t ≥ 5)**: 차원별 σ 본격 감소, 정교화 가속.

### 수용 / 정교화

| | 학습 데이터 추가 | 가중치 갱신 |
|---|---|---|
| 🟢 수용 | Gemini 점수 그대로 | σ만 약간 감소 (관측 누적 효과) |
| 🟡 정교화 | 학생 수정값 | `bayesianUpdate` with **η × 1.5** + 학생-Gemini 격차를 신호로 사용 |

### V4 N/A (이미지 없는 텍스트 자료) 처리

- Gemini 프록시가 본문에 시각 자료 언급이 전혀 없다고 판단하면 V4를 `score: null, skipped: true`로 반환합니다.
- `computeFinalScore`는 활성 가중치만으로 자동 재정규화하여 4개 행동만으로 50점을 환산합니다.
- 결과 화면은 V4 카드를 "해당 없음 (N/A)"으로 표시합니다.

### 메타인지 피드백 카드

누적 격차 패턴에서 다음 3종 카드를 자동 생성하여 학생 대시보드에 표시:
- **Over**: 평균 gap < -0.5 (학생이 박하게 평가)
- **Under**: 평균 gap > +0.5 (학생이 후하게 평가)
- **Inconsistent**: gap 분산 > 1.0 (기준이 흔들림)

각 카드는 검증 행동 · 진단 · 자기 점검 가이드를 포함합니다.

### 검증 행동별 마스터리 (Mastery)

- 학생이 각 검증 행동을 얼마나 안정적으로 수행하는지 0~1 사이 값으로 표시.
- 학생 대시보드에서 색상 막대(🌟≥80% / ⚠️<40%)로 약점 행동을 즉시 시각화.
- 격차가 작고 σ가 줄어들수록 마스터리가 올라감.

### 미디어 유형별 권장 가중치 프리셋

`MEDIA_TYPE_PRESETS` (`src/utils/hpfm.js`)에 5종 프리셋 내장:

| 미디어 유형 | V1 | V2 | V3 | V4 | V5 |
|------------|-----|-----|-----|-----|-----|
| 뉴스 기사 | 0.20 | 0.15 | 0.30 | 0.15 | 0.20 |
| SNS 게시물 | 0.15 | 0.30 | 0.15 | 0.20 | 0.20 |
| 영상 콘텐츠 | 0.15 | 0.20 | 0.20 | 0.30 | 0.15 |
| 광고/홍보 | 0.20 | 0.15 | 0.20 | 0.15 | 0.30 |
| 정부 공식 발표 | 0.30 | 0.25 | 0.25 | 0.10 | 0.10 |

### 레거시 → v3 차원 변환

이전 버전(HPFM v1.0의 D1~D8, IPFM v2.0의 C1~C6)으로 누적된 차원 점수는 다음 변환식으로 V1~V6에 매핑됩니다 (`migrateLegacyDimensionScores`).

| 레거시 | 새 검증 행동 |
|---|---|
| D1 출처 권위성 / C3 출처·작성자 투명성 | → **V1** + **V2** (양쪽 평균) |
| D2 내용 정확성 / C4 방법·증거 | → **V3** |
| D3 시의성 / C5 정정·시의성 | → **V1** |
| D4 근거 + D7 검증 가능성 / C2 자료 투명성 | → **V3** |
| D5 편향성 + D6 언어 건전성 / C1 공정성·균형 | → **V5** |
| D8 / C6 (사용자 정의) | → **V6** |

**완전한 마이그레이션은 불가능합니다 (특히 V4 이미지·영상은 신규 행동)**. 기존 자료는 가능한 한 V1~V5 기준으로 재평가를 권장합니다.

---

## 🚀 빠른 시작

```bash
npm install
cp .env.example .env   # 또는 .env.local
# .env 값 채우기 (Firebase + GEMINI_API_KEY)

# Gemini Function까지 띄우려면 Netlify CLI 권장
npm install -g netlify-cli
netlify dev            # http://localhost:8888
```

`vite dev`만 띄우면 Gemini 호출은 동작하지 않습니다.

---

## 🔑 환경 변수

`VITE_*` 접두어가 붙은 값만 클라이언트 번들에 포함됩니다.
`GEMINI_API_KEY`는 **반드시 서버사이드(Netlify Function)에만** 두세요.

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_TEACHER_AUTH_CODE=0822

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

Netlify 사이트에서는 동일한 키를 **Site settings → Environment variables**에 등록.

---

## 🔥 Firebase 설정 체크리스트

1. Firebase 프로젝트 생성 → **Authentication**에서 Google 로그인 활성화.
2. **승인된 도메인**에 `localhost`, `*.netlify.app`, 커스텀 도메인 등록.
3. **Firestore Database** 생성 (Native).
4. **Storage** 생성 (썸네일 업로드용).
5. 권장 보안 규칙 (개발 시작용 — 운영 전 강화 필수):

```js
// Firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{rest=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /media_items/{mediaId} {
      allow read: if request.auth != null;
      allow create, update, delete: if request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'teacher';
      match /teacher_evaluation/{docId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'teacher';
      }
      match /student_evaluations/{uid} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

---

## 🗄️ Firestore 데이터 구조 (VAPM-3.0)

```
users/{uid}
  role, email, displayName, createdAt, lastLogin
  checklists/{checklistId}
    checklistName
    version: "VAPM-3.0", standard_basis: "5_verification_actions"
    items[{ question, rubric{1..5},
            dimension (V1~V5 or V6), dimensionConfidence, dimensionMapKey }]
  algorithm_model/current
    version: "VAPM-3.0", standard_basis: "5_verification_actions"
    weights: { V1:{mu,sigma}, ..., V5:{mu,sigma} }
    mastery: { V1: 0.80, V2: 0.40, V3: 0.70, V4: 0.30, V5: 0.80 }
    checklistId, trainingDataCount, learningRate
    convergenceScore
    teacherImplicitWeights: { V1:.., ..., V5:.. }
    trainedAt
    training_data/{dataId}
      mediaId, checklistId,
      studentDimensionScores, teacherDimensionScores, gap,
      source: "modeling" | "accept" | "refine"
  feedback_cards/{cardId}
    dimension, dimensionName, type, diagnosis, detail, suggestion, framework, stats
  factcheck_history/{historyId}
    version: "VAPM-3.0", standard_basis: "5_verification_actions"
    media{title,content,link}, checklistId, checklistSnapshot,
    dimensionScores (V4 = null이면 N/A), dimensionReasons, dimensionRedFlags, dimensionSkipped,
    weightsSnapshot, totalScore, variance, confidenceInterval95,
    accepted, refined, finalDimensionScores, finalTotalScore

media_items/{mediaId}
  title, content, link, thumbnailUrl, uploadedBy, createdAt
  teacher_evaluation/default
    items[{ question, score, dimension, dimensionConfidence, dimensionMapKey,
            verification_action?, evidence? }]
    totalScore, dimensionScores
  student_evaluations/{uid}
    items[], checklistId, dimensionScores, updatedAt
```

---

## 🧑‍🏫 / 🎓 사용자 플로우

| 화면 | 경로 | 설명 |
|---|---|---|
| 로그인 (역할 선택) | `/` | 학생/교사 시작 분기 |
| 교사 인증 코드 | `/teacher-code` | `0822` 입력 → Google 로그인 |
| 교사 대시보드 | `/teacher` | 미디어 자료 목록 |
| 미디어 등록 | `/teacher/upload` | 제목/본문/링크/썸네일 |
| 교사 평가 | `/teacher/evaluate/:mediaId` | 5대 검증 행동 기반 5개 디폴트 항목 1~5점 (저장 시 검증 행동 자동 매핑) |
| 학생 대시보드 | `/student` | 5대 검증 행동 가중치 + 마스터리 + 수렴도 + 피드백 카드 |
| 체크리스트 | `/student/checklist` | 질문 + 1~5점 루브릭 (저장 시 V1~V5 매핑) |
| 모델링 | `/student/modeling` | 미디어 평가 → 베이지안 갱신 |
| 팩트체크 | `/student/factcheck` | Gemini 5대 검증 행동 평가 → 50점 + 신뢰구간 |
| 결과 | `/student/result/:historyId` | V1~V5 표시(V4 N/A 처리) / 수용 / 정교화(η×1.5) |

---

## ⏳ 로딩 인터랙션

- 모든 액션 버튼: `Button` 컴포넌트의 `loading` prop으로 내부 스피너.
- API 호출/페이지 전환 시: `LoadingOverlay` 풀스크린.
- 데이터 로딩: `Skeleton` 카드/리스트.

---

## 🎨 Stitch 연동

- 프로젝트 ID: `10249767065157593346`
- Stitch 콘솔의 "미디어 리터러시 - 팩트체크 학습 플랫폼"에서 디자인 확인/편집 가능.
- 추가 화면은 `mcp__stitch__generate_screen_from_text`에 같은 projectId로 누적.

---

## 🚢 배포 (Netlify + GitHub)

1. 저장소를 GitHub에 푸시.
2. [Netlify](https://app.netlify.com) → **Add new site → Import from Git**.
3. 빌드 설정 (이미 `netlify.toml`에 정의됨):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Site settings → Environment variables 에 `.env.example`의 키 모두 등록.
5. Firebase Authentication의 **승인된 도메인**에 배포 도메인 추가.
6. 이후 `git push` 시 자동 배포.

---

## ✅ VAPM v3.0 변경 사항 (v2.0 IPFM → v3.0 VAPM)

- [x] 차원 체계 IFCN 5대 강령(C1~C5) → **5대 검증 행동(V1~V5)** 으로 재설계
- [x] 미분류 폴백 차원 C6 → **V6**
- [x] 모델 버전 `IPFM-2.0` → `VAPM-3.0` (`standard_basis: 5_verification_actions`)
- [x] Gemini 매핑/평가 프롬프트 5대 검증 행동 가이드로 교체
- [x] 교사 평가 디폴트 5개 항목을 5대 검증 행동 1:1 매핑 항목으로 교체
- [x] 가중치 정규화 분모, 수렴도 √n, 초기 μ=1/5 등 5차원 기준 자동 동작 (`DIMENSIONS.length`)
- [x] **검증 행동별 Mastery 산출** `(1-σ_i)·(1-|avg_gap_i|/4)` 추가
- [x] **V4 N/A (이미지 없는 텍스트 자료) 자동 처리**: Gemini가 `skipped:true` 반환 시 활성 가중치 재정규화
- [x] **redFlags 배열** 지원: Gemini가 발견한 위험 신호(타이포스쿼팅·딥페이크 의심 등)를 결과 화면에 표시
- [x] **MEDIA_TYPE_PRESETS** (뉴스/SNS/영상/광고/정부) 권장 가중치 프리셋 내장
- [x] 학생 대시보드에 **마스터리 시각화 섹션** 추가 (🌟/⚠️ 색상 코드)
- [x] 50점 환산: 가중평균 × 10 (활성 가중치 자동 재정규화)
- [x] 레거시 → v3 차원 점수 마이그레이션 헬퍼 `migrateLegacyDimensionScores` 제공 (D1~D8, C1~C6 → V1~V6)

---

## ✅ 개발 완료 체크리스트

- [x] 학생/교사 역할 분리 로그인
- [x] 교사 인증 코드 `0822` 검증
- [x] Firestore 사용자/체크리스트/미디어/모델 저장
- [x] 미디어 4가지(제목/본문/링크/썸네일) 등록
- [x] 교사 평가 항목 검증 행동 자동 매핑 + 행동별 점수 캐시
- [x] 학생 1~5점 루브릭 체크리스트 CRUD + 검증 행동 자동 매핑
- [x] **VAPM 베이지안 점진 학습** (μ, σ, 학습률 스케줄, 수렴도)
- [x] **검증 행동별 마스터리 추적** (`(1-σ)·(1-|gap|/4)`)
- [x] Gemini 두 모드 (map / evaluate) Netlify Function 프록시
- [x] 5대 검증 행동 Gemini 평가 → 50점 환산 + 95% 신뢰구간
- [x] V4 N/A 자동 처리 + 활성 가중치 재정규화
- [x] 수용(σ↓) / 정교화(η×1.5) 분기
- [x] 메타인지 피드백 카드 자동 생성
- [x] 모든 버튼/API 호출 로딩 인터랙션
- [x] Stitch 프로젝트 연동
- [x] Netlify 자동 배포 설정 (`netlify.toml`)

---

## 📁 프로젝트 구조

```
mediadatacheck/
├─ index.html
├─ package.json
├─ vite.config.js
├─ tailwind.config.js
├─ postcss.config.js
├─ netlify.toml
├─ .env.example
├─ README.md                              # 본 문서
├─ ALGORITHM.md                           # 학생용 알고리즘 안내서
├─ netlify/functions/gemini.js            # Gemini 프록시 (map + evaluate, 5대 검증 행동)
└─ src/
   ├─ main.jsx, App.jsx, index.css
   ├─ firebase.js
   ├─ contexts/AuthContext.jsx
   ├─ services/                           # auth, firestore, storage, gemini
   ├─ utils/
   │   ├─ hpfm.js                         # VAPM 코어 (5대 검증 행동, 베이지안, 수렴도, 마스터리, 미디어 유형 프리셋, 레거시 마이그레이션)
   │   └─ mappingCache.js                 # 검증 행동 매핑 캐싱
   ├─ components/
   │   ├─ Button.jsx, Layout.jsx
   │   └─ Loading/                         # Spinner, LoadingOverlay, Skeleton
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                         # Dashboard, MediaUpload, Evaluation
       └─ student/                         # Dashboard, Checklist, Modeling, FactCheck, Result
```

> `src/utils/hpfm.js`는 v1(HPFM) → v2(IPFM) → v3(VAPM) 진화 흐름의 호환성을 위해 파일명을 유지합니다. 내부 모델은 VAPM-3.0입니다.

---

## 🎓 교육적 의의

VAPM v3.0은 자동 평가 도구를 넘어 **학생이 자신의 검증 행동 습관을 정량화하고, 약점 행동을 메타인지로 보완하는 실행 중심 학습 도구**로 작동합니다.

- **5대 검증 행동**: 추상적 기준이 아닌 학생이 직접 수행하는 구체적 행동
- **디지털 시민 역량**: 봇 식별·딥페이크·역이미지 검색 등 현대 디지털 도구 활용
- **메타인지 강화**: V5(감정 반응 점검)로 자기 자신의 사고 과정 점검
- **베이지안 갱신**: 새 증거에 따라 신념을 업데이트하는 비판적 사고의 수학적 형식화
- **격차 분석**: 자기 인식과 메타인지의 정량적 도구
- **마스터리 추적**: 5개 행동 각각의 숙달도를 시각화하여 약점 행동 집중 학습 유도
- **수렴도 추적**: 학습의 진보를 가시화

> 알고리즘 동작 원리에 대한 학생 친화적 설명은 [`ALGORITHM.md`](./ALGORITHM.md)를 참고하세요.
