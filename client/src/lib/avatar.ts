// Avatar helpers: client-side resize to a small JPEG data URL + localStorage cache.
// Keeping the encoded image tiny means it can ride along in the join payload and
// the room:state broadcast without a server upload endpoint. The server caps the
// data URL at 300_000 chars (see server/src/validation/schemas.ts); a 128px JPEG
// stays comfortably under that.

const AVATAR_PX = 128;
const AVATAR_QUALITY = 0.85;
const STORAGE_KEY = "takeTime.avatar";
/** Conservative client guard mirroring the server's 300_000-char cap. */
const MAX_DATA_URL_LEN = 300_000;

export const ACCEPTED_AVATAR_TYPES = "image/png,image/jpeg,image/jpg,image/webp";

/**
 * Reads an image File, cover-crops it to a centered square, scales to 128×128,
 * and returns a `data:image/jpeg;base64,…` URL. Rejects non-images and anything
 * that still encodes too large to send.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片");

    // Cover-crop: take the largest centered square of the source.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);

    const dataUrl = canvas.toDataURL("image/jpeg", AVATAR_QUALITY);
    if (dataUrl.length > MAX_DATA_URL_LEN) {
      throw new Error("图片过大，请换一张");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = src;
  });
}

/** Remembers the avatar on this device so the user need not re-upload each login. */
export function loadStoredAvatar(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAvatar(dataUrl: string | null): void {
  try {
    if (dataUrl) window.localStorage.setItem(STORAGE_KEY, dataUrl);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore (private mode / quota) — avatar simply won't persist
  }
}
