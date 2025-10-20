chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Simple background adapter: relays messages between a local WebSocket server
// (Python client) and active tabs/content scripts. This enables an external
// Computer Use agent to pilot the browser via the extension.

let ws = null;
let reconnectTimer = null;
const WS_URL = "ws://127.0.0.1:8765"; // Local dev WebSocket server
const MAX_PORT_ATTEMPTS = 5;
let lastNavigateAt = 0;
const NAVIGATE_DEBOUNCE_MS = 500;
const processedActionIds = new Set();
const PROCESSED_TTL_MS = 60000;
function rememberActionId(id) {
  if (!id) return;
  processedActionIds.add(id);
  setTimeout(() => processedActionIds.delete(id), PROCESSED_TTL_MS);
}

function connectWebSocket(port = 8765, attempt = 1) {
  const url = `ws://127.0.0.1:${port}`;
  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[adapter] connected to", url);
      chrome.runtime.sendMessage({ type: "ws_status", connected: true, url });
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("[adapter] received message:", message);
        // message: { action: string, payload?: any, tabId?: number }
        if (message && message.type === "plan") {
          sendToUI({ type: "ws_message", message });
          return;
        }
        if (message && message.id && processedActionIds.has(message.id)) {
          // drop duplicates
          return;
        }
        await handleInboundAction(message);
        if (message && message.id) rememberActionId(message.id);
        // forward a copy to sidepanel for logging/telemetry
        chrome.runtime.sendMessage({ type: "ws_message", message });
      } catch (error) {
        console.error("[adapter] invalid message", error);
        chrome.runtime.sendMessage({ type: "ws_error", error: String(error) });
      }
    };

    ws.onclose = () => {
      console.warn("[adapter] disconnected; retrying in 2s");
      chrome.runtime.sendMessage({ type: "ws_status", connected: false, url });
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error("[adapter] websocket error", err);
      try { ws.close(); } catch (_) {}
      
      // Try next port if connection failed
      if (attempt < MAX_PORT_ATTEMPTS) {
        console.log(`[adapter] trying port ${port + 1}`);
        setTimeout(() => connectWebSocket(port + 1, attempt + 1), 1000);
      } else {
        scheduleReconnect();
      }
    };
  } catch (error) {
    console.error("[adapter] connect error", error);
    if (attempt < MAX_PORT_ATTEMPTS) {
      setTimeout(() => connectWebSocket(port + 1, attempt + 1), 1000);
    } else {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }, 2000);
}

function sendToClient(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendToUI(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (_) {}
}

async function handleInboundAction(message) {
  const { action, payload, tabId } = message || {};
  console.log("[adapter] handling action:", action, payload);
  if (!action) return;

  if (action === "ping") {
    // respond only in UI; no need to inform server
    sendToUI({ type: "pong" });
    return;
  }

  // Actions that do not require a content script
  if (action === "getActiveTab") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sendToUI({ type: "activeTab", tab });
    return;
  }

  if (action === "switchTab") {
    if (payload && typeof payload.tabId === "number") {
      await chrome.tabs.update(payload.tabId, { active: true });
      sendToClient({ type: "switchTabResult", ok: true });
    } else {
      sendToClient({ type: "switchTabResult", ok: false, error: "missing tabId" });
    }
    return;
  }

  if (action === "navigate" || action === "navTo") {
    const now = Date.now();
    if (now - lastNavigateAt < NAVIGATE_DEBOUNCE_MS) {
      sendToClient({ type: "result", action, error: "debounced" });
      return;
    }
    lastNavigateAt = now;
    const url = payload && payload.url;
    let target = typeof tabId === "number" ? tabId : undefined;
    if (!target) {
      // Prefer an active normal tab; side panel may not count as a tab
      const candidates = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const normalActive = candidates.find(t => t && t.id && (t.type === undefined || t.type === "normal"));
      target = normalActive && normalActive.id;
    }
    if (!url) {
      sendToUI({ type: "result", action, error: "missing url" });
      return;
    }
    try {
      if (target) {
        await chrome.tabs.update(target, { url });
      } else {
        const created = await chrome.tabs.create({ url, active: true });
        target = created && created.id;
      }
      // Wait for the tab to load and content script to be ready
      if (target) {
        await waitForTabReady(target);
      }
      sendToUI({ type: "result", action, ok: true, tabId: target });
    } catch (e) {
      sendToUI({ type: "result", action, error: String(e) });
    }
    return;
  }

  // Forward to content script in specified or active tab
  const targetTabId = typeof tabId === "number"
    ? tabId
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

  if (!targetTabId) {
    sendToClient({ type: "error", error: "no target tab" });
    return;
  }

  try {
    // Ensure content script is ready before sending message
    await waitForTabReady(targetTabId);
    console.log("[background] Sending action to content script:", { action, payload });
    const response = await chrome.tabs.sendMessage(targetTabId, { action, payload });
    console.log("[background] Received response from content script:", response);
    sendToUI({ type: "result", action, response });
  } catch (error) {
    console.log("[background] Error sending message to content script:", error);
    sendToUI({ type: "result", action, error: String(error) });
  }
}

// Relay messages from content scripts back to the client
chrome.runtime.onMessage.addListener((msg, sender) => {
  try {
    // Avoid forwarding sidepanel UI messages to the server
    const isSidepanel = sender && sender.url && sender.url.includes("/sidepanel/index.html");
    const isUiMsg = msg && typeof msg.type === "string" && msg.type.startsWith("ui_");
    if (isSidepanel || isUiMsg) {
      return;
    }
    // Forward content updates only to UI for logging; do not send to server
    sendToUI({ type: "fromContent", msg, sender });
  } catch (_) {}
});

// Receive commands from sidepanel UI and forward to the WebSocket server
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ui_task") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "task", task: msg.task || "" }));
        sendResponse && sendResponse({ ok: true });
      } catch (e) {
        sendResponse && sendResponse({ ok: false, error: String(e) });
      }
    } else {
      sendResponse && sendResponse({ ok: false, error: "WebSocket not connected" });
    }
    return true;
  }
  if (msg.type === "ui_status") {
    const connected = !!(ws && ws.readyState === WebSocket.OPEN);
    sendResponse && sendResponse({ ok: true, connected });
    return true;
  }
});

async function waitForTabReady(tabId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { action: "ping" });
      return; // Content script is ready
    } catch (error) {
      // Content script not ready yet, wait a bit
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error("Content script not ready after waiting");
}

connectWebSocket();
