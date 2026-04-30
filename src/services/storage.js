import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { storage } from "../firebase.js";

export async function uploadThumbnail(file, teacherUid) {
  if (!file) return "";
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `media_thumbnails/${teacherUid}/${Date.now()}_${safeName}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  return await getDownloadURL(ref);
}
