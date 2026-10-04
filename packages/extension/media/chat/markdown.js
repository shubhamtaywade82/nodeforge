(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NodeForgeMarkdown = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Safety invariant: all input is HTML-escaped BEFORE any markup is introduced.
  // Only a fixed set of tags is ever emitted; no attributes derived from input, no links, no images.
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdown(text) {
    const codeBlocks = [];
    // Pull fenced blocks out first so inline rules never rewrite code content.
    let html = escapeHtml(String(text).replace(/\u0000/g, "")).replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      codeBlocks.push(`<pre class="code-block"><code>${code.trim()}</code></pre>`);
      return `\u0000${codeBlocks.length - 1}\u0000`;
    });
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);
    const parts = html
      .split(/\n\n+/)
      .map((p) => (p.startsWith("<") || /^\u0000\d+\u0000$/.test(p) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`));
    return parts.join("").replace(/\u0000(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)] ?? "");
  }

  return { escapeHtml, renderMarkdown };
});
