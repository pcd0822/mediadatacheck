# 미디어 리터러시 · 팩트체크 학습 플랫폼 (IPFM v2.0)

중·고등학생이 직접 **팩트체크 체크리스트를 설계**하고, 그것을 기반으로 한
**IPFM(IFCN-aligned Progressive Fact-Check Model) v2.0** 으로 미디어 자료를 평가·정교화하는 AI 활용 탐구형 학습 플랫폼.

> 본 모델은 **IFCN(International Fact-Checking Network) 5대 강령**에 정렬된 **5개 평가 차원(C1~C5)** 으로 동작합니다. (이전 7대 차원 HPFM v1.0에서 IFCN 표준 기반 5대 차원으로 정비)

> 학생 학습 흐름
> ① 체크리스트 만들기 → ② 교사 등록 미디어를 평가해 베이지안 가중치 학습 → ③ 새 미디어를 Gemini로 5차원 평가 → ④ 50점 환산 + 신뢰구간 → ⑤ 수용(σ↓) 또는 정교화(η×1.5)

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

## 🧠 IPFM v2.0 (IFCN-aligned Progressive Fact-Check Model)

학생의 **개인화된 체크리스트** + **IFCN 5대 강령 기반 5대 차원** + **베이지안 점진 학습**을 결합한 교육용 모델.

### IFCN 5대 강령 정렬 5대 차원

| 코드 | 차원 | IFCN 강령 |
|---|---|---|
| **C1** | 공정성·균형 (Fairness & Balance) | 강령 1 — 초당파성과 공정성 |
| **C2** | 근거·자료의 투명성 (Source Transparency) | 강령 2 — 자료 출처의 투명성 |
| **C3** | 출처·작성자의 투명성 (Author/Org Transparency) | 강령 3 — 재원·조직의 투명성 |
| **C4** | 검증된 방법과 증거 (Methodology & Evidence) | 강령 4 — 방법론의 투명성 |
| **C5** | 정정 가능성과 시의성 (Correction & Currency) | 강령 5 — 개방성과 정직한 수정 |
| (C6) | 사용자 정의 (5강령 어디에도 매핑되지 않은 항목) | — |

### 7층 아키텍처

```
Layer 7 · 최종 점수(50점) + 95% 신뢰구간
Layer 6 · 베이지안 가중치 갱신 (μ, σ)
Layer 5 · 교사 격차 분석 + 메타인지 피드백 카드
Layer 4 · 학생 가중치 적용
Layer 3 · 5대 차원 Gemini 평가 (단일 호출 5개 결과)
Layer 2 · 체크리스트 → IFCN 5대 차원 자동 매핑 (캐싱)
Layer 1 · 학생 커스텀 체크리스트
```

### 핵심 수식 (`src/utils/hpfm.js`)

```text
사전(Prior):  W = { Ci: { mu, sigma } }, Σ μ_i = 1, n = 5, 초기 μ = 0.20
관측(Obs):    (C_i_score, gap_i = teacher_i - student_i)
갱신(Update): w_i^(t+1) = w_i^(t) + η · gap_i · C_i_score / Σ(C_j_score²)
              η(t) = max(0.05, 0.2 · exp(-0.05 · t))
              σ_i^(t+1) = max(0.02, σ_i^(t) · 0.95)
정규화:        μ_i ← μ_i / Σ μ_j

50점 점수:    S = (Σ μ_i · C_i_score) · 10        (※ 균등 가중치일 때 "합산 × 2"와 동일)
점수 분산:    Var(S) = 100 · Σ C_i_score² · σ_i²
95% 신뢰구간: S ± 1.96 · √Var(S)

수렴도:       1 - ||W_student - W_teacher_implicit|| / √5   (0~1)
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

### 메타인지 피드백 카드

누적 격차 패턴에서 다음 3종 카드를 자동 생성하여 학생 대시보드에 표시:
- **Over**: 평균 gap < -0.5 (학생이 박하게 평가)
- **Under**: 평균 gap > +0.5 (학생이 후하게 평가)
- **Inconsistent**: gap 분산 > 1.0 (기준이 흔들림)

각 카드는 차원·진단·개선 제안·관련 IFCN 강령을 포함.

### v1(HPFM, 7차원) → v2(IPFM, 5차원) 변환

이전에 HPFM v1.0으로 누적된 D1~D7 차원 점수는 다음 변환식으로 IPFM v2.0의 C1~C5에 1:1 또는 평균으로 매핑됩니다 (`migrateLegacyDimensionScores`).

| 기존 7대 차원 점수 | 새 5대 차원 점수 변환 |
|-------------------|----------------------|
| D1 출처 권위성 | → **C3** 그대로 |
| D2 내용 정확성 | → **C4** 그대로 |
| D3 시의성 | → **C5** 그대로 |
| D4 근거 제시 + D7 검증 가능성 | → **C2** = (D4 + D7) / 2 |
| D5 편향성 + D6 언어 건전성 | → **C1** = (D5 + D6) / 2 |

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

## 🗄️ Firestore 데이터 구조 (IPFM-2.0)

```
users/{uid}
  role, email, displayName, createdAt, lastLogin
  checklists/{checklistId}
    checklistName
    version: "IPFM-2.0", standard_basis: "IFCN_5_principles"
    items[{ question, rubric{1..5},
            dimension (C1~C5 or C6), dimensionConfidence, dimensionMapKey,
            ifcn_principle? }]
  algorithm_model/current
    version: "IPFM-2.0", standard_basis: "IFCN_5_principles"
    weights: { C1:{mu,sigma}, ..., C5:{mu,sigma} }
    checklistId, trainingDataCount, learningRate
    convergenceScore
    teacherImplicitWeights: { C1:.., ..., C5:.. }
    trainedAt
    training_data/{dataId}
      mediaId, checklistId,
      studentDimensionScores, teacherDimensionScores, gap,
      source: "modeling" | "accept" | "refine"
  feedback_cards/{cardId}
    dimension, dimensionName, type, diagnosis, suggestion, framework, stats
  factcheck_history/{historyId}
    version: "IPFM-2.0", standard_basis: "IFCN_5_principles"
    media{title,content,link}, checklistId, checklistSnapshot,
    dimensionScores, dimensionReasons,
    weightsSnapshot, totalScore, variance, confidenceInterval95,
    accepted, refined, finalDimensionScores, finalTotalScore

