// Collaboration entry without a document (welcome screen): after a room was created with nothing open, offer what to
// do next. A chat-only room is fine: comments and shared documents can be added any time (Collaborate… > Share).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";

export function offerNoDocument(app) {
  openDialog({
    title: "Room created",
    width: 440,
    body: h("p", t("Nothing is open yet. Open a file or create a document to share it with the room, or keep a chat-only room.")),
    buttons: [
      { label: "Open a file…", onClick: (close) => (close(), app.run("file.open")) },
      { label: "New document…", onClick: (close) => (close(), app.run("file.new")) },
      { label: "Chat-only room", variant: "primary", onClick: (close) => close() },
    ],
  });
}
