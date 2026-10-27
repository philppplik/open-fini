// Icon names (vendored Bootstrap icons) for layer types, shared by the composer, the Canvas outline and the diff view.
const LAYER_ICON = { rect: "square", ellipse: "circle", text: "fonts", image: "image", pixel: "brush", group: "folder", path: "bezier2", polygon: "pentagon", star: "star", table: "table", chart: "bar-chart", adjust: "sliders" };
export const layerIcon = (type) => LAYER_ICON[type] || "layers";
