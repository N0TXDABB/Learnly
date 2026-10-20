// Getting a photo ready for the local model: phone photos are shrunk to at most 1600 px on the
// long side and re-encoded as JPEG. Smaller photos upload faster and vision models read them
// just as well (they downscale internally anyway).

const MAX_SIDE = 1600;

/** Returns { b64, dataUrl, width, height } for an image File/Blob, or throws an Error with a friendly message. */
export async function prepareImage(file, { maxSide = MAX_SIDE, quality = 0.88 } = {}) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("That file isn't a photo.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name) ? "This browser can't open HEIC photos. Share the photo as JPEG, or take it with the camera button." : "That photo couldn't be opened.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs (screenshots) become white, not black, in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { b64: dataUrl.split(",")[1], dataUrl, width, height };
}

/** The first image in a paste or drop event, or null. */
export function imageFromTransfer(dataTransfer) {
  if (!dataTransfer) return null;
  for (const item of dataTransfer.items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  for (const file of dataTransfer.files || []) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}
