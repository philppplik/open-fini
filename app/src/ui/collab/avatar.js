// Avatars of room members (initials or a picture). Its own small module: the Collaboration window renders them
// without loading the collaboration runtime.
//
// Public API: avatarEl(profile, size, { own, onReady }) → HTMLElement
import { h } from "../../core/util.js";
import { LIMITS } from "../../collab/protocol.js";

// Avatars from other members are untrusted images: they are decoded and drawn again into a fresh 64 px PNG before they
// are shown, so only plain pixels reach the page (no metadata, no unusual encodings). Until then initials are shown.
const safeAvatars = new Map(); // received data URL → re-encoded data URL ("" when it failed)
async function reencodeAvatar(url) {
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size > LIMITS.avatarChars || !/^image\/(png|webp|jpeg)$/.test(blob.type)) throw new Error("bad avatar");
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const s = Math.max(64 / bmp.width, 64 / bmp.height);
    c.getContext("2d").drawImage(bmp, (64 - bmp.width * s) / 2, (64 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    bmp.close?.();
    return c.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** Renders a small avatar (initials or image) for a profile. `own` marks my own avatar (already re-encoded when set). */
export function avatarEl(profile, size = 28, { own = false, onReady } = {}) {
  const p = profile || {};
  const el = h("span.of-collab-avatar", { style: `--of-collab-color:${/^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "#888888"};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`, "aria-hidden": "true" });
  el.textContent = p.initials || "?";
  if (p.avatar) {
    const show = (src) => src && el.replaceChildren(h("img", { src, alt: "", draggable: "false" }));
    if (own) show(p.avatar);
    else if (safeAvatars.has(p.avatar)) show(safeAvatars.get(p.avatar));
    else {
      safeAvatars.set(p.avatar, "");
      reencodeAvatar(p.avatar).then((src) => {
        if (safeAvatars.size > 200) safeAvatars.clear();
        safeAvatars.set(p.avatar, src);
        show(src);
        onReady?.();
      });
    }
  }
  return el;
}
