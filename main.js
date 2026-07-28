"use strict";

const photoshop =
  typeof require === "function" ? require("photoshop") : null;
const app = photoshop ? photoshop.app : null;
const core = photoshop ? photoshop.core : null;
const imaging = photoshop ? photoshop.imaging : null;

const doomView = document.getElementById("doomView");
const reloadButton = document.getElementById("reloadButton");
const statusValue = document.getElementById("statusValue");
const fpsValue = document.getElementById("fpsValue");
const p95Value = document.getElementById("p95Value");
const droppedValue = document.getElementById("droppedValue");
const textureTestStatus = document.getElementById("textureTestStatus");
const openTextureButton = document.getElementById("openTextureButton");
const applyTextureButton = document.getElementById("applyTextureButton");
const restoreTextureButton = document.getElementById("restoreTextureButton");
const diagnosticLog = document.getElementById("diagnosticLog");
const copyLogButton = document.getElementById("copyLogButton");
const clearLogButton = document.getElementById("clearLogButton");
const logLines = [];
let copyFeedbackTimer = null;
const LIVE_TEXTURE_NAME = "COMPUTE2";
let textureDocument = null;
let textureRequestSequence = 0;

function sendTextureAction(action, extra = {}) {
  doomView.postMessage({
    source: "three-doom-host",
    type: "liveTextureTest",
    action,
    texture: LIVE_TEXTURE_NAME,
    ...extra
  });
}

function findDocumentById(documentId) {
  if (!app) {
    return null;
  }
  for (let index = 0; index < app.documents.length; index += 1) {
    const document = app.documents[index];
    if (document.id === documentId) {
      return document;
    }
  }
  return null;
}

function normalizeCompositePixels(imageObject, width, height) {
  const imageData = imageObject.imageData;
  if (imageData.componentSize !== 8 || imageData.colorSpace !== "RGB") {
    throw new Error(
      "The texture document must remain an 8-bit RGB document."
    );
  }
  return imageData.getData({ chunky: true }).then((pixels) => {
    const components = imageData.components;
    if (components !== 3 && components !== 4) {
      throw new Error(
        `Expected RGB or RGBA pixels; received ${components} components.`
      );
    }
    const output = new Uint8Array(width * height * 4);
    const bounds = imageObject.sourceBounds || {
      left: 0,
      top: 0,
      width: imageData.width,
      height: imageData.height
    };
    const left = Math.max(0, Math.round(bounds.left || 0));
    const top = Math.max(0, Math.round(bounds.top || 0));
    for (let y = 0; y < imageData.height; y += 1) {
      const targetY = top + y;
      if (targetY < 0 || targetY >= height) {
        continue;
      }
      for (let x = 0; x < imageData.width; x += 1) {
        const targetX = left + x;
        if (targetX < 0 || targetX >= width) {
          continue;
        }
        const source = (y * imageData.width + x) * components;
        const target = (targetY * width + targetX) * 4;
        output[target + 0] = pixels[source + 0];
        output[target + 1] = pixels[source + 1];
        output[target + 2] = pixels[source + 2];
        output[target + 3] = components === 4 ? pixels[source + 3] : 255;
      }
    }
    return output;
  });
}

