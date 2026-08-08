#!/usr/bin/env node
/**
 * VAPM v4.0 → v5.0 평가 데이터 초기화 스크립트 (관리자 전용)
 *
 * 계산 방식이 v5.0(체크리스트 항목 채점)으로 바뀌면서 기존 평가 데이터가 더 이상
 * 유효하지 않다. 이 스크립트는 **학생·모둠이 작성한 체크리스트를 보존한 채**
 * 나머지 평가 데이터와 미디어 자료를 초기화한다.
 *
 * ── 보존 ───────────────────────────────────────────────────────────
 *   users/{uid}                          계정 문서 자체 (role, groups 맵 등)
 *   users/{uid}/checklists               문항·루브릭·지표 분류·매핑 캐시
 *   groups/{gid}                         모둠 문서 자체 (조장, 공유코드 등)
 *   groups/{gid}/checklists              모둠 체크리스트
 *   groups/{gid}/members                 모둠원 명단
 *   config/teacher                       교사 인증 코드 게이트
 *
 *   ※ "질문 → 지표 매핑 캐시"는 별도 컬렉션이 아니라 체크리스트 **항목 안의**
 *      dimension / dimensionConfidence / dimensionReason / dimensionMapKey
 *      필드로 저장된다(src/utils/mappingCache.js 참고). 체크리스트를 보존하면
 *      매핑도 함께 보존되므로 재분류 API 호출이 발생하지 않는다.
 *
 * ── 삭제 ───────────────────────────────────────────────────────────
 *   media_items                          (하위 teacher_evaluation, student_evaluations 포함)
 *   users/{uid}/factcheck_history        · groups/{gid}/factcheck_history
 *   users/{uid}/algorithm_model          · groups/{gid}/algorithm_model  (training_data 포함)
 *   users/{uid}/feedback_cards           · groups/{gid}/feedback_cards
 *   groups/{gid}/factcheck_runs
 *   Storage: media_thumbnails 이하 전체, factcheck_images 이하 전체
 *
 * ── 안전장치 ────────────────────────────────────────────────────────
 *   1. --dry-run 이 **기본값**. 실제 삭제는 --confirm 을 명시해야만 실행된다.
 *   2. --confirm 시에도 삭제 직전에 **JSON 백업이 반드시 먼저** 수행된다.
 *      백업이 하나라도 실패하면 삭제를 시작하지 않는다.
 *   3. Firestore 문서 삭제는 서브컬렉션을 지우지 않으므로 recursiveDelete를 쓴다.
 *   4. 보존 경로(checklists/members)가 삭제 대상에 섞이면 실행을 중단한다(assertSafe).
 *
 * 사용법은 README의 "🧹 v5.0 데이터 초기화" 절 참고.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// ⚠️ ESM에서는 `import admin from "firebase-admin"` 의 default가 app 네임스페이스만 담고 있어
//    admin.firestore / admin.storage / admin.credential 이 전부 undefined다.
//    반드시 모듈러 서브패스(firebase-admin/app, /firestore, /storage)를 써야 한다.
import { cert, initializeApp } from "firebase-admin/app";
import {
  DocumentReference,
  GeoPoint,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/* ===================== 삭제 대상 정의 (단일 출처) =====================
 * 여기에 없는 경로는 절대 삭제되지 않는다. 새 컬렉션을 지우려면 여기에만 추가한다.
 */

/** 루트 컬렉션 전체 삭제 대상 */
const ROOT_COLLECTIONS = ["media_items"];

/** users/{uid} 아래에서 삭제할 서브컬렉션 */
const USER_SUBCOLLECTIONS = [
  "factcheck_history",
  "algorithm_model", // 하위 training_data 포함 (recursiveDelete)
  "feedback_cards",
];

/** groups/{groupId} 아래에서 삭제할 서브컬렉션 */
const GROUP_SUBCOLLECTIONS = [
  "factcheck_history",
  "algorithm_model",
  "feedback_cards",
  "factcheck_runs",
];

