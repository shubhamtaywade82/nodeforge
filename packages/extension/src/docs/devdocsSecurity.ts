/** Pure helpers for hardening the DevDocs webviews. No VS Code imports. */

const DEVDOCS_HOST = "devdocs.io";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only https://devdocs.io (no userinfo, no custom port) is ever embedded or opened externally. */
export function isDevDocsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === DEVDOCS_HOST &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

export const DEVDOCS_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-forms";