async function openTextureDocument(result) {
  if (!app || !core || !imaging) {
    throw new Error("Photoshop APIs are unavailable in this preview.");
  }
  const rgba = Uint8Array.from(result.rgba);
  let createdDocument = null;
  await core.executeAsModal(async (executionContext) => {
    createdDocument = await app.documents.add({
      name: `DOOM_${result.name}_LIVE`,
      width: result.width,
      height: result.height,
      resolution: 72,
      mode: "RGBColorMode",
      fill: "transparent",
      depth: 8
    });
    await executionContext.hostControl.registerAutoCloseDocument(
      createdDocument.id
    );
    const activeLayers = createdDocument.activeLayers;
    let originalLayer =
      activeLayers && activeLayers.length > 0 ? activeLayers[0] : null;
    if (!originalLayer) {
      originalLayer = await createdDocument.createPixelLayer();
    }
    originalLayer.name = `${result.name} Original`;
    const imageData = await imaging.createImageDataFromBuffer(rgba, {
      width: result.width,
      height: result.height,
      components: 4,
      chunky: true,
      colorSpace: "RGB"
    });
    try {
      await imaging.putPixels({
        documentID: createdDocument.id,
        layerID: originalLayer.id,
        imageData,
        replace: true,
        targetBounds: { left: 0, top: 0 },
        commandName: `Place Doom texture ${result.name}`
      });
    } finally {
      imageData.dispose();
    }
    await createdDocument.createPixelLayer({ name: "Your edits" });
    await executionContext.hostControl.unregisterAutoCloseDocument(
      createdDocument.id
    );
  }, {
    commandName: `Open Doom texture ${result.name}`,
    timeOut: 5000
  });

  textureDocument = {
    id: createdDocument.id,
    name: result.name,
    width: result.width,
    height: result.height
  };
  textureTestStatus.textContent =
    `Editing ${createdDocument.title} · ${result.width}×${result.height}` +
    " RGB · layered";
  appendLog(
    "info",
    "Texture opened in Photoshop",
    `${result.name} · document ${createdDocument.id}`
  );
}

async function applyTextureDocument() {
  if (!textureDocument) {
    throw new Error("Click Open Texture before applying.");
  }
  const document = findDocumentById(textureDocument.id);
  if (!document) {
    textureDocument = null;
    throw new Error("The texture document was closed. Open it again.");
  }
  const width = Math.round(document.width);
  const height = Math.round(document.height);
  if (
    width !== textureDocument.width ||
    height !== textureDocument.height
  ) {
    throw new Error(
      `${textureDocument.name} must remain ` +
      `${textureDocument.width}×${textureDocument.height}; ` +
      `the document is ${width}×${height}.`
    );
  }

  textureTestStatus.textContent =
    `Reading ${textureDocument.name} composite pixels…`;
  const imageObject = await imaging.getPixels({
    documentID: document.id,
    sourceBounds: {
      left: 0,
      top: 0,
      width: textureDocument.width,
      height: textureDocument.height
    }
  });
  let rgba;
  try {
    rgba = await normalizeCompositePixels(
      imageObject,
      textureDocument.width,
      textureDocument.height
    );
  } finally {
    imageObject.imageData.dispose();
  }
  textureTestStatus.textContent =
    `Quantizing ${textureDocument.name} to the Doom palette…`;
  sendTextureAction("applyPixels", {
    width: textureDocument.width,
    height: textureDocument.height,
    rgba: Array.from(rgba)
  });
}

function reportTextureHostError(message, error) {
  const details = error && error.message ? error.message : String(error);
  textureTestStatus.textContent = `${message}: ${details}`;
  appendLog("error", message, details);
}

function appendLog(level, message, details) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const suffix = details ? ` · ${details}` : "";
  const line = `${timestamp} [${level.toUpperCase()}] ${message}${suffix}`;
  logLines.push(line);
  if (logLines.length > 80) {
    logLines.shift();
  }
  diagnosticLog.textContent = logLines.join("\n");
  diagnosticLog.scrollTop = diagnosticLog.scrollHeight;

  if (level === "error") {
    console.error(`[Three Doom WebView] ${message}${suffix}`);
  } else if (level === "warn") {
    console.warn(`[Three Doom WebView] ${message}${suffix}`);
  } else {
    console.log(`[Three Doom WebView] ${message}${suffix}`);
  }
}

function resetStatus() {
  statusValue.textContent = "Loading Doom…";
  fpsValue.textContent = "— FPS";
  p95Value.textContent = "P95 —";
  droppedValue.textContent = "Dropped —";
}

doomView.addEventListener("loadstart", () => {
  statusValue.textContent = "Local Doom WebView loading…";
  appendLog("info", "WebView load started", "plugin:/doom/index.html");
});

doomView.addEventListener("loadstop", () => {
  statusValue.textContent = "WebView loaded; waiting for Doom…";
  appendLog("info", "WebView document loaded");
});

doomView.addEventListener("loaderror", (event) => {
  const message =
    `WebView load failed (${event.code}): ${event.message}`;
  statusValue.textContent = message;
  appendLog("error", message, event.url || "");
});