/** Storage에서 삭제할 prefix */
const STORAGE_PREFIXES = ["media_thumbnails/", "factcheck_images/"];

/**
 * 절대 삭제 대상이 될 수 없는 컬렉션 이름. assertSafe()가 **삭제 대상 경로의 마지막
 * 세그먼트**(= 실제로 recursiveDelete가 지울 컬렉션)를 이 목록과 대조한다.
 * `users`/`groups`가 들어 있는 이유: 실수로 루트 계정 컬렉션 전체를 넣는 사고를 막기 위함.
 * (`users/{uid}/factcheck_history`처럼 중간에 users가 오는 건 정상이므로 마지막만 본다)
 */
const PROTECTED_COLLECTIONS = ["checklists", "members", "config", "users", "groups"];

/* ===================== CLI 파싱 ===================== */

function parseArgs(argv) {
  const args = {
    confirm: false,
    key: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
    bucket: process.env.FIREBASE_STORAGE_BUCKET || null,
    out: null,
    withFiles: false,
    skipStorage: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--confirm") args.confirm = true;
    else if (a === "--dry-run") args.confirm = false;
    else if (a === "--with-files") args.withFiles = true;
    else if (a === "--skip-storage") args.skipStorage = true;
    else if (a === "--key") args.key = argv[++i];
    else if (a === "--bucket") args.bucket = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.error(`알 수 없는 옵션: ${a}`);
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
VAPM v5.0 평가 데이터 초기화 스크립트

  node scripts/reset-v5.mjs [옵션]

옵션
  --key <path>       서비스 계정 JSON 경로 (또는 GOOGLE_APPLICATION_CREDENTIALS 환경변수)
  --bucket <name>    Storage 버킷 이름 (기본: <projectId>.firebasestorage.app 추정)
  --dry-run          삭제 예정 건수만 출력 (기본값)
  --confirm          실제로 백업 후 삭제 실행
  --out <dir>        백업 폴더 (기본: ./backups/reset-v5-<타임스탬프>)
  --with-files       Storage 이미지 원본까지 백업 폴더로 내려받음 (용량 주의)
  --skip-storage     Storage는 건드리지 않음 (Firestore만 처리)
  -h, --help         이 도움말

⚠️  --with-files 없이 실행하면 Storage 이미지는 파일 목록(JSON)만 남고
    원본은 복구할 수 없습니다. 사진을 보관하려면 반드시 --with-files 를 붙이세요.
`);
}

/* ===================== 초기화 ===================== */

async function initAdmin(args) {
  if (!args.key) {
    throw new Error(
      "서비스 계정 키가 필요합니다. --key <path> 또는 GOOGLE_APPLICATION_CREDENTIALS 환경변수를 지정하세요.\n" +
        "  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성"
    );
  }
  const raw = await readFile(path.resolve(args.key), "utf8").catch(() => {
    throw new Error(`서비스 계정 키를 읽을 수 없습니다: ${args.key}`);
  });
  let credential;
  try {
    credential = JSON.parse(raw);
  } catch {
    throw new Error(`서비스 계정 키가 올바른 JSON이 아닙니다: ${args.key}`);
  }
  if (!credential.project_id) {
    throw new Error("서비스 계정 키에 project_id가 없습니다.");
  }

  const bucketName =
    args.bucket ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    `${credential.project_id}.firebasestorage.app`;

  initializeApp({
    credential: cert(credential),
    storageBucket: bucketName,
  });

  return { projectId: credential.project_id, bucketName };
}

/* ===================== 안전장치 ===================== */

/**
 * 삭제 대상에 보존 컬렉션이 섞여 있으면 즉시 중단한다.
 * 컬렉션 경로는 세그먼트 수가 홀수(col / col/doc/col / ...)이고,
 * **마지막 세그먼트**가 실제로 지워질 컬렉션 이름이다.
 */
function assertSafe(targets) {
  for (const t of targets) {
    const segments = t.path.split("/");
    if (segments.length % 2 === 0) {
      throw new Error(`[안전장치] 컬렉션 경로가 아닙니다: ${t.path}`);
    }
    const leaf = segments[segments.length - 1];
    if (PROTECTED_COLLECTIONS.includes(leaf)) {
      throw new Error(
        `[안전장치] 보존 대상이 삭제 목록에 있습니다: ${t.path}\n` +
          `PROTECTED_COLLECTIONS=${PROTECTED_COLLECTIONS.join(", ")}`
      );
    }
  }
}

/* ===================== 스캔 (재귀 카운트 + 내보내기) ===================== */

/**
 * 문서 하나를 서브컬렉션까지 재귀적으로 읽어 { path, data, sub } 트리로 만든다.
 * 동시에 문서 수를 센다.
 */
async function exportDoc(docRef) {
  const snap = await docRef.get();
  const node = {
    path: docRef.path,
    id: docRef.id,
    exists: snap.exists,
    data: snap.exists ? serialize(snap.data()) : null,
    subcollections: {},
  };
  let count = snap.exists ? 1 : 0;

  const subs = await docRef.listCollections();
  for (const sub of subs) {
    const { docs, count: subCount } = await exportCollection(sub);
    node.subcollections[sub.id] = docs;
    count += subCount;
  }
  return { node, count };
}

async function exportCollection(colRef) {
  const snap = await colRef.get();
  const docs = [];
  let count = 0;
  for (const d of snap.docs) {
    const { node, count: c } = await exportDoc(d.ref);
    docs.push(node);
    count += c;
  }
  // 서브컬렉션만 있고 문서 본체가 없는 "고아 문서"도 잡아낸다.
  // (Firestore는 하위 컬렉션만 있어도 상위 문서 ID가 목록에 나타난다)
  const listed = await colRef.listDocuments();
  const seen = new Set(snap.docs.map((d) => d.id));
  for (const ref of listed) {
    if (seen.has(ref.id)) continue;
    const { node, count: c } = await exportDoc(ref);
    docs.push(node);
    count += c;
  }
  return { docs, count };
}

/** Firestore Timestamp / GeoPoint / DocumentReference 등을 JSON 가능한 형태로. */
function serialize(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) {
    return { __type__: "timestamp", iso: value.toDate().toISOString() };
  }
  if (value instanceof GeoPoint) {
    return { __type__: "geopoint", lat: value.latitude, lng: value.longitude };
  }
  if (value instanceof DocumentReference) {
    return { __type__: "ref", path: value.path };
  }
  if (Buffer.isBuffer(value)) {
    return { __type__: "bytes", base64: value.toString("base64") };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

/**
 * 삭제 대상 목록을 만든다. 각 항목은 { kind, path, ref, count }.
 * kind: "collection" | "storage"
 */
async function buildTargets(db) {
  const targets = [];

  // 1) 루트 컬렉션
  for (const name of ROOT_COLLECTIONS) {
    const ref = db.collection(name);
    const { docs, count } = await exportCollection(ref);
    targets.push({ kind: "collection", path: name, ref, count, docs });
  }

  // 2) users/{uid}/<서브컬렉션>
  const userRefs = await db.collection("users").listDocuments();
  for (const userRef of userRefs) {
    for (const name of USER_SUBCOLLECTIONS) {
      const ref = userRef.collection(name);
      const { docs, count } = await exportCollection(ref);
      if (count === 0) continue; // 빈 경로는 목록에서 생략
      targets.push({ kind: "collection", path: ref.path, ref, count, docs });
    }
  }

  // 3) groups/{groupId}/<서브컬렉션>
  const groupRefs = await db.collection("groups").listDocuments();
  for (const groupRef of groupRefs) {
    for (const name of GROUP_SUBCOLLECTIONS) {
      const ref = groupRef.collection(name);
      const { docs, count } = await exportCollection(ref);
      if (count === 0) continue;
      targets.push({ kind: "collection", path: ref.path, ref, count, docs });
    }
  }

  return { targets, userCount: userRefs.length, groupCount: groupRefs.length };
}

/** Storage prefix별 파일 목록/용량 스캔 */
async function buildStorageTargets(bucket) {
  const out = [];
  for (const prefix of STORAGE_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix });
    out.push({
      kind: "storage",
      path: `gs://${bucket.name}/${prefix}`,
      prefix,
      count: files.length,
      bytes: files.reduce((s, f) => s + Number(f.metadata?.size ?? 0), 0),
      files,
    });
  }
  return out;
}