media_items/{mediaId}
  title, content, link, thumbnailUrl, uploadedBy, createdAt
  teacher_evaluation/default
    items[{ question, score, dimension, dimensionConfidence, dimensionMapKey,
            ifcn_principle?, evidence? }]
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
| 교사 평가 | `/teacher/evaluate/:mediaId` | IFCN 5대 강령 기반 5개 디폴트 항목 1~5점 (저장 시 차원 자동 매핑) |
| 학생 대시보드 | `/student` | IFCN 5대 차원 가중치 + 수렴도 + 피드백 카드 |
| 체크리스트 | `/student/checklist` | 질문 + 1~5점 루브릭 (저장 시 IFCN 5차원 매핑) |
| 모델링 | `/student/modeling` | 미디어 평가 → 베이지안 갱신 |
| 팩트체크 | `/student/factcheck` | Gemini 5차원 평가 → 50점 + 신뢰구간 |
| 결과 | `/student/result/:historyId` | 5차원 표시 / 수용 / 정교화(η×1.5) |

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

## ✅ IPFM v2.0 변경 사항

- [x] 차원 수 7개(D1~D7) → 5개(C1~C5)로 정비, IFCN 5대 강령에 1:1 정렬
- [x] 미분류 폴백 차원 D8 → C6
- [x] 모델 버전 `HPFM-1.0` → `IPFM-2.0` (`standard_basis: IFCN_5_principles` 필드 추가)
- [x] Gemini 매핑/평가 프롬프트 IFCN 5대 강령 가이드로 교체
- [x] 교사 평가 디폴트 5개 항목을 IFCN 5강령 1:1 매핑 항목으로 교체
- [x] 가중치 정규화 분모, 수렴도 √n, 초기 μ=1/5 등 5차원 기준으로 자동 동작 (`DIMENSIONS.length`)
- [x] 50점 환산: 가중평균 × 10 (균등 가중치일 때 합산 × 2와 동일)
- [x] v1 → v2 차원 점수 마이그레이션 헬퍼 `migrateLegacyDimensionScores` 제공

---

## ✅ 개발 완료 체크리스트

- [x] 학생/교사 역할 분리 로그인
- [x] 교사 인증 코드 `0822` 검증
- [x] Firestore 사용자/체크리스트/미디어/모델 저장
- [x] 미디어 4가지(제목/본문/링크/썸네일) 등록
- [x] 교사 평가 항목 차원 자동 매핑 + 차원별 점수 캐시
- [x] 학생 1~5점 루브릭 체크리스트 CRUD + 차원 자동 매핑
- [x] **IPFM 베이지안 점진 학습** (μ, σ, 학습률 스케줄, 수렴도)
- [x] Gemini 두 모드 (map / evaluate) Netlify Function 프록시
- [x] IFCN 5대 차원 Gemini 평가 → 50점 환산 + 95% 신뢰구간
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
├─ netlify/functions/gemini.js            # Gemini 프록시 (map + evaluate, IFCN 5대 차원)
└─ src/
   ├─ main.jsx, App.jsx, index.css
   ├─ firebase.js
   ├─ contexts/AuthContext.jsx
   ├─ services/                           # auth, firestore, storage, gemini
   ├─ utils/
   │   ├─ hpfm.js                         # IPFM 코어 (5차원, 베이지안, 수렴도, 피드백, v1→v2 마이그레이션)
   │   └─ mappingCache.js                 # 차원 매핑 캐싱
   ├─ components/
   │   ├─ Button.jsx, Layout.jsx
   │   └─ Loading/                         # Spinner, LoadingOverlay, Skeleton
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                         # Dashboard, MediaUpload, Evaluation
       └─ student/                         # Dashboard, Checklist, Modeling, FactCheck, Result
```

---

## 🎓 교육적 의의

IPFM v2.0은 자동 평가 도구를 넘어 **학생이 자신의 비판적 사고 패턴을 정량화하고, 국제 표준(IFCN) 기준과 비교·조정하는 메타인지 학습 도구**로 작동합니다.

- **IFCN 5대 강령**: 전 세계 팩트체커들이 합의한 윤리·투명성 표준의 학생용 적용
- **베이지안 갱신**: 새 증거에 따라 신념을 업데이트하는 비판적 사고의 수학적 형식화
- **격차 분석**: 자기 인식과 메타인지의 정량적 도구
- **수렴도 추적**: 학습의 진보를 가시화

> 알고리즘 동작 원리에 대한 학생 친화적 설명은 [`ALGORITHM.md`](./ALGORITHM.md)를 참고하세요.