window.addEventListener("message", (event) => {
  if (event.source !== doomView) {
    return;
  }

  const data = event.data;
  if (!data || data.source !== "three-doom-benchmark") {
    return;
  }

  if (data.type === "log") {
    appendLog(data.level || "info", data.message, data.details || "");
    return;
  }

  if (data.type === "error") {
    statusValue.textContent = `Error: ${data.message}`;
    appendLog("error", data.message, data.details || "");
    return;
  }

  if (data.type === "status") {
    statusValue.textContent = data.label;
    appendLog("info", data.label, data.details || "");
    return;
  }

  if (data.type === "metrics") {
    statusValue.textContent = data.label;
    fpsValue.textContent = `${data.fps.toFixed(1)} FPS`;
    p95Value.textContent = `P95 ${data.p95Ms.toFixed(1)} ms`;
    droppedValue.textContent = `Dropped ${data.droppedFrames}`;
    return;
  }

  if (data.type === "liveTextureExport") {
    const result = data.result || {};
    if (!result.ok) {
      reportTextureHostError(
        "Open Texture failed",
        result.error || "unknown error"
      );
      return;
    }
    if (
      data.requestId !== undefined &&
      data.requestId !== textureRequestSequence
    ) {
      return;
    }
    openTextureDocument(result).catch((error) => {
      reportTextureHostError("Open Texture failed", error);
    });
    return;
  }

  if (data.type === "liveTextureTest") {
    const result = data.result || {};
    if (result.ok) {
      const actionLabel = result.active
        ? (result.source === "photoshop"
          ? "Photoshop texture applied"
          : "Test texture active")
        : "Original restored";
      textureTestStatus.textContent =
        `${actionLabel} · ${result.name} ${result.width}×${result.height}` +
        ` · ${result.meshes} live wall mesh${result.meshes === 1 ? "" : "es"}` +
        (result.paletteColors
          ? ` · ${result.paletteColors} palette colors`
          : "");
      appendLog(
        "info",
        actionLabel,
        `${result.name} · no WebView reload`
      );
    } else {
      textureTestStatus.textContent =
        `Texture test failed: ${result.error || "unknown error"}`;
      appendLog(
        "error",
        "Live texture test failed",
        result.error || "unknown error"
      );
    }
  }
});

reloadButton.addEventListener("click", () => {
  resetStatus();
  appendLog("info", "Reload requested");
  doomView.src = `plugin:/doom/index.html?reload=${Date.now()}`;
});

openTextureButton.addEventListener("click", () => {
  textureRequestSequence += 1;
  textureTestStatus.textContent =
    `Reading ${LIVE_TEXTURE_NAME} from the running game…`;
  sendTextureAction("export", {
    requestId: textureRequestSequence
  });
});

applyTextureButton.addEventListener("click", () => {
  applyTextureDocument().catch((error) => {
    reportTextureHostError("Apply Texture failed", error);
  });
});

restoreTextureButton.addEventListener("click", () => {
  textureTestStatus.textContent =
    `Restoring original ${LIVE_TEXTURE_NAME}…`;
  sendTextureAction("restore");
});

copyLogButton.addEventListener("click", async () => {
  const logText = logLines.join("\n");
  if (!logText) {
    copyLogButton.textContent = "Log is empty";
  } else {
    try {
      await navigator.clipboard.writeText(logText);
      copyLogButton.textContent = "Copied!";
      console.log(`[Three Doom WebView] Copied ${logLines.length} log lines`);
    } catch (error) {
      copyLogButton.textContent = "Copy failed";
      console.error(
        `[Three Doom WebView] Copy failed: ${error.message || String(error)}`,
      );
    }
  }

  if (copyFeedbackTimer !== null) {
    clearTimeout(copyFeedbackTimer);
  }
  copyFeedbackTimer = setTimeout(() => {
    copyLogButton.textContent = "Copy log";
    copyFeedbackTimer = null;
  }, 1600);
});

clearLogButton.addEventListener("click", () => {
  logLines.length = 0;
  diagnosticLog.textContent = "";
});

resetStatus();
appendLog("info", "UXP host logger ready");
