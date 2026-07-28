"use strict";

(() => {
  const TARGET_FRAME_MS = 1000 / 60;
  const SAMPLE_CAPACITY = 600;
  const intervals = new Float64Array(SAMPLE_CAPACITY);
  const hud = document.getElementById("benchmarkHud");
  const texturePicker = document.getElementById("texturePicker");
  const texturePickerCount = document.getElementById("texturePickerCount");
  const texturePickerClose = document.getElementById("texturePickerClose");
  const textureGrid = document.getElementById("textureGrid");
  let texturePickerBuildSequence = 0;

  const state = {
    phase: "booting",
    label: "Loading WAD and WebGL…",
    startedAt: 0,
    lastFrameAt: 0,
    frames: 0,
    droppedFrames: 0,
    sampleCount: 0,
    sampleCursor: 0,
    fps: 0,
    p95Ms: 0,
    renderer: "Waiting for WebGL",
    bootStep: "benchmark.js started",
    lastError: "",
    logs: [],
    liveTextureTest: {
      name: "COMPUTE2",
      active: false,
      lastResult: null
    },
    texturePicker: {
      open: false,
      selected: "COMPUTE2",
      count: 0,
      liveCount: 0,
      rendered: 0
    }
  };

  function postToHost(message) {
    try {
      if (window.uxpHost && window.uxpHost.postMessage) {
        window.uxpHost.postMessage({
          source: "three-doom-benchmark",
          ...message
        });
      }
    } catch (error) {
      console.warn("UXP host message failed", error);
    }
  }

  function formatDetails(value) {
    if (value === undefined || value === null) {
      return "";
    }
    if (value instanceof Error) {
      return value.stack || `${value.name}: ${value.message}`;
    }
    return String(value);
  }

  function reportLog(level, message, details) {
    const detailText = formatDetails(details);
    state.bootStep = message;
    state.logs.push({
      level,
      message,
      details: detailText
    });
    if (state.logs.length > 30) {
      state.logs.shift();
    }
    const suffix = detailText ? ` · ${detailText}` : "";
    if (level === "warn") {
      console.warn(`[Doom boot] ${message}${suffix}`);
    } else {
      console.log(`[Doom boot] ${message}${suffix}`);
    }
    postToHost({
      type: "log",
      level,
      message,
      details: detailText
    });
  }

  function reportError(message, details) {
    const detailText = formatDetails(details);
    const fingerprint = `${message}|${detailText}`;
    if (state.lastError === fingerprint) {
      return;
    }
    state.lastError = fingerprint;
    state.phase = "error";
    state.label = message;
    state.bootStep = message;
    state.logs.push({
      level: "error",
      message,
      details: detailText
    });
    if (state.logs.length > 30) {
      state.logs.shift();
    }
    const suffix = detailText ? ` · ${detailText}` : "";
    console.error(`[Doom boot] ${message}${suffix}`);
    postToHost({
      type: "error",
      message,
      details: detailText
    });
  }

  window.__doomBenchmarkReportLog = reportLog;
  window.__doomBenchmarkReportError = reportError;

  function runLiveTextureTest(
    action,
    textureName = "COMPUTE2",
    payload = {}
  ) {
    let operation;
    if (action === "apply") {
      operation = window.__doomLiveTextureApply;
    } else if (action === "applyPixels") {
      operation = window.__doomLiveTextureApplyPixels;
    } else {
      operation = window.__doomLiveTextureRestore;
    }
    let result;
    if (typeof operation !== "function") {
      result = {
        ok: false,
        active: false,
        error: "Doom texture system is not ready"
      };
    } else {
      try {
        result = action === "applyPixels"
          ? operation(
            textureName,
            payload.width,
            payload.height,
            payload.rgba
          )
          : operation(textureName);
      } catch (error) {
        result = {
          ok: false,
          active: false,
          error: formatDetails(error)
        };
      }
    }
    state.liveTextureTest.name = textureName;
    state.liveTextureTest.active = result.ok && result.active === true;
    state.liveTextureTest.lastResult = result;
    reportLog(
      result.ok ? "info" : "warn",
      result.ok
        ? (
          result.active
            ? (result.meshes === 0
              ? "Texture stored; not used in this map"
              : (
                result.source === "photoshop"
                  ? "Photoshop texture applied"
                  : "Live texture test applied"
              ))
            : "Live texture restored"
        )
        : "Live texture test failed",
      result.ok
        ? `${result.name} · ${result.width}x${result.height}` +
          ` · ${result.meshes} meshes · no reload` +
          (result.paletteColors
            ? ` · ${result.paletteColors} palette colors`
            : "")
        : result.error
    );
    postToHost({
      type: "liveTextureTest",
      result
    });
    return result;
  }

  function exportLiveTexture(textureName = "COMPUTE2", requestId) {
    let result;
    if (typeof window.__doomLiveTextureExport !== "function") {
      result = {
        ok: false,
        error: "Doom texture system is not ready"
      };
    } else {
      try {
        result = window.__doomLiveTextureExport(textureName);
      } catch (error) {
        result = {
          ok: false,
          error: formatDetails(error)
        };
      }
    }
    reportLog(
      result.ok ? "info" : "warn",
      result.ok ? "Texture exported to Photoshop" : "Texture export failed",
      result.ok
        ? `${result.name} · ${result.width}x${result.height}`
        : result.error
    );
    postToHost({
      type: "liveTextureExport",
      requestId,
      result
    });
    return result;
  }

  function closeTexturePicker() {
    texturePicker.hidden = true;
    state.texturePicker.open = false;
  }

  function selectWallTexture(texture, card) {
    state.texturePicker.selected = texture.name;
    const previous = textureGrid.querySelector(".texture-card.is-selected");
    if (previous) {
      previous.classList.remove("is-selected");
    }
    card.classList.add("is-selected");
    closeTexturePicker();
    reportLog(
      "info",
      "Wall texture selected",
      `${texture.name} · ${texture.width}x${texture.height}`
    );
    postToHost({
      type: "liveTextureSelected",
      texture
    });
  }

  function createTextureCard(texture, selectedName) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "texture-card";
    card.setAttribute("role", "listitem");
    card.dataset.textureName = texture.name;
    card.title =
      `Select ${texture.name} (${texture.width}×${texture.height})`;
    if (texture.name === selectedName) {
      card.classList.add("is-selected");
    }
    if (texture.meshes === 0) {
      card.classList.add("is-off-map");
    }

    const canvas = document.createElement("canvas");
    canvas.className = "texture-preview";
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.setAttribute("aria-hidden", "true");
    card.appendChild(canvas);

    const copy = document.createElement("span");
    copy.className = "texture-card-copy";
    const name = document.createElement("span");
    name.className = "texture-card-name";
    name.textContent = texture.name;
    const size = document.createElement("span");
    size.className = "texture-card-size";
    size.textContent =
      `${texture.width}×${texture.height} · ` +
      (texture.meshes > 0 ? `LIVE ${texture.meshes}` : "OFF MAP");
    copy.appendChild(name);
    copy.appendChild(size);
    card.appendChild(copy);

    try {
      const result = window.__doomLiveTextureExport(texture.name);
      if (result && result.ok) {
        const context = canvas.getContext("2d");
        const image = context.createImageData(texture.width, texture.height);
        image.data.set(result.rgba);
        context.putImageData(image, 0, 0);
      }
    } catch (error) {
      card.title = `${card.title} · Preview failed: ${formatDetails(error)}`;
    }

    card.addEventListener("click", () => {
      selectWallTexture(texture, card);
    });
    return card;
  }

  async function populateTextureGrid(
    textures,
    selectedName,
    buildSequence
  ) {
    textureGrid.textContent = "";
    state.texturePicker.rendered = 0;
    for (let index = 0; index < textures.length; index += 1) {
      if (buildSequence !== texturePickerBuildSequence) {
        return;
      }
      textureGrid.appendChild(
        createTextureCard(textures[index], selectedName)
      );
      state.texturePicker.rendered = index + 1;
      texturePickerCount.textContent =
        `${state.texturePicker.liveCount} live · ` +
        `${state.texturePicker.rendered}/${textures.length} loaded`;
      if ((index + 1) % 8 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    if (buildSequence === texturePickerBuildSequence) {
      texturePickerCount.textContent =
        `${state.texturePicker.liveCount} in map · ` +
        `${textures.length} total`;
    }
  }

  function showTexturePicker(selectedName = state.texturePicker.selected) {
    let textures;
    if (typeof window.__doomLiveTextureList !== "function") {
      reportError(
        "Texture picker unavailable",
        "Doom texture system is not ready"
      );
      return;
    }
    try {
      textures = window.__doomLiveTextureList();
    } catch (error) {
      reportError("Texture picker failed", error);
      return;
    }
    state.texturePicker.open = true;
    state.texturePicker.selected = selectedName;
    state.texturePicker.count = textures.length;
    state.texturePicker.liveCount =
      textures.filter((texture) => texture.meshes > 0).length;
    texturePicker.hidden = false;
    texturePickerCount.textContent =
      `${state.texturePicker.liveCount} live · 0/${textures.length} loaded`;
    const buildSequence = ++texturePickerBuildSequence;
    populateTextureGrid(textures, selectedName, buildSequence).catch((error) => {
      reportError("Texture picker failed", error);
    });
  }

  window.__doomBenchmarkRunLiveTextureTest = runLiveTextureTest;
  window.__doomBenchmarkExportLiveTexture = exportLiveTexture;
  window.__doomBenchmarkShowTexturePicker = showTexturePicker;

  texturePickerClose.addEventListener("click", closeTexturePicker);
  ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].forEach(
    (eventName) => {
      texturePicker.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    }
  );
  window.addEventListener("keydown", (event) => {
    if (state.texturePicker.open && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeTexturePicker();
    }
  }, true);

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      (window.uxpHost && event.source !== window.uxpHost) ||
      !data ||
      data.source !== "three-doom-host"
    ) {
      return;
    }
    if (data.type === "texturePicker" && data.action === "show") {
      showTexturePicker(data.selected);
      return;
    }
    if (data.type !== "liveTextureTest") {
      return;
    }
    if (data.action === "export") {
      exportLiveTexture(data.texture, data.requestId);
      return;
    }
    runLiveTextureTest(data.action, data.texture, data);
  });

  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url =
        typeof input === "string"
          ? input
          : input && input.url
            ? input.url
            : String(input);
      reportLog("info", "Fetch started", url);
      try {
        const response = await nativeFetch(...args);
        reportLog(
          response.ok ? "info" : "warn",
          "Fetch completed",
          `${url} · status ${response.status} · ok ${response.ok}`
        );
        return response;
      } catch (error) {
        reportError("Fetch failed", `${url} · ${formatDetails(error)}`);
        throw error;
      }
    };
  } else {
    reportError("Fetch API unavailable");
  }

  function recordInterval(deltaMs) {
    intervals[state.sampleCursor] = deltaMs;
    state.sampleCursor = (state.sampleCursor + 1) % SAMPLE_CAPACITY;
    state.sampleCount = Math.min(
      state.sampleCount + 1,
      SAMPLE_CAPACITY
    );
    state.droppedFrames += Math.max(
      0,
      Math.round(deltaMs / TARGET_FRAME_MS) - 1
    );
  }

  function calculateP95() {
    if (state.sampleCount === 0) {
      return 0;
    }
    const samples = [];
    for (let index = 0; index < state.sampleCount; index += 1) {
      samples.push(intervals[index]);
    }
    samples.sort((left, right) => left - right);
    const rank = Math.ceil(samples.length * 0.95) - 1;
    return samples[Math.max(0, rank)];
  }

  function detectRenderer() {
    const canvas = document.querySelector("#container canvas");
    if (!canvas) {
      return null;
    }
    const webgl2 = canvas.getContext("webgl2");
    const gl = webgl2 || canvas.getContext("webgl");
    if (!gl) {
      return {
        label: "Canvas present; WebGL context unavailable",
        renderer: "No WebGL context"
      };
    }
    const attributes = gl.getContextAttributes
      ? gl.getContextAttributes()
      : null;
    const retained =
      attributes && attributes.preserveDrawingBuffer === true;
    return {
      label:
        `Doom running · ${webgl2 ? "WebGL 2" : "WebGL 1"}` +
        (retained ? " · retained frame" : ""),
      renderer: String(gl.getParameter(gl.RENDERER) || "WebGL")
    };
  }

  function updateMetrics(now) {
    const elapsedMs = Math.max(0, now - state.startedAt);
    state.fps = elapsedMs > 0
      ? (state.frames * 1000) / elapsedMs
      : 0;
    state.p95Ms = calculateP95();

    hud.textContent =
      `${state.label}\n` +
      `${state.fps.toFixed(1)} FPS  ·  P95 ${state.p95Ms.toFixed(1)} ms\n` +
      `Dropped ${state.droppedFrames}\n` +
      state.renderer;

    postToHost({
      type: "metrics",
      label: state.label,
      fps: state.fps,
      p95Ms: state.p95Ms,
      droppedFrames: state.droppedFrames,
      renderer: state.renderer
    });
  }

  let nextMetricsAt = 0;
  function benchmarkFrame(now) {
    if (state.startedAt === 0) {
      state.startedAt = now;
      state.lastFrameAt = now;
      nextMetricsAt = now;
    } else {
      const deltaMs = Math.max(0, now - state.lastFrameAt);
      state.lastFrameAt = now;
      state.frames += 1;
      recordInterval(deltaMs);
    }

    const rendererInfo = detectRenderer();
    if (rendererInfo) {
      state.phase = rendererInfo.renderer === "No WebGL context"
        ? "error"
        : "webgl";
      state.label = rendererInfo.label;
      state.renderer = rendererInfo.renderer;
    }

    if (now >= nextMetricsAt) {
      updateMetrics(now);
      nextMetricsAt = now + 500;
    }

    requestAnimationFrame(benchmarkFrame);
  }

  window.__doomBenchmarkMarkLoaded = () => {
    const now = performance.now();
    state.phase = "running";
    state.label = "Doom running";
    state.startedAt = now;
    state.lastFrameAt = now;
    state.frames = 0;
    state.droppedFrames = 0;
    state.sampleCount = 0;
    state.sampleCursor = 0;
    state.fps = 0;
    state.p95Ms = 0;
    intervals.fill(0);
    nextMetricsAt = now;
    postToHost({
      type: "status",
      label: "Doom running"
    });
    reportLog("info", "Doom startup completed");
  };

  window.render_game_to_text = () => JSON.stringify({
    coordinateSystem: "Three.js camera inside responsive WebGL viewport",
    mode: state.phase,
    label: state.label,
    frames: state.frames,
    fps: Number(state.fps.toFixed(2)),
    p95Ms: Number(state.p95Ms.toFixed(2)),
    droppedFrames: state.droppedFrames,
    renderer: state.renderer,
    bootStep: state.bootStep,
    lastError: state.lastError,
    liveTextureTest: state.liveTextureTest,
    texturePicker: state.texturePicker,
    logs: state.logs.slice(-8),
    controls: "WASD move, arrows turn, Ctrl fire, Space use, Esc menu"
  });

  window.advanceTime = (milliseconds) => new Promise((resolve) => {
    const start = performance.now();
    function waitFrame(now) {
      if (now - start >= milliseconds) {
        resolve();
        return;
      }
      requestAnimationFrame(waitFrame);
    }
    requestAnimationFrame(waitFrame);
  });

  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) {
      const resource =
        event.target.src ||
        event.target.href ||
        event.target.tagName ||
        "unknown resource";
      reportError("Resource failed to load", resource);
      return;
    }
    reportError(
      event.message || "Unknown WebView error",
      event.error || `${event.filename || ""}:${event.lineno || 0}`
    );
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    reportError(
      "Unhandled promise rejection",
      event.reason || "No rejection reason"
    );
  });

  reportLog("info", "WebView diagnostic bridge ready", location.href);
  postToHost({
    type: "status",
    label: state.label
  });
  requestAnimationFrame(benchmarkFrame);

  let bundleReady = false;
  window.__doomBenchmarkBundleReady = (bootPromise) => {
    bundleReady = true;
    reportLog("info", "Bundled Doom script initialized");
    bootPromise.catch((error) => {
      reportError("Doom bundle/startup failed", error);
    });
  };

  reportLog("info", "Waiting for bundled Doom script", "./doom.bundle.js");
  setTimeout(() => {
    if (!bundleReady) {
      reportError(
        "Doom bundle did not initialize",
        "doom.bundle.js did not signal readiness within 3 seconds"
      );
    }
  }, 3000);

  setTimeout(() => {
    if (
      state.renderer === "Waiting for WebGL" &&
      state.phase !== "webgl"
    ) {
      reportError(
        "Doom boot stalled before WebGL",
        `Last completed step: ${state.bootStep}`
      );
    }
  }, 15000);
})();
