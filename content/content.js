// Content executor: perform basic DOM interactions requested by the background
// adapter. The goal is to provide primitives that a Computer Use client can use
// to script tasks: click, type, query, scroll, download, and upload.

function querySingle(selector) {
  return document.querySelector(selector);
}

function queryAll(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function elementDescriptor(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    id: el.id || null,
    classes: el.className || null,
    text: (el.innerText || "").slice(0, 200),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
}

async function handleAction(message) {
  const { action, payload } = message;
  try {
    switch (action) {
      case "find": {
        const nodes = queryAll(payload.selector).map(elementDescriptor);
        return { ok: true, nodes };
      }
      case "click": {
        const el = querySingle(payload.selector);
        if (!el) return { ok: false, error: "not found" };
        el.click();
        return { ok: true };
      }
      case "type": {
        const el = querySingle(payload.selector);
        if (!el) return { ok: false, error: "not found" };
        el.focus();
        el.value = payload.text ?? "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      case "submit": {
        const el = querySingle(payload.selector);
        if (!el) return { ok: false, error: "not found" };
        const form = el.closest("form");
        if (form) form.submit();
        else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return { ok: true };
      }
      case "scroll": {
        window.scrollBy({ top: payload.top ?? 0, left: payload.left ?? 0, behavior: "smooth" });
        return { ok: true };
      }
      case "getHTML": {
        return { ok: true, html: document.documentElement.outerHTML.slice(0, 200000) };
      }
      case "upload": {
        const el = querySingle(payload.selector);
        if (!el) return { ok: false, error: "not found" };
        // Upload requires a user gesture and file handle from the background/client side.
        return { ok: false, error: "upload not implemented in content script" };
      }
      default:
        return { ok: false, error: `unknown action: ${action}` };
    }
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[content] Received message:", message);
  if (!message || !message.action) return;
  if (message.action === "ping") {
    sendResponse({ ok: true });
    return true;
  }
  console.log("[content] Handling action:", message.action, message.payload);
  Promise.resolve(handleAction(message)).then(result => {
    console.log("[content] Action result:", result);
    sendResponse(result);
  });
  return true; // keep the message channel open for async response
});





