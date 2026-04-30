# 미디어 리터러시 · 팩트체크 학습 플랫폼

중·고등학생이 직접 **팩트체크 체크리스트를 설계**하고, 그것을 기반으로 한
**HPFM(Hybrid Progressive Fact-Check Model)** 으로 미디어 자료를 평가·정교화하는 AI 활용 탐구형 학습 플랫폼.

> 학생 학습 흐름  
> ① 체크리스트 만들기 → ② 교사 등록 미디어를 평가해 베이지안 가중치 학습 → ③ 새 미디어를 Gemini로 7차원 평가 → ④ 50점 환산 + 신뢰구간 → ⑤ 수용(σ↓) 또는 정교화(η×1.5)

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

## 🧠 HPFM 알고리즘 (Hybrid Progressive Fact-Check Model)

학생의 **개인화된 체크리스트** + **국제 팩트체킹 표준 7대 차원** + **베이지안 점진 학습**을 결합한 교육용 모델.

### 7대 표준 차원

| 코드 | 차원 | 기반 프레임워크 |
|---|---|---|
| D1 | 출처 권위성 (Authority) | CRAAP · SIFT-Investigate |
| D2 | 내용 정확성 (Accuracy) | CRAAP · FEVER-Verdict |
| D3 | 시의성 (Currency) | CRAAP |
| D4 | 근거 제시 (Evidence) | FEVER-Retrieval · SIFT-Trace |
| D5 | 편향성·목적 (Bias/Purpose) | CRAAP · IFCN |
| D6 | 언어 건전성 (Language) | IFCN |
| D7 | 검증 가능성 (Verifiability) | FEVER · IFCN |
| (D8) | 사용자 정의 (어디에도 매핑되지 않은 항목) | — |

### 7층 아키텍처

```
Layer 7 · 최종 점수(50점) + 95% 신뢰구간
Layer 6 · 베이지안 가중치 갱신 (μ, σ)
Layer 5 · 교사 격차 분석 + 메타인지 피드백 카드
Layer 4 · 학생 가중치 적용
Layer 3 · 7대 차원 Gemini 평가 (단일 호출 7개 결과)
Layer 2 · 체크리스트 → 7대 차원 자동 매핑 (캐싱)
Layer 1 · 학생 커스텀 체크리스트
```

### 핵심 수식 (`src/utils/hpfm.js`)

```text
사전(Prior):  W = { Di: { mu, sigma } }, Σ μ_i = 1
관측(Obs):    (D_i_score, gap_i = teacher_i - student_i)
갱신(Update): w_i^(t+1) = w_i^(t) + η · gap_i · D_i_score / Σ(D_j_score²)
              η(t) = max(0.05, 0.2 · exp(-0.05 · t))
              σ_i^(t+1) = max(0.02, σ_i^(t) · 0.95)
정규화:        μ_i ← μ_i / Σ μ_j

50점 점수:    S = (Σ μ_i · D_i_score) · 10
점수 분산:    Var(S) = 100 · Σ D_i_score² · σ_i²
95% 신뢰구간: S ± 1.96 · √Var(S)

수렴도:       1 - ||W_student - W_teacher_implicit|| / √7   (0~1)
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

각 카드는 차원·진단·개선 제안·관련 표준 프레임워크를 포함.

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

## 🗄️ Firestore 데이터 구조 (HPFM-1.0)

```
users/{uid}
  role, email, displayName, createdAt, lastLogin
  checklists/{checklistId}
    checklistName
    items[{ question, rubric{1..5},
            dimension, dimensionConfidence, dimensionMapKey }]
  algorithm_model/current
    version: "HPFM-1.0"
    weights: { D1:{mu,sigma}, ..., D7:{mu,sigma} }
    checklistId, trainingDataCount, learningRate
    convergenceScore
    teacherImplicitWeights: { D1:.., ..., D7:.. }
    trainedAt
    training_data/{dataId}
      mediaId, checklistId,
      studentDimensionScores, teacherDimensionScores, gap,
      source: "modeling" | "accept" | "refine"
  feedback_cards/{cardId}
    dimension, dimensionName, type, diagnosis, suggestion, framework, stats
  factcheck_history/{historyId}
    media{title,content,link}, checklistId, checklistSnapshot,
    dimensionScores, dimensionReasons,
    weightsSnapshot, totalScore, variance, confidenceInterval95,
    accepted, refined, finalDimensionScores, finalTotalScore

media_items/{mediaId}
  title, content, link, thumbnailUrl, uploadedBy, createdAt
  teacher_evaluation/default
    items[{ question, score, dimension, dimensionConfidence, dimensionMapKey }]
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
| 교사 평가 | `/teacher/evaluate/:mediaId` | 항목별 1~5점 (저장 시 차원 자동 매핑) |
| 학생 대시보드 | `/student` | 7차원 가중치 + 수렴도 + 피드백 카드 |
| 체크리스트 | `/student/checklist` | 질문 + 1~5점 루브릭 (저장 시 차원 매핑) |
| 모델링 | `/student/modeling` | 미디어 평가 → 베이지안 갱신 |
| 팩트체크 | `/student/factcheck` | Gemini 7차원 평가 → 50점 + 신뢰구간 |
| 결과 | `/student/result/:historyId` | 7차원 표시 / 수용 / 정교화(η×1.5) |

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

## ✅ 개발 완료 체크리스트

- [x] 학생/교사 역할 분리 로그인
- [x] 교사 인증 코드 `0822` 검증
- [x] Firestore 사용자/체크리스트/미디어/모델 저장
- [x] 미디어 4가지(제목/본문/링크/썸네일) 등록
- [x] 교사 평가 항목 차원 자동 매핑 + 차원별 점수 캐시
- [x] 학생 1~5점 루브릭 체크리스트 CRUD + 차원 자동 매핑
- [x] **HPFM 베이지안 점진 학습** (μ, σ, 학습률 스케줄, 수렴도)
- [x] Gemini 두 모드 (map / evaluate) Netlify Function 프록시
- [x] 7대 차원 Gemini 평가 → 50점 환산 + 95% 신뢰구간
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
├─ netlify/functions/gemini.js          # Gemini 프록시 (map + evaluate)
└─ src/
   ├─ main.jsx, App.jsx, index.css
   ├─ firebase.js
   ├─ contexts/AuthContext.jsx
   ├─ services/                          # auth, firestore, storage, gemini
   ├─ utils/
   │   ├─ hpfm.js                        # HPFM 코어 (베이지안, 수렴도, 피드백)
   │   └─ mappingCache.js                # 차원 매핑 캐싱
   ├─ components/
   │   ├─ Button.jsx, Layout.jsx
   │   └─ Loading/                        # Spinner, LoadingOverlay, Skeleton
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                        # Dashboard, MediaUpload, Evaluation
       └─ student/                        # Dashboard, Checklist, Modeling, FactCheck, Result
```

---

## 🎓 교육적 의의

HPFM은 자동 평가 도구를 넘어 **학생이 자신의 비판적 사고 패턴을 정량화하고, 전문가 기준과 비교·조정하는 메타인지 학습 도구**로 작동한다.

- **CRAAP / SIFT / IFCN / FEVER**: 미디어 리터러시의 정통 프레임워크 학습
- **베이지안 갱신**: 새 증거에 따라 신념을 업데이트하는 비판적 사고의 수학적 형식화
- **격차 분석**: 자기 인식과 메타인지의 정량적 도구
- **수렴도 추적**: 학습의 진보를 가시화
