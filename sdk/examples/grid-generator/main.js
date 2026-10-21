// Grid Generator: a command with a form, plus a Vibe tool that uses the same code.
// Everything runs in a sandbox; the document is only touched through openfini.document.callTool, which uses the
// same tools as the Vibe assistant (permission checked, and the whole command is ONE undo step).

async function buildGrid({ columns = 4, rows = 4, cell = 48, gap = 12, color = "#7c6df2" }, openfini) {
  const page = await openfini.document.pageInfo();
  if (!page) throw new Error("Open a document first.");
  const width = columns * cell + (columns - 1) * gap;
  const height = rows * cell + (rows - 1) * gap;
  const x0 = Math.round((page.width - width) / 2);
  const y0 = Math.round((page.height - height) / 2);
  const ids = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const shape = await openfini.document.callTool("add_shape", {
        type: "rect",
        x: x0 + c * (cell + gap),
        y: y0 + r * (cell + gap),
        w: cell,
        h: cell,
        fill: color,
        name: `Cell ${r + 1}-${c + 1}`,
      });
      ids.push(shape.id);
    }
  }
  const group = await openfini.document.callTool("group_layers", { ids, name: `Grid ${columns}×${rows}` });
  return { group: group.id ?? group, cells: ids.length };
}

async function activate(openfini) {
  await openfini.commands.register("generate", async () => {
    const values = await openfini.ui.form({
      title: "Generate Grid",
      description: "Draws a grid of squares in the center of the page.",
      ok: "Generate",
      fields: [
        { name: "columns", label: "Columns", type: "number", default: 4, min: 1, max: 40 },
        { name: "rows", label: "Rows", type: "number", default: 4, min: 1, max: 40 },
        { name: "cell", label: "Cell size (px)", type: "number", default: 48, min: 4, max: 400 },
        { name: "gap", label: "Gap (px)", type: "number", default: 12, min: 0, max: 200 },
        { name: "color", label: "Color", type: "text", default: "#7c6df2" },
      ],
    });
    if (!values) return; // cancelled
    if (values.columns * values.rows > 400) return openfini.ui.showMessage("That would be more than 400 cells. Use a smaller grid.", "warning");
    const result = await buildGrid(values, openfini);
    await openfini.ui.showMessage(`Created ${result.cells} cells.`, "success");
  });

  // The assistant can call the same code; OpenFini asks the user before every run.
  await openfini.vibe.registerTool("make_grid", (args) => buildGrid(args || {}, openfini));
}
