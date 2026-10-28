// Collaboration tools for the Vibe assistant: versions, room status, chat and shared documents (docs/collaboration.md).
// Comment tools live in comments.js (they work without a room). Reads are `readOnly`; anything that is sent to other
// people (chat messages, sharing) asks the user first. The collaboration runtime loads lazily on the first call.
import { tool, S, requireDoc } from "./helpers.js";

const rt = async (app) => {
  const m = await import("../../ui/collab/runtime.js");
  const c = m.getCollab(app);
  await c.ready;
  return c;
};
const inRoom = (app) => !!app.collab?.session && app.collab.session.state === "open";

export function collabTools(app) {
  return [
    tool("list_versions", "Lists the named versions (snapshots) of the active document that are stored on this device, newest first.", {}, [], async () => {
      const doc = requireDoc(app);
      const c = await rt(app);
      const list = await c.versions.list(doc.id);
      return { document: doc.name, versions: list.map((v) => ({ id: v.id, name: v.name, note: v.note || undefined, author: v.author || undefined, at: new Date(v.ts).toISOString(), automatic: v.auto, bytes: v.bytes })) };
    }, { readOnly: true }),

    tool("save_version", "Saves a named version (complete snapshot) of the active document on this device. Restoring is done by the user in Collaboration ▸ Versions.", {
      name: S.str("Version name, e.g. “Sent to client”"),
      note: S.str("Optional note"),
    }, ["name"], async (a) => {
      const doc = requireDoc(app);
      const c = await rt(app);
      const v = await c.saveVersion(doc, { name: a.name, note: a.note || "" });
      return { saved: v.id, name: v.name, bytes: v.bytes };
    }),

    tool("get_collab_status", "Tells whether the user is in a collaboration room: relay host, encryption, members (nicknames, roles, which studio and document they are in) and the user's own role. Never returns the invite code or keys.", {}, [], async () => {
      const c = app.collab;
      const s = c?.session;
      if (!s) return { inRoom: false, hint: "The user can start or join a room with Studio ▸ Collaborate…" };
      return {
        inRoom: true,
        state: s.state,
        relay: s.relayHost,
        encrypted: true,
        myRole: s.myRole,
        isHost: s.isHost,
        members: s.members.map((m) => ({ nickname: m.profile?.nick, role: s.room.roleOf(m.id), studio: m.presence?.studio, document: m.presence?.docName })),
        unread: s.chatStore.unread,
      };
    }, { readOnly: true }),

    tool("read_chat", "Reads the latest messages of the room chat (text, author, replies, thread counts) so you can summarize or answer them. Only while the user is in a room.", {
      limit: S.num("How many recent messages (default 30, max 100)", { minimum: 1, maximum: 100 }),
    }, [], async (a) => {
      if (!inRoom(app)) return { inRoom: false, messages: [] };
      const store = app.collab.session.chatStore;
      const list = store.main().filter((m) => m.kind === "chat" && !m.deleted).slice(-(a.limit || 30));
      return { messages: list.map((m) => ({ id: m.id, author: m.nick, text: m.text, at: new Date(m.ts).toISOString(), ...(m.reply ? { replyTo: m.reply } : {}), ...(store.threadCount(m.id) ? { threadReplies: store.thread(m.id).filter((x) => !x.deleted).map((x) => ({ author: x.nick, text: x.text })) } : {}), ...(m.file ? { file: m.file.name } : {}) })) };
    }, { readOnly: true }),

    tool("post_chat_message", "Posts a message to the room chat (plain text; @Name mentions a member). Use reply_to with a message id to reply to a message. Only works while the user is in a room.", {
      text: S.str("Message text"),
      reply_to: S.str("Optional id of the message to reply to"),
    }, ["text"], async (a) => {
      if (!inRoom(app)) throw new Error("The user is not in a collaboration room. They can start or join one with Studio ▸ Collaborate…");
      const m = await app.collab.session.chat(a.text, a.reply_to ? { reply: a.reply_to } : {});
      return { posted: m.id };
    }, { needsApproval: (a) => `Send “${String(a.text).slice(0, 120)}” to everyone in the room?` }),

    // ---- shared documents and "Edit together" (beta), docs/collaboration.md ▸ Live editing
    tool("share_document", "Shares the active document with the collaboration room: mode “live” makes it a linked live document that everyone with the Editor role edits together (beta; Vector, Pixel structure, Layout and Code; Office documents are shared as a copy), mode “copy” sends a snapshot others can open on their own. Only while the user is in a room.", {
      mode: S.str("live (edit together) or copy (snapshot)", { enum: ["live", "copy"] }),
    }, ["mode"], async (a) => {
      const doc = requireDoc(app);
      if (!inRoom(app)) throw new Error("The user is not in a collaboration room. They can start or join one with Studio ▸ Collaborate…");
      const c = await rt(app);
      await c.shareFlow(doc, a.mode === "copy" ? "copy" : "live");
      return { shared: doc.name, mode: a.mode, status: c.liveStatus(doc) };
    }, { needsApproval: (a) => `Share the document “${app.doc?.name || "?"}” with everyone in the room${a.mode === "copy" ? " as a copy" : " as a live document they can edit"}?` }),

    tool("get_sharing_status", "Tells whether the active document is shared with the room: live or not, how many people edit it, whether editing is paused, who shared it, and whether this user may edit it.", {}, [], async () => {
      const doc = requireDoc(app);
      const st = app.collab?.liveStatus ? app.collab.liveStatus(doc) : { shared: false };
      return { document: doc.name, inRoom: inRoom(app), ...st };
    }, { readOnly: true }),

    tool("list_shared_documents", "Lists the documents shared in the collaboration room: the ones open here as live documents and the ones others shared that the user has not opened.", {}, [], async () => {
      if (!inRoom(app)) return { inRoom: false, documents: [] };
      const c = await rt(app);
      const live = await c.live();
      return { inRoom: true, documents: live.list().map((d) => ({ name: d.name, kind: d.kind, openHere: d.open, ...(d.open ? { people: d.people, paused: d.paused, sharedByMe: d.ownedByMe } : { sharedBy: d.from }) })) };
    }, { readOnly: true }),
  ];
}
