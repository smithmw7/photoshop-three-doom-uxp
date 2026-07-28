"use strict";

(() => {
  const TARGET_FRAME_MS = 1000 / 60;
  const SAMPLE_CAPACITY = 600;
  const intervals = new Float64Array(SAMPLE_CAPACITY);
  const hud = document.getElementById("benchmarkHud");

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
    logs: []
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
