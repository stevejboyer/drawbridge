/**
 * Excalidraw element factory helpers.
 *
 * These functions produce well-formed Excalidraw elements with all required
 * fields populated. You only need to pass the properties you care about —
 * everything else gets sensible defaults.
 */

let _indexCounter = 0;

function nextIndex() {
  // Excalidraw uses fractional indexing strings like "a0", "a1", "aG", etc.
  // We generate simple sequential ones that sort correctly.
  const i = _indexCounter++;
  return "z" + i.toString(36).padStart(4, "0");
}

function randomSeed() {
  return Math.floor(Math.random() * 2_000_000_000);
}

function randomId() {
  // 8-char alphanumeric, matching Excalidraw's style
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Base defaults for all Excalidraw elements.
 * These are the fields Excalidraw requires to render an element properly.
 */
function baseElement(overrides = {}) {
  return {
    id: randomId(),
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    updated: Date.now(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    index: nextIndex(),
    roundness: null,
    boundElements: null,
    link: null,
    locked: false,
    ...overrides,
  };
}

/**
 * Create a rectangle element.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {object} [opts] - Optional overrides (backgroundColor, strokeColor, etc.)
 */
export function rect(x, y, width, height, opts = {}) {
  return baseElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
    roundness: { type: 3 },
    ...opts,
  });
}

/**
 * Create an ellipse element.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 */
export function ellipse(x, y, width, height, opts = {}) {
  return baseElement({
    type: "ellipse",
    x,
    y,
    width,
    height,
    ...opts,
  });
}

/**
 * Create a text element.
 *
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {object} [opts] - fontSize, strokeColor, fontFamily, etc.
 */
export function text(x, y, textContent, opts = {}) {
  const fontSize = opts.fontSize || 20;
  const fontFamily = opts.fontFamily || 5; // Excalidraw's default hand-drawn font
  // Rough width/height estimates
  const estWidth = textContent.length * fontSize * 0.6;
  const lines = textContent.split("\n").length;
  const estHeight = lines * fontSize * 1.3;

  return baseElement({
    type: "text",
    x,
    y,
    width: estWidth,
    height: estHeight,
    text: textContent,
    fontSize,
    fontFamily,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: true,
    containerId: null,
    originalText: textContent,
    lineHeight: 1.25,
    ...opts,
  });
}

/**
 * Create a diamond element.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 */
export function diamond(x, y, width, height, opts = {}) {
  return baseElement({
    type: "diamond",
    x,
    y,
    width,
    height,
    ...opts,
  });
}

/**
 * Create an arrow element.
 *
 * @param {number} x1 - Start x
 * @param {number} y1 - Start y
 * @param {number} x2 - End x
 * @param {number} y2 - End y
 * @param {object} [opts] - endArrowhead, startArrowhead, strokeColor, etc.
 */
export function arrow(x1, y1, x2, y2, opts = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return baseElement({
    type: "arrow",
    x: x1,
    y: y1,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
    endArrowhead: "arrow",
    startArrowhead: null,
    ...opts,
  });
}

/**
 * Create a line element (arrow with no arrowheads).
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {object} [opts]
 */
export function line(x1, y1, x2, y2, opts = {}) {
  return arrow(x1, y1, x2, y2, {
    type: "line",
    endArrowhead: null,
    startArrowhead: null,
    ...opts,
  });
}

/**
 * Create a freedraw (pencil) element from a list of points.
 *
 * @param {Array<[number, number]>} points - Array of [x, y] coordinate pairs
 * @param {object} [opts]
 */
export function freedraw(points, opts = {}) {
  if (!points.length) return null;
  const [startX, startY] = points[0];
  const relPoints = points.map(([px, py]) => [px - startX, py - startY]);
  const xs = points.map(([px]) => px);
  const ys = points.map(([, py]) => py);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return baseElement({
    type: "freedraw",
    x: startX,
    y: startY,
    width: maxX - minX,
    height: maxY - minY,
    points: relPoints,
    pressures: relPoints.map(() => 0.5),
    simulatePressure: true,
    ...opts,
  });
}

/**
 * Normalize an element: fill in any missing required fields.
 * Useful for accepting partial elements from CLI input and making them valid.
 *
 * @param {object} partial - A partial Excalidraw element (must have at least `type`)
 * @returns {object} A complete, valid Excalidraw element
 */
export function normalize(partial) {
  if (!partial || !partial.type) {
    throw new Error("Element must have a 'type' field");
  }

  const defaults = baseElement();

  // Type-specific defaults
  const typeDefaults = {};
  if (partial.type === "text") {
    typeDefaults.fontSize = 20;
    typeDefaults.fontFamily = 5;
    typeDefaults.textAlign = "left";
    typeDefaults.verticalAlign = "top";
    typeDefaults.autoResize = true;
    typeDefaults.containerId = null;
    typeDefaults.lineHeight = 1.25;
    if (partial.text) {
      typeDefaults.originalText = partial.text;
    }
  }
  if (partial.type === "rectangle") {
    typeDefaults.roundness = { type: 3 };
  }
  if (partial.type === "arrow") {
    typeDefaults.endArrowhead = "arrow";
    typeDefaults.startArrowhead = null;
  }

  return { ...defaults, ...typeDefaults, ...partial };
}

/**
 * Normalize an array of elements.
 */
export function normalizeAll(elements) {
  return elements.map(normalize);
}

/**
 * Merge new elements into an existing element list by ID.
 * - Elements with matching IDs are updated (new version wins)
 * - Elements with new IDs are appended
 * - Existing elements not in newElements are preserved
 *
 * @param {Array} existing - Current elements array
 * @param {Array} incoming - New/updated elements
 * @returns {Array} Merged elements array
 */
export function mergeElements(existing, incoming) {
  const map = new Map();

  // Index existing elements by ID
  for (const el of existing) {
    map.set(el.id, el);
  }

  // Merge incoming: update existing or add new
  for (const el of incoming) {
    const normalized = el.version != null ? el : normalize(el);
    map.set(normalized.id, normalized);
  }

  return Array.from(map.values());
}
