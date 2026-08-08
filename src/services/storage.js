import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { storage } from "../firebase.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

async function uploadImage(file, uid, basePath, label) {
  if (!file) return "";
  const sizeMB = file.size / 1024 / 1024;
  console.log(
    `[${label}] file=${file.name} size=${sizeMB.toFixed(2)}MB type=${file.type}`
  );
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `이미지가 너무 큽니다 (${sizeMB.toFixed(1)}MB). 10MB 이하 이미지로 압축해주세요.`
    );
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`이미지 파일만 업로드할 수 있어요 (현재 형식: ${file.type || "알 수 없음"}).`);
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${basePath}/${uid}/${Date.now()}_${safeName}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}

/**
 * 미디어 자료 이미지 업로드 (교사 자료 · 모둠 자료 공통).
 * 경로는 storage.rules와 맞추기 위해 기존 `media_thumbnails/{uid}/`를 그대로 쓴다.
 * (규칙이 "본인 uid 경로에만 쓰기"라 조장이 올려도 그대로 통과한다.)
 */
export function uploadMediaImage(file, uid) {
  return uploadImage(file, uid, "media_thumbnails", "uploadMediaImage");
}

export function uploadFactCheckImage(file, studentUid) {
  return uploadImage(file, studentUid, "factcheck_images", "uploadFactCheckImage");
}
