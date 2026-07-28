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
const textureNameValue = document.getElementById("textureNameValue");
const selectTextureButton = document.getElementById("selectTextureButton");
const openTextureButton = document.getElementById("openTextureButton");
const applyTextureButton = document.getElementById("applyTextureButton");
const restoreTextureButton = document.getElementById("restoreTextureButton");
const diagnosticLog = document.getElementById("diagnosticLog");
const copyLogButton = document.getElementById("copyLogButton");
const clearLogButton = document.getElementById("clearLogButton");
const logLines = [];
let copyFeedbackTimer = null;
let selectedTexture = {
  name: "COMPUTE2",
  width: 256,
  height: 56,
  meshes: 0
};
const TEXTURE_STATUS_MAX_CHARACTERS = 44;
let textureDocument = null;
let textureRequestSequence = 0;

function setTextureStatus(message) {
  const fullMessage = String(message).replace(/\s+/g, " ").trim();
  const clippedMessage =
    fullMessage.length > TEXTURE_STATUS_MAX_CHARACTERS
      ? `${fullMessage.slice(0, TEXTURE_STATUS_MAX_CHARACTERS - 1).trim()}…`
      : fullMessage;
  textureTestStatus.textContent = clippedMessage;
  textureTestStatus.title = fullMessage;
  textureTestStatus.setAttribute("aria-label", fullMessage);
}

function sendTextureAction(
  action,
  extra = {},
  textureName = selectedTexture.name
) {
  doomView.postMessage({
    source: "three-doom-host",
    type: "liveTextureTest",
    action,
    texture: textureName,
    ...extra
  });
}

function showTexturePicker() {
  doomView.postMessage({
    source: "three-doom-host",
    type: "texturePicker",
    action: "show",
    selected: selectedTexture.name
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
  setTextureStatus(
    `Editing ${result.name} · ${result.width}×${result.height} RGB`
  );
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

  setTextureStatus(`Reading ${textureDocument.name} pixels…`);
  let rgba;
  await core.executeAsModal(async () => {
    const imageObject = await imaging.getPixels({
      documentID: document.id,
      sourceBounds: {
        left: 0,
        top: 0,
        width: textureDocument.width,
        height: textureDocument.height
      },
      colorSpace: "RGB",
      componentSize: 8
    });
    try {
      rgba = await normalizeCompositePixels(
        imageObject,
        textureDocument.width,
        textureDocument.height
      );
    } finally {
      imageObject.imageData.dispose();
    }
  }, {
    commandName: `Read Doom texture ${textureDocument.name}`,
    timeOut: 5000
  });
  setTextureStatus(`Applying ${textureDocument.name}…`);
  sendTextureAction("applyPixels", {
    width: textureDocument.width,
    height: textureDocument.height,
    rgba: Array.from(rgba)
  }, textureDocument.name);
}

function reportTextureHostError(message, error) {
  const details = error && error.message ? error.message : String(error);
  setTextureStatus(`${message} · ${details}`);
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

function resetTextureEditorState() {
  selectedTexture = {
    name: "COMPUTE2",
    width: 256,
    height: 56,
    meshes: 0
  };
  textureDocument = null;
  textureRequestSequence += 1;
  textureNameValue.textContent = selectedTexture.name;
  setTextureStatus("Reset textures · starting E1M1…");
}

function clearDiagnosticLog() {
  logLines.length = 0;
  diagnosticLog.textContent = "";
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

  if (data.type === "liveTextureSelected") {
    const texture = data.texture || {};
    if (
      typeof texture.name !== "string" ||
      !Number.isFinite(texture.width) ||
      !Number.isFinite(texture.height) ||
      !Number.isFinite(texture.meshes)
    ) {
      reportTextureHostError(
        "Select Texture failed",
        "The game returned invalid texture metadata."
      );
      return;
    }
    selectedTexture = {
      name: texture.name,
      width: texture.width,
      height: texture.height,
      meshes: texture.meshes
    };
    textureRequestSequence += 1;
    textureDocument = null;
    textureNameValue.textContent = selectedTexture.name;
    setTextureStatus(selectedTexture.meshes > 0
      ? `${selectedTexture.name} selected · ${selectedTexture.meshes} live`
      : `${selectedTexture.name} selected · not in this map`);
    appendLog(
      "info",
      "Wall texture selected",
      `${selectedTexture.name} · ${selectedTexture.width}×` +
      selectedTexture.height
    );
    return;
  }

  if (data.type === "liveTextureTest") {
    const result = data.result || {};
    if (result.ok) {
      const hasLiveMeshes = result.meshes > 0;
      const actionLabel = result.active
        ? (hasLiveMeshes
          ? (result.source === "photoshop"
            ? "Photoshop texture applied"
            : "Test texture active")
          : "Texture stored; not used in this map")
        : "Original restored";
      setTextureStatus(
        hasLiveMeshes || !result.active
          ? `${actionLabel} · ${result.name} · ${result.meshes} mesh` +
            (result.meshes === 1 ? "" : "es")
          : `${result.name} applied · not visible in map`
      );
      appendLog(
        result.active && !hasLiveMeshes ? "warn" : "info",
        actionLabel,
        `${result.name} · ${result.meshes} live meshes · no WebView reload`
      );
    } else {
      setTextureStatus(
        `Texture failed · ${result.error || "unknown error"}`
      );
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
  resetTextureEditorState();
  clearDiagnosticLog();
  appendLog(
    "info",
    "Full Doom reset requested",
    "original WAD textures · E1M1"
  );
  doomView.src =
    `plugin:/doom/index.html?-map=E1M1&reload=${Date.now()}`;
});

selectTextureButton.addEventListener("click", () => {
  setTextureStatus("Choose a wall texture…");
  showTexturePicker();
});

openTextureButton.addEventListener("click", () => {
  textureRequestSequence += 1;
  setTextureStatus(`Reading ${selectedTexture.name} game pixels…`);
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
  setTextureStatus(`Restoring ${selectedTexture.name}…`);
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
  clearDiagnosticLog();
});

resetStatus();
setTextureStatus(textureTestStatus.textContent);
appendLog("info", "UXP host logger ready");
