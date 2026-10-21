// Settings ▸ Profile and collaboration: local identity (nickname, color, avatar), room options and the security facts.
// The section definition is small and loads with the settings dialog; the profile editor itself is plain DOM and only
// loads the collaboration runtime when the avatar is changed. None of these values are part of exported profiles
// (.ofprofile): customize/schema.js does not list them, and invite codes are never stored at all.
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { COLORS, LIMITS, initialsOf } from "../../collab/protocol.js";

const sw = (key, label, hint) => ({ type: "switch", key, label, hint });

/** Draws an image file into a ≤128 px square and returns a small data URL (WebP when it fits, else PNG). */
export async function downscaleAvatar(file, max = 128) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const hgt = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  c.getContext("2d").drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  for (const [type, q] of [["image/webp", 0.85], ["image/webp", 0.6], ["image/jpeg", 0.7], ["image/png"]]) {
    const url = c.toDataURL(type, q);
    if (url.startsWith(`data:${type}`) && url.length <= LIMITS.avatarChars) return url;
  }
  throw new Error(t("The picture is too detailed. Try a simpler image."));
}

function profileEditor(app, rerender) {
  const nick = app.prefs.collabNick || "";
  const color = app.prefs.collabColor || "";
  const runtime = () => import("./runtime.js").then((m) => m.getCollab(app));
  const preview = h("span.of-collab-avatar", { style: `--of-collab-color:${color || "#6e56cf"};width:48px;height:48px;font-size:19px`, "aria-hidden": "true" }, initialsOf(nick || t("Guest")));
  runtime().then(async (c) => {
    await c.ready;
    const { avatarEl } = await import("./runtime.js");
    preview.replaceWith(avatarEl(c.profile(), 48, { own: true }));
  });
  const input = h("input.of-collab-input", { value: nick, maxLength: LIMITS.nick, placeholder: t("Your name"), "aria-label": t("Nickname") });
  input.addEventListener("change", async () => {
    app.setPref("collabNick", input.value.trim().slice(0, LIMITS.nick));
    (await runtime()).profileChanged();
    rerender();
  });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  const swatches = h("div.of-collab-swatches", { role: "group", "aria-label": t("Presence color") });
  for (const col of ["", ...COLORS]) {
    const b = h("button.of-collab-swatch", { type: "button", style: `--of-collab-color:${col || "conic-gradient(#e5484d,#ffc53d,#46a758,#0090ff,#6e56cf,#e5484d)"}`, title: col ? col : t("Automatic (from the nickname)"), "aria-label": col ? col : t("Automatic (from the nickname)"), "aria-pressed": String(col === color) });
    if (!col) b.style.background = "conic-gradient(#e5484d,#ffc53d,#46a758,#0090ff,#6e56cf,#e5484d)";
    b.addEventListener("click", async () => {
      app.setPref("collabColor", col);
      (await runtime()).profileChanged();
      rerender();
    });
    swatches.append(b);
  }
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  const err = h("p.of-collab-error", { role: "alert" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    err.textContent = "";
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error(t("The picture is too large (limit 20 MB)."));
      const url = await downscaleAvatar(f);
      await (await runtime()).setAvatar(url);
      rerender();
    } catch (e) {
      err.textContent = e.message;
    }
  });
  const pick = h("button.of-collab-btn", { type: "button" }, t("Choose picture…"));
  pick.addEventListener("click", () => file.click());
  const clear = h("button.of-collab-btn", { type: "button" }, t("Use initials"));
  clear.addEventListener("click", async () => {
    await (await runtime()).setAvatar("");
    rerender();
  });
  return h("div.of-collab-profile",
    h("div.of-collab-profile__row", preview, h("label.of-collab-field", { style: "flex:1;min-width:180px" }, h("span", t("Nickname")), input)),
    h("div.of-collab-field", h("span", t("Presence color")), swatches),
    h("div.of-collab-profile__row", pick, clear, file),
    err,
    h("p.of-hint", t("Your nickname, color and picture are stored only on this device and are sent (encrypted) to the members of rooms you join. The picture is reduced to at most 128 px before it is stored.")),
  );
}

/** The settings section (sections array entry, see ui/settings-dialog.js). Texts are N_()-marked: tr() translates them at render time. */
export function collabSection(app) {
  return {
    id: "collab",
    label: N_("Profile and collaboration"),
    icon: "people",
    lead: N_("Your name and picture for rooms, and how collaboration behaves."),
    keywords: "profile nickname avatar picture color collaboration room relay chat comments versions cursors presence follow mention encrypted invite",
    groups: [
      { title: N_("Profile"), items: [{ type: "custom", label: N_("Nickname, color and picture"), hint: "", render: (a, rerender) => profileEditor(a, rerender) }] },
      {
        title: N_("Rooms"),
        items: [
          sw("collabActivity", N_("Post my edits to the room chat"), N_("Adds short lines such as “Move · 3 layers on Page 2” to the chat, so others can follow along and jump to the change.")),
          { type: "segmented", key: "collabCursors", label: N_("Show other members' cursors"), options: [{ value: "auto", label: N_("Automatic"), text: N_("Auto") }, { value: "on", label: N_("On"), text: N_("On") }, { value: "off", label: N_("Off"), text: N_("Off") }], hint: N_("Automatic hides them in low-power mode.") },
          sw("collabNotify", N_("Notify me about mentions and replies"), N_("A message and a counter in the window title when someone @mentions you or replies to you.")),
          { type: "action", label: N_("Collaboration"), hint: N_("Create a room, join with an invite code, chat, comments and versions."), button: N_("Open…"), run: () => app.run("collab.open") },
        ],
      },
      {
        title: N_("Security"),
        items: [
          { type: "info", label: N_("Encryption"), text: N_("Everything in a room (chat, files, comments, cursors, profiles) is end-to-end encrypted with a key that travels only inside the invite code. The relay forwards ciphertext; it sees IP addresses, the room id and when and how much is sent.") },
          { type: "info", label: N_("Verification"), text: N_("Compare the six verification words in Collaboration ▸ People with the others (by phone or in person). Different words mean you are not in the same room.") },
          { type: "info", label: N_("Received files"), text: N_("Files from members are checked against an allow-list and a size limit and never open by themselves. Only open files from people you trust.") },
          { type: "info", label: N_("Not stored"), text: N_("Invite codes and room keys are kept in memory only and are never written to disk, logs, documents or exported profiles.") },
        ],
      },
    ],
  };
}