/* ===================== 보존 대상 확인 (안심용 출력) ===================== */

async function countPreserved(db) {
  const userRefs = await db.collection("users").listDocuments();
  const groupRefs = await db.collection("groups").listDocuments();

  let userChecklists = 0;
  let userChecklistItems = 0;
  let mappedItems = 0;
  for (const u of userRefs) {
    const snap = await u.collection("checklists").get();
    userChecklists += snap.size;
    for (const d of snap.docs) {
      const items = d.data().items ?? [];
      userChecklistItems += items.length;
      mappedItems += items.filter((it) => it?.dimensionMapKey).length;
    }
  }

  let groupChecklists = 0;
  let groupChecklistItems = 0;
  let groupMembers = 0;
  for (const g of groupRefs) {
    const snap = await g.collection("checklists").get();
    groupChecklists += snap.size;
    for (const d of snap.docs) {
      const items = d.data().items ?? [];
      groupChecklistItems += items.length;
      mappedItems += items.filter((it) => it?.dimensionMapKey).length;
    }
    const mem = await g.collection("members").get();
    groupMembers += mem.size;
  }

  return {
    users: userRefs.length,
    groups: groupRefs.length,
    userChecklists,
    userChecklistItems,
    groupChecklists,
    groupChecklistItems,
    groupMembers,
    mappedItems,
  };
}

