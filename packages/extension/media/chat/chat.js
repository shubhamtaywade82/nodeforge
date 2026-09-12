(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const cancelBtn = document.getElementById("cancel");
  const thinkingEl = document.getElementById("thinking");
  const modelPill = document.getElementById("pill-model");
  const trustPill = document.getElementById("pill-trust");
  const keyPill = document.getElementById("pill-key");

  let streamingContentEl = null;
  let streamRaw = "";

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`\n]+)`/g, "<code class=\"inline-code\">$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, (block) => `<ul>${block}</ul>`);
    const parts = html.split(/\n\n+/).map((p) => (p.startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`));
    return parts.join("");
  }

  function nowLabel() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function createMessageRow(role, label) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "You" : role === "assistant" ? "NF" : "•";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const meta = document.createElement("div");
    meta.className = "meta";
    const roleEl = document.createElement("span");
    roleEl.className = "role";
    roleEl.textContent = label;
    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = nowLabel();
    meta.append(roleEl, timeEl);

    const content = document.createElement("div");
    content.className = "content";

    bubble.append(meta, content);
    row.append(avatar, bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return content;
  }

  function appendUserMessage(text) {
    const content = createMessageRow("user", "You");
    content.textContent = text;
  }

  function beginAssistantMessage() {
    streamRaw = "";
    streamingContentEl = createMessageRow("assistant", "NodeForge");
    setThinking(true);
  }

  function finalizeAssistantMessage() {
    if (!streamingContentEl) return;
    streamingContentEl.innerHTML = renderMarkdown(streamRaw);
    streamingContentEl = null;
    streamRaw = "";
    setThinking(false);
  }

  function appendToolCard(name, ok, durationMs, preview) {
    const card = document.createElement("details");
    card.className = `tool-card ${ok ? "ok" : "fail"}`;
    card.open = !ok;

    const summary = document.createElement("summary");
    summary.innerHTML =
      `<span class="status-dot">${ok ? "●" : "●"}</span>` +
      `<span class="tool-name">${escapeHtml(name)}</span>` +
      `<span class="duration">${durationMs}ms</span>`;

    const pre = document.createElement("pre");
    pre.className = "tool-output";
    pre.textContent = preview || "(no output)";

    card.append(summary, pre);
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendError(message) {
    const el = document.createElement("div");
    el.className = "msg-error";
    el.textContent = message;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setThinking(visible) {
    thinkingEl.classList.toggle("visible", visible);
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    cancelBtn.disabled = !busy;
    inputEl.disabled = busy;
    if (!busy) setThinking(false);
  }

  function autoResizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
  }

  sendBtn.addEventListener("click", () => {
    const text = inputEl.value.trim();
    if (!text) return;
    appendUserMessage(text);
    inputEl.value = "";
    autoResizeInput();
    beginAssistantMessage();
    setBusy(true);
    vscode.postMessage({ type: "send", text });
  });

  cancelBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
  });

  inputEl.addEventListener("input", autoResizeInput);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      inputEl.value = chip.getAttribute("data-cmd") || "";
      inputEl.focus();
      autoResizeInput();
    });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        modelPill.textContent = msg.model || "model";
        trustPill.textContent = msg.trusted ? "Trusted" : "Restricted";
        trustPill.className = `pill ${msg.trusted ? "trusted" : "restricted"}`;
        keyPill.textContent = msg.hasApiKey ? "API key set" : "No API key";
        keyPill.className = `pill ${msg.hasApiKey ? "" : "warn"}`;
        break;
      case "assistantDelta":
        if (streamingContentEl) {
          streamRaw += msg.text;
          streamingContentEl.textContent = streamRaw;
          setThinking(false);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      case "toolStart":
        setThinking(true);
        break;
      case "toolEnd":
        appendToolCard(msg.name, msg.ok, msg.durationMs, msg.preview);
        setThinking(true);
        break;
      case "done":
        finalizeAssistantMessage();
        setBusy(false);
        break;
      case "error":
        setBusy(false);
        if (streamingContentEl && !streamRaw) {
          streamingContentEl.parentElement?.parentElement?.remove();
        } else {
          finalizeAssistantMessage();
        }
        streamingContentEl = null;
        streamRaw = "";
        appendError(msg.message);
        break;
      case "clear":
        messagesEl.innerHTML = "";
        break;
      case "welcome":
        const content = createMessageRow("system", "Welcome");
        content.innerHTML = renderMarkdown(msg.text);
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
