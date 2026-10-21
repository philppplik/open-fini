// Entry point of the extension system. Loaded lazily after start-up (see boot.js), so it costs nothing
// until the app is running. The manager UI loads on demand.
import { ExtensionHost } from "./host.js";

export async function initExtensions(app) {
  const host = new ExtensionHost(app);
  app.extensions = host;
  app.extMenuItems = (label, studio) => host.menuItems(label, studio);
  app.menuProviders ||= {};
  app.menuProviders.extCommands = (a) => host.commandMenu(a.studio);
  app.importWithExtension = async (file) => (host.hasImporter(file.name) ? host.importFile(file) : false);
  // an .ofext file opened from the OS or dropped on the window: unpack, validate and ask for consent
  app.installExtensionFile = async (file) => {
    const [{ unpackExtension }, { consentDialog }] = await Promise.all([import("./zip.js"), import("../ui/extensions/dialogs.js")]);
    try {
      const done = await host.install({ files: unpackExtension(file.bytes), source: { type: "file", name: file.name } }, consentDialog);
      if (done) app.toast(done.updated ? "Extension updated." : "Extension installed. Find its commands under Studio ▸ Extension Commands.", "success", 3500);
      return !!done;
    } catch (err) {
      app.toast(err.message, "danger", 8000);
      return false;
    }
  };
  await host.load();
  return host;
}
