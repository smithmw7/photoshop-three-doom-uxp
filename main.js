"use strict";

const doomView = document.getElementById("doomView");
const reloadButton = document.getElementById("reloadButton");
const statusValue = document.getElementById("statusValue");
const fpsValue = document.getElementById("fpsValue");
const p95Value = document.getElementById("p95Value");
const droppedValue = document.getElementById("droppedValue");
const textureTestStatus = document.getElementById("textureTestStatus");
const applyTextureButton = document.getElementById("applyTextureButton");
const restoreTextureButton = document.getElementById("restoreTextureButton");
const diagnosticLog = document.getElementById("diagnosticLog");
const copyLogButton = document.getElementById("copyLogButton");
const clearLogButton = document.getElementById("clearLogButton");
const logLines = [];
let copyFeedbackTimer = null;
const LIVE_TEXTURE_NAME = "COMPUTE2";

function sendTextureTestAction(action) {
  textureTestStatus.textContent =
    action === "apply"
      ? `Applying checker to ${LIVE_TEXTURE_NAME}…`
      : `Restoring ${LIVE_TEXTURE_NAME}…`;
  doomView.postMessage({
    source: "three-doom-host",
    type: "liveTextureTest",
    action,
    texture: LIVE_TEXTURE_NAME
  });
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

  if (data.type === "liveTextureTest") {
    const result = data.result || {};
    if (result.ok) {
      const actionLabel = result.active ? "Test texture active" : "Original restored";
      textureTestStatus.textContent =
        `${actionLabel} · ${result.name} ${result.width}×${result.height}` +
        ` · ${result.meshes} live wall mesh${result.meshes === 1 ? "" : "es"}`;
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

applyTextureButton.addEventListener("click", () => {
  sendTextureTestAction("apply");
});

restoreTextureButton.addEventListener("click", () => {
  sendTextureTestAction("restore");
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
