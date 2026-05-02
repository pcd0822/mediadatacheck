import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { storage } from "../firebase.js";

const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024; // 10MB

export async function uploadThumbnail(file, teacherUid) {
  if (!file) return "";
  const sizeMB = file.size / 1024 / 1024;
  console.log(
    `[uploadThumbnail] file=${file.name} size=${sizeMB.toFixed(2)}MB type=${file.type}`
  );
  if (file.size > MAX_THUMBNAIL_BYTES) {
    throw new Error(
      `썸네일 이미지가 너무 큽니다 (${sizeMB.toFixed(1)}MB). 10MB 이하 이미지로 압축해주세요.`
    );
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`이미지 파일만 업로드할 수 있어요 (현재 형식: ${file.type || "알 수 없음"}).`);
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `media_thumbnails/${teacherUid}/${Date.now()}_${safeName}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}