/* ===================== 백업 ===================== */

async function backup(outDir, { projectId, bucketName, targets, storageTargets, preserved, args }) {
  await mkdir(outDir, { recursive: true });

  const manifest = {
    script: "reset-v5.mjs",
    purpose: "VAPM v4.0 → v5.0 평가 데이터 초기화 전 백업",
    projectId,
    bucketName,
    createdAt: new Date().toISOString(),
    preserved,
    firestore: targets.map((t) => ({ path: t.path, docCount: t.count })),
    storage: storageTargets.map((s) => ({
      prefix: s.prefix,
      fileCount: s.count,
      bytes: s.bytes,
      downloaded: args.withFiles,
    })),
  };

  // 1) Firestore 데이터 — 경로별로 파일 분리 (한 파일이 지나치게 커지지 않도록)
  const fsDir = path.join(outDir, "firestore");
  await mkdir(fsDir, { recursive: true });
  for (const t of targets) {
    const safeName = t.path.replaceAll("/", "__") + ".json";
    await writeFile(
      path.join(fsDir, safeName),
      JSON.stringify({ path: t.path, docCount: t.count, docs: t.docs }, null, 2),
      "utf8"
    );
    console.log(`   백업 → firestore/${safeName}  (${t.count}건)`);
  }

  // 2) Storage 파일 목록 (항상) + 원본 (--with-files)
  const stDir = path.join(outDir, "storage");
  await mkdir(stDir, { recursive: true });
  for (const s of storageTargets) {
    const listing = s.files.map((f) => ({
      name: f.name,
      size: Number(f.metadata?.size ?? 0),
      contentType: f.metadata?.contentType ?? null,
      updated: f.metadata?.updated ?? null,
      // 삭제 후에는 무효가 되는 값이지만, 어떤 문서가 어떤 파일을 가리켰는지 추적용
      mediaLink: f.metadata?.mediaLink ?? null,
    }));
    const safeName = s.prefix.replaceAll("/", "_").replace(/_$/, "") + ".json";
    await writeFile(
      path.join(stDir, safeName),
      JSON.stringify({ prefix: s.prefix, fileCount: s.count, files: listing }, null, 2),
      "utf8"
    );
    console.log(`   백업 → storage/${safeName}  (${s.count}개 파일 목록)`);

    if (args.withFiles && s.files.length) {
      const filesDir = path.join(stDir, "files");
      let done = 0;
      for (const f of s.files) {
        const dest = path.join(filesDir, f.name);
        await mkdir(path.dirname(dest), { recursive: true });
        await pipeline(f.createReadStream(), createWriteStream(dest));
        done += 1;
        if (done % 20 === 0 || done === s.files.length) {
          console.log(`   내려받는 중 ${s.prefix} ${done}/${s.files.length}`);
        }
      }
    }
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return manifest;
}

/* ===================== 삭제 ===================== */

async function deleteTargets(db, targets) {
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((err) => {
    if (err.failedAttempts < 5) return true; // 재시도
    console.error(`   삭제 실패(재시도 초과): ${err.documentRef.path} — ${err.message}`);
    return false;
  });

  for (const t of targets) {
    process.stdout.write(`   삭제 중 ${t.path} (${t.count}건) ... `);
    // recursiveDelete는 하위 서브컬렉션까지 전부 지운다.
    // (문서 delete()만으로는 서브컬렉션이 남아 고아 데이터가 된다)
    await db.recursiveDelete(t.ref, bulkWriter);
    console.log("완료");
  }
  await bulkWriter.close();
}

async function deleteStorage(bucket, storageTargets) {
  for (const s of storageTargets) {
    if (s.count === 0) {
      console.log(`   건너뜀 ${s.prefix} (파일 없음)`);
      continue;
    }
    process.stdout.write(`   삭제 중 ${s.prefix} (${s.count}개) ... `);
    await bucket.deleteFiles({ prefix: s.prefix, force: true });
    console.log("완료");
  }
}

/* ===================== 출력 헬퍼 ===================== */

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function printTable(targets, storageTargets) {
  const rows = [
    ...targets.map((t) => [t.path, String(t.count), "문서"]),
    ...storageTargets.map((s) => [s.prefix, String(s.count), `파일 (${fmtBytes(s.bytes)})`]),
  ];
  if (rows.length === 0) {
    console.log("   (삭제할 데이터가 없습니다)");
    return;
  }
  const w0 = Math.max(...rows.map((r) => r[0].length), 4);
  const w1 = Math.max(...rows.map((r) => r[1].length), 2);
  console.log(`   ${"경로".padEnd(w0)}  ${"수".padStart(w1)}  단위`);
  console.log(`   ${"-".repeat(w0)}  ${"-".repeat(w1)}  ----`);
  for (const r of rows) {
    console.log(`   ${r[0].padEnd(w0)}  ${r[1].padStart(w1)}  ${r[2]}`);
  }
}

/* ===================== 메인 ===================== */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const { projectId, bucketName } = await initAdmin(args);
  const db = getFirestore();
  const bucket = args.skipStorage ? null : getStorage().bucket();

  console.log("");
  console.log("═".repeat(64));
  console.log("  VAPM v5.0 평가 데이터 초기화");
  console.log("═".repeat(64));
  console.log(`  Firebase 프로젝트 : ${projectId}`);
  console.log(`  Storage 버킷      : ${args.skipStorage ? "(건너뜀)" : bucketName}`);
  console.log(`  모드              : ${args.confirm ? "⚠️  실제 삭제 (--confirm)" : "🔍 DRY RUN (기본값)"}`);
  console.log("");

  console.log("▶ 데이터 스캔 중...");
  const { targets, userCount, groupCount } = await buildTargets(db);
  const storageTargets = bucket ? await buildStorageTargets(bucket) : [];

  assertSafe(targets); // 보존 경로가 섞이면 여기서 중단

  const preserved = await countPreserved(db);

  console.log("");
  console.log("── 보존 (건드리지 않음) ─────────────────────────────────");
  console.log(`   users 계정 문서                : ${preserved.users}개`);
  console.log(`   groups 모둠 문서               : ${preserved.groups}개`);
  console.log(`   groups/*/members               : ${preserved.groupMembers}개`);
  console.log(`   users/*/checklists             : ${preserved.userChecklists}개 (항목 ${preserved.userChecklistItems}개)`);
  console.log(`   groups/*/checklists            : ${preserved.groupChecklists}개 (항목 ${preserved.groupChecklistItems}개)`);
  console.log(`   └ 지표 매핑이 붙은 항목        : ${preserved.mappedItems}개  ← 재분류 API 호출 불필요`);
  console.log(`   config/teacher                 : 교사 인증 코드 유지`);

  console.log("");
  console.log("── 삭제 대상 ────────────────────────────────────────────");
  printTable(targets, storageTargets);

  const totalDocs = targets.reduce((s, t) => s + t.count, 0);
  const totalFiles = storageTargets.reduce((s, t) => s + t.count, 0);
  const totalBytes = storageTargets.reduce((s, t) => s + t.bytes, 0);
  console.log("");
  console.log(`   합계: Firestore 문서 ${totalDocs}건 · Storage 파일 ${totalFiles}개 (${fmtBytes(totalBytes)})`);
  console.log(`   (스캔한 워크스페이스: 개인 ${userCount}개, 모둠 ${groupCount}개)`);
  console.log("");

  if (!args.confirm) {
    console.log("─".repeat(64));
    console.log("  DRY RUN 이므로 아무것도 삭제하지 않았습니다.");
    console.log("  실제로 삭제하려면 --confirm 을 붙여 다시 실행하세요:");
    console.log("");
    console.log(`     node scripts/reset-v5.mjs --key <키경로> --confirm --with-files`);
    console.log("");
    console.log("  --confirm 을 붙이면 삭제 직전에 JSON 백업이 먼저 수행됩니다.");
    console.log("─".repeat(64));
    return;
  }

  if (totalDocs === 0 && totalFiles === 0) {
    console.log("삭제할 데이터가 없습니다. 종료합니다.");
    return;
  }

  // ── 백업 (삭제보다 반드시 먼저) ──
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, "backups", `reset-v5-${stamp}`);

  console.log("▶ 1/2 백업 중...");
  console.log(`   위치: ${outDir}`);
  if (!args.withFiles && totalFiles > 0) {
    console.log("   ⚠️  --with-files 가 없어 이미지 원본은 내려받지 않습니다(목록만 백업).");
  }
  await backup(outDir, { projectId, bucketName, targets, storageTargets, preserved, args });
  console.log("   백업 완료");
  console.log("");

  // ── 삭제 ──
  console.log("▶ 2/2 삭제 중...");
  await deleteTargets(db, targets);
  if (bucket) await deleteStorage(bucket, storageTargets);

  console.log("");
  console.log("═".repeat(64));
  console.log("  초기화 완료");
  console.log(`  백업: ${outDir}`);
  console.log("");
  console.log("  다음 단계:");
  console.log("   1. firebase deploy --only firestore:rules   (아직 안 했다면)");
  console.log("   2. 교사 계정으로 로그인해 v5.0 스키마로 미디어 자료 재등록");
  console.log("   3. 학생은 보존된 체크리스트로 바로 팩트체크 가능");
  console.log("═".repeat(64));
}

// CLI로 직접 실행할 때만 동작한다. 테스트에서 순수 함수만 import할 수 있도록 분리.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("");
      console.error("✖ 실행 중 오류가 발생했습니다.");
      console.error(`  ${err.message}`);
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    });
}

export {
  ROOT_COLLECTIONS,
  USER_SUBCOLLECTIONS,
  GROUP_SUBCOLLECTIONS,
  STORAGE_PREFIXES,
  PROTECTED_COLLECTIONS,
  assertSafe,
  backup,
  buildTargets,
  countPreserved,
  deleteTargets,
  exportCollection,
  exportDoc,
  fmtBytes,
  parseArgs,
  serialize,
};
