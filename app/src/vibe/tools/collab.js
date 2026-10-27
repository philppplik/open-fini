// Collaboration tools for the Vibe assistant: comments, versions, room status and chat (docs/collaboration.md).
// Reads are `readOnly`; anything that is sent to other people (chat messages, comments and replies while in a room)
// asks the user first. The collaboration runtime loads lazily on the first call.
import { tool, S, requireDoc } from "./helpers.js";

const rt = async (app) => {
  const m = await import("../../ui/collab/runtime.js");
  const c = m.getCollab(app);
  await c.ready;
  return c;
};
const inRoom = (app) => !!app.collab?.session && app.collab.session.state === "open";

function threadInfo(doc, th) {
  return {
    id: th.id,
    anchor: th.anchor,
    layer: th.anchor.kind === "node" ? doc.find(th.anchor.node)?.name || null : undefined,
    author: th.nick,
    resolved: !!th.resolved,
    ...(th.resolved ? { resolvedBy: th.resolvedBy } : {}),
    messages: th.messages.filter((m) => !m.deleted).map((m) => ({ id: m.id, author: m.nick, text: m.text, at: new Date(m.ts).toISOString() })),
  };
}

export function collabTools(app) {
  return [
    tool("list_comments", "Lists the comment threads of the active document (Google-Docs-style comments on layers, pages, text and code lines) with their replies. Use it to summarize open comments or find a thread to reply to.", {
      status: S.str("Which threads", { enum: ["open", "resolved", "all"] }),
    }, [], async (a) => {
      const doc = requireDoc(app);
      const c = await rt(app);
      const { filterThreads } = await import("../../collab/comments.js");
      const threads = filterThreads(c.threads(doc), { status: a.status || "open" });
      return { document: doc.name, count: threads.length, threads: threads.slice(0, 100).map((th) => threadInfo(doc, th)) };
    }, { readOnly: true }),

    tool("add_comment", "Adds a comment thread to the active document, anchored to a layer (layer_id), to the current page, or to the current selection. Comments are saved in the document and shared with the room when the user is in one.", {
      text: S.str("The comment text (plain text; @Name mentions a room member)"),
      layer_id: S.str("Optional layer id from list_layers to anchor the comment to"),
      at: {
        type: "object",
        description: "Optional precise anchor: page coordinates (x, y; together with layer_id the pin follows that layer) or a code line/range (path, line, end_line)",
        properties: { x: S.num("Page x (px) of the pin"), y: S.num("Page y (px) of the pin"), page_id: S.str("Optional page id (default: the current page)"), path: S.str("Code studio: file path"), line: S.num("Code studio: 1-based line"), end_line: S.num("Code studio: last line of a range") },
        additionalProperties: false,
      },
    }, ["text"], async (a) => {
      const doc = requireDoc(app);
      const c = await rt(app);
      const { canvasAnchor, codeAnchor } = await import("../../collab/anchors.js");
      const { pageBounds } = await import("../../core/transform.js");
      let anchor = c.currentAnchor();
      const at = a.at || {};
      const node = a.layer_id ? doc.find(a.layer_id) : null;
      if (a.layer_id && !node) throw new Error(`There is no layer with id “${a.layer_id}”. Call list_layers to see the current ids.`);
      if (at.path && at.line) {
        anchor = codeAnchor({ path: at.path, from: { line: at.line, col: 0 }, to: at.end_line ? { line: at.end_line, col: 1e6 } : null });
      } else if (Number.isFinite(at.x) && Number.isFinite(at.y)) {
        const page = (at.page_id && doc.pages.find((p) => p.id === at.page_id)) || node?._page || app.page;
        if (!page) throw new Error("There is no page to place the comment on.");
        anchor = canvasAnchor({ pageId: page.id, node, bounds: node ? pageBounds(node) : null, point: { x: at.x, y: at.y } });
      } else if (node) {
        anchor = { kind: "node", node: node.id, page: node._page?.id, quote: String(node.name || node.type).slice(0, 200) };
      }
      const th = c.addThread(doc, anchor, a.text);
      return { added: th.id, anchor: th.anchor.kind, shared: inRoom(app) };
    }, { needsApproval: (a) => `Add the comment “${String(a.text).slice(0, 80)}”${inRoom(app) ? " (it is shared with the room)" : ""}?` }),

    tool("reply_comment", "Replies to a comment thread of the active document (thread ids from list_comments). Replying to a resolved thread reopens it.", {
      thread_id: S.str("Thread id from list_comments"),
      text: S.str("Reply text"),
    }, ["thread_id", "text"], async (a) => {
      const doc = requireDoc(app);
      const c = await rt(app);
      if (!c.threads(doc).some((t) => t.id === a.thread_id)) throw new Error(`There is no comment thread “${a.thread_id}”. Call list_comments first.`);
      c.reply(doc, a.thread_id, a.text);
      return { replied: a.thread_id, shared: inRoom(app) };
    }, { needsApproval: (a) => `Reply “${String(a.text).slice(0, 80)}” to the comment thread${inRoom(app) ? " (it is shared with the room)" : ""}?` }),

    tool("resolve_comment", "Marks a comment thread as resolved (or reopens it with reopen: true).", {
      thread_id: S.str("Thread id from list_comments"),
      reopen: S.bool("Reopen instead of resolve"),
    }, ["thread_id"], async (a) => {
      const doc = requireDoc(app);
      const c = await rt(app);
      if (!c.threads(doc).some((t) => t.id === a.thread_id)) throw new Error(`There is no comment thread “${a.thread_id}”. Call list_comments first.`);
      const changed = c.setResolved(doc, a.thread_id, !a.reopen);
      return { thread: a.thread_id, resolved: !a.reopen, changed };
    }),

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
