import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { open, save } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import { invoke } from "@tauri-apps/api/core";
import welcomeMd from "./welcome.md?raw";

// ---------- state ----------
let crepe: Crepe | null = null;
let currentPath: string | null = null;
let savedMarkdown = "";
let dirty = false;
let countVisible = localStorage.getItem("typeel-wordcount") !== "off";
let themeName = localStorage.getItem("typeel-theme-name") || "b";
let darkMode = (localStorage.getItem("typeel-theme") || "dark") === "dark";
let outlineHeadings: HTMLElement[] = [];
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let sidebarCollapsed = localStorage.getItem("typeel-sidebar") === "hidden";
let editorFont = localStorage.getItem("typeel-font") || "source";
// While viewing the pinned Welcome doc, we stash the working document here so
// the user can return to it (including unsaved, untitled content) — see #2.
let stashed: { content: string; path: string | null; title: string; dirty: boolean } | null = null;
let viewingWelcome = false;

const editorEl = document.getElementById("editor") as HTMLElement;
const titleEl = document.getElementById("doc-title") as HTMLElement;
const dirtyDot = document.getElementById("dirty-dot") as HTMLElement;
const outlineEl = document.getElementById("outline") as HTMLElement;
const welcomeRow = document.getElementById("welcome-row") as HTMLElement;
const wordcountBtn = document.getElementById("wordcount") as HTMLElement;
const blocktypeEl = document.getElementById("blocktype") as HTMLElement;
const themeBtn = document.getElementById("theme-btn") as HTMLElement;
const themeMenu = document.getElementById("theme-menu") as HTMLElement;
const exportBtn = document.getElementById("export-btn") as HTMLElement;
const exportMenu = document.getElementById("export-menu") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;
const sidebarToggle = document.getElementById("sidebar-toggle") as HTMLElement;
const sidebarShow = document.getElementById("sidebar-show") as HTMLElement;
const returnRow = document.getElementById("return-row") as HTMLElement;
const fontBtn = document.getElementById("font-btn") as HTMLElement;
const fontMenu = document.getElementById("font-menu") as HTMLElement;

// ---------- editor lifecycle ----------
async function mountEditor(content: string): Promise<void> {
  if (crepe) {
    await crepe.destroy();
    crepe = null;
  }
  editorEl.innerHTML = "";

  crepe = new Crepe({ root: editorEl, defaultValue: content });
  await crepe.create();

  savedMarkdown = content;
  setDirty(false);

  // Optional: use Crepe's listener API if available (best-effort, version-safe)
  try {
    (crepe as unknown as { on?: (cb: (l: { markdownUpdated?: (fn: () => void) => void }) => void) => void })
      .on?.((listener) => listener.markdownUpdated?.(() => onEdit()));
  } catch {
    /* listener API is optional; DOM input events below are the reliable signal */
  }

  updateWordCount();
  updateOutline();
}

function onEdit(): void {
  if (!dirty) setDirty(true);
}

function setDirty(value: boolean): void {
  dirty = value;
  dirtyDot.classList.toggle("hidden", !value);
}

function getContent(): string {
  try {
    return crepe ? crepe.getMarkdown() : savedMarkdown;
  } catch {
    // getMarkdown can throw on malformed nodes; fall back to last good content
    return savedMarkdown;
  }
}

// ---------- word count ----------
function updateWordCount(): void {
  if (!countVisible) {
    wordcountBtn.textContent = "Word count";
    return;
  }
  const text = (editorEl.innerText || "").replace(/\u200b/g, "").trim();
  const n = text ? (text.match(/\S+/g) || []).length : 0;
  wordcountBtn.textContent = n.toLocaleString() + (n === 1 ? " word" : " words");
}

function toggleWordCount(): void {
  countVisible = !countVisible;
  localStorage.setItem("typeel-wordcount", countVisible ? "on" : "off");
  updateWordCount();
}

// ---------- current block type ----------
function updateBlockType(): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  const el =
    node && node.nodeType === 3 ? node.parentElement : (node as Element | null);
  if (!el || !editorEl.contains(el)) return;

  let label = "Text";
  const h = el.closest("h1,h2,h3,h4,h5,h6");
  if (h) {
    label = "Heading " + h.tagName.charAt(1);
  } else if (el.closest("pre")) {
    label = "Code block";
  } else if (el.closest("blockquote")) {
    label = "Quote";
  } else {
    const li = el.closest("li");
    if (li) {
      if (li.querySelector('input[type="checkbox"]')) label = "Task item";
      else label = li.closest("ol") ? "Numbered item" : "Bullet item";
    } else if (el.closest("td,th")) {
      label = "Table cell";
    } else if (el.closest("p")) {
      label = "Paragraph";
    }
  }
  blocktypeEl.textContent = label;
}

// ---------- file operations ----------
// Local images in a Markdown file are written relative to that file's folder,
// but the editor runs from the app's own origin, so those paths resolve to
// nothing. On load we read each local image through Rust and inline it as a
// base64 data URL (which renders anywhere), remembering the originals so we can
// write them back as-is on save. Remote (http/data/…) images are left untouched.
let imageMap = new Map<string, string>(); // dataUrl -> original src as written

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

function isExternalSrc(src: string): boolean {
  return (
    /^(https?:|data:|asset:|blob:|tauri:|file:|#)/i.test(src) ||
    src.startsWith("//")
  );
}

function isAbsoluteSrc(src: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(src);
}

function resolvePath(dir: string, rel: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const parts = dir ? dir.split(/[\\/]/) : [];
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join(sep);
}

const IMG_MD = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;
const IMG_HTML = /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi;

async function localizeImages(md: string, fileDir: string): Promise<string> {
  imageMap = new Map();
  const local = new Map<string, string>(); // original src -> data URL

  // Collect every distinct local image reference first.
  const found = new Set<string>();
  for (const re of [IMG_MD, IMG_HTML]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md))) {
      if (!isExternalSrc(m[2])) found.add(m[2]);
    }
  }

  // Inline each one as a data URL (failures leave the original path in place).
  for (const src of found) {
    const abs = isAbsoluteSrc(src) ? src : resolvePath(fileDir, src);
    try {
      const dataUrl = await invoke<string>("read_image_data_url", { path: abs });
      local.set(src, dataUrl);
      imageMap.set(dataUrl, src);
    } catch {
      /* image missing or unreadable — leave it as written */
    }
  }

  const sub = (src: string): string => local.get(src) || src;
  return md
    .replace(IMG_MD, (_m, a, src, b) => a + sub(src) + b)
    .replace(IMG_HTML, (_m, a, src, b) => a + sub(src) + b);
}

function delocalizeImages(md: string): string {
  for (const [url, orig] of imageMap) md = md.split(url).join(orig);
  return md;
}

async function openFileDialog(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }],
  });
  if (typeof selected !== "string") return;
  await loadFile(selected);
}

async function loadFile(path: string): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  try {
    const content = await invoke<string>("read_file", { path });
    const display = await localizeImages(content, dirOf(path));
    currentPath = path;
    titleEl.textContent = basename(path);
    await mountEditor(display);
    welcomeRow.classList.remove("active");
    clearStash();
  } catch (e) {
    alert("Could not open file:\n" + e);
  }
}

async function saveFile(): Promise<void> {
  const editorContent = getContent();
  const fileContent = delocalizeImages(editorContent);
  let path = currentPath;

  if (!path) {
    const chosen = await save({
      defaultPath: "untitled.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!chosen) return;
    path = chosen;
    currentPath = path;
    titleEl.textContent = basename(path);
  }

  try {
    await invoke("write_file", { path, contents: fileContent });
    savedMarkdown = editorContent;
    setDirty(false);
  } catch (e) {
    alert("Could not save file:\n" + e);
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

// ---------- new / welcome ----------
function clearStash(): void {
  stashed = null;
  viewingWelcome = false;
  returnRow.classList.add("hidden");
}

async function newFile(): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  currentPath = null;
  titleEl.textContent = "Untitled";
  await mountEditor("");
  welcomeRow.classList.remove("active");
  clearStash();
}

// Open the pinned Welcome doc for reference WITHOUT losing the working file:
// the current document is stashed and a "return" row appears in the sidebar.
async function loadWelcome(): Promise<void> {
  if (viewingWelcome) return;
  stashed = {
    content: getContent(),
    path: currentPath,
    title: titleEl.textContent || "Untitled",
    dirty,
  };
  returnRow.textContent = "\u2190 " + stashed.title;
  returnRow.classList.remove("hidden");
  viewingWelcome = true;

  currentPath = null;
  titleEl.textContent = "Welcome";
  await mountEditor(welcomeMd);
  welcomeRow.classList.add("active");
}

// Restore the document that was open before the user clicked Welcome.
async function returnToStashed(): Promise<void> {
  if (!stashed) return;
  const s = stashed;
  currentPath = s.path;
  titleEl.textContent = s.title;
  await mountEditor(s.content); // mountEditor resets dirty to false…
  if (s.dirty) setDirty(true); // …so re-apply the unsaved marker if needed
  welcomeRow.classList.remove("active");
  clearStash();
}

// ---------- document outline (headings of the current file) ----------
function updateOutline(): void {
  const headings = Array.from(
    editorEl.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  outlineHeadings = headings;
  outlineEl.innerHTML = "";

  if (headings.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No headings in this document yet.";
    outlineEl.appendChild(hint);
    return;
  }

  headings.forEach((h, i) => {
    const level = Number(h.tagName.charAt(1));
    const item = document.createElement("button");
    item.className = "outline-item lvl-" + level;
    item.textContent = h.textContent?.trim() || "Untitled heading";
    item.addEventListener("click", () => {
      const target = outlineHeadings[i];
      if (target && target.isConnected) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    outlineEl.appendChild(item);
  });

  highlightOutline();
}

// Debounced rebuild while typing.
function scheduleOutline(): void {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(updateOutline, 250);
}

// Mark the outline entry for the section the cursor is currently in.
function highlightOutline(): void {
  const items = outlineEl.querySelectorAll<HTMLElement>(".outline-item");
  if (items.length === 0) return;

  const sel = document.getSelection();
  let activeIdx = -1;
  const anchor = sel && sel.anchorNode;
  if (anchor && editorEl.contains(anchor)) {
    for (let i = 0; i < outlineHeadings.length; i++) {
      const pos = outlineHeadings[i].compareDocumentPosition(anchor);
      const headingIsBeforeCaret =
        (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ||
        (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0;
      if (headingIsBeforeCaret) activeIdx = i;
      else break;
    }
  }

  items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
}

// ---------- export ----------
const DOC_CSS = `
  .doc {
    max-width: 720px;
    margin: 0 auto;
    padding: 56px 32px 80px;
    background: #ffffff;
    color: #1f2328;
    font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.7;
    font-size: 16px;
  }
  .doc h1, .doc h2, .doc h3, .doc h4 { line-height: 1.25; font-weight: 600; margin: 1.6em 0 .5em; }
  .doc h1 { font-size: 2em; margin-top: 0; }
  .doc h2 { font-size: 1.5em; }
  .doc h3 { font-size: 1.25em; }
  .doc p, .doc ul, .doc ol, .doc blockquote, .doc pre, .doc table { margin: 0 0 1em; }
  .doc a { color: #3056d3; text-decoration: none; }
  .doc code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .9em; background: #f1f1f3; padding: .15em .4em; border-radius: 4px;
  }
  .doc pre { background: #f6f6f8; padding: 14px 16px; border-radius: 8px; overflow: auto; }
  .doc pre code { background: none; padding: 0; }
  .doc blockquote { border-left: 3px solid #d0d0d6; padding-left: 16px; color: #57606a; margin-left: 0; }
  .doc table { border-collapse: collapse; width: 100%; }
  .doc th, .doc td { border: 1px solid #d0d0d6; padding: 7px 12px; text-align: left; }
  .doc th { background: #f6f6f8; }
  .doc img { max-width: 100%; }
  .doc hr { border: none; border-top: 1px solid #e2e2e6; margin: 2em 0; }
  .doc li { margin: .25em 0; }
  .doc input[type="checkbox"] { margin-right: .4em; }
`;

function docName(): string {
  if (currentPath) {
    return basename(currentPath).replace(/\.[^.]+$/, "") || "Untitled";
  }
  return titleEl.textContent?.trim() || "Untitled";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function docBodyHtml(): string {
  return marked.parse(getContent(), { gfm: true }) as string;
}

function buildExportHtml(autoPrint = false): string {
  const printScript = autoPrint
    ? `<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},350);});<\/script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docName())}</title>
<style>html, body { margin: 0; background: #ffffff; }
@page { margin: 18mm; }
${DOC_CSS}</style>
</head>
<body><main class="doc">${docBodyHtml()}</main>${printScript}</body>
</html>`;
}

async function exportHtml(): Promise<void> {
  const chosen = await save({
    defaultPath: docName() + ".html",
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!chosen) return;
  try {
    await invoke("write_file", { path: chosen, contents: buildExportHtml() });
  } catch (e) {
    alert("Could not export HTML:\n" + e);
  }
}

// macOS WebKit (and thus the Tauri webview) does not implement JavaScript
// printing, so we render the document to a temp file and open it in the
// user's default browser, where the print dialog appears automatically and
// "Save as PDF" is reliably available on every platform.
async function exportPdf(): Promise<void> {
  try {
    await invoke("open_html_in_browser", {
      html: buildExportHtml(true),
      name: docName(),
    });
  } catch (e) {
    alert("Could not open the document for PDF export:\n" + e);
  }
}

// ---------- theme ----------
function applyTheme(): void {
  if (themeName !== "bw" && themeName !== "b" && themeName !== "c") themeName = "b";
  const root = document.documentElement;
  root.dataset.theme = themeName;
  root.classList.toggle("dark", darkMode);
  localStorage.setItem("typeel-theme-name", themeName);
  localStorage.setItem("typeel-theme", darkMode ? "dark" : "light");
  themeMenu.querySelectorAll<HTMLElement>(".theme-opt").forEach((o) =>
    o.classList.toggle("active", o.dataset.name === themeName),
  );
}

function setTheme(name: string): void {
  themeName = name;
  applyTheme();
}

function toggleDark(): void {
  darkMode = !darkMode;
  applyTheme();
}

// ---------- sidebar collapse ----------
function setSidebar(collapsed: boolean): void {
  sidebarCollapsed = collapsed;
  appEl.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("typeel-sidebar", collapsed ? "hidden" : "shown");
}

// ---------- editor font ----------
const FONT_STACK: Record<string, string> = {
  source: '"Source Sans 3", ui-sans-serif, sans-serif',
  sulphur: '"Sulphur Point", ui-sans-serif, sans-serif',
  ysabeau: '"Ysabeau Infant", ui-sans-serif, sans-serif',
};

function applyFont(key: string): void {
  if (!FONT_STACK[key]) key = "source";
  editorFont = key;
  document.documentElement.style.setProperty("--editor-font", FONT_STACK[key]);
  localStorage.setItem("typeel-font", key);
  fontMenu.querySelectorAll<HTMLElement>(".drop-item").forEach((o) =>
    o.classList.toggle("active", o.dataset.font === key),
  );
}

// ---------- wiring ----------
document.getElementById("new-file")!.addEventListener("click", newFile);
document.getElementById("open-file")!.addEventListener("click", openFileDialog);
document.getElementById("save-file")!.addEventListener("click", saveFile);
welcomeRow.addEventListener("click", loadWelcome);
returnRow.addEventListener("click", returnToStashed);
sidebarToggle.addEventListener("click", () => setSidebar(true));
sidebarShow.addEventListener("click", () => setSidebar(false));
document.getElementById("toggle-theme")!.addEventListener("click", toggleDark);

fontBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fontMenu.classList.toggle("hidden");
});
fontMenu.querySelectorAll<HTMLElement>(".drop-item").forEach((item) => {
  item.addEventListener("click", () => {
    applyFont(item.dataset.font || "source");
    fontMenu.classList.add("hidden");
  });
});

themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  themeMenu.classList.toggle("hidden");
});
themeMenu.querySelectorAll<HTMLElement>(".theme-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    setTheme(opt.dataset.name || "b");
    themeMenu.classList.add("hidden");
  });
});
exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle("hidden");
});
exportMenu.querySelectorAll<HTMLElement>(".drop-item").forEach((item) => {
  item.addEventListener("click", () => {
    exportMenu.classList.add("hidden");
    if (item.dataset.fmt === "pdf") exportPdf();
    else exportHtml();
  });
});
document.addEventListener("click", (e) => {
  const t = e.target as Node;
  if (e.target !== themeBtn && !themeMenu.contains(t)) themeMenu.classList.add("hidden");
  if (e.target !== exportBtn && !exportMenu.contains(t)) exportMenu.classList.add("hidden");
  if (e.target !== fontBtn && !fontMenu.contains(t)) fontMenu.classList.add("hidden");
});

// reliable dirty signal: any input inside the editor surface
editorEl.addEventListener("input", () => {
  onEdit();
  updateWordCount();
  updateBlockType();
  scheduleOutline();
}, true);

document.addEventListener("selectionchange", () => {
  updateBlockType();
  highlightOutline();
});

wordcountBtn.addEventListener("click", toggleWordCount);

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveFile();
  } else if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    openFileDialog();
  } else if (mod && e.key.toLowerCase() === "n") {
    e.preventDefault();
    newFile();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

applyTheme();
setSidebar(sidebarCollapsed);
applyFont(editorFont);
// Show Welcome as the initial document — it's the base doc, so there is nothing
// to stash or return to yet (that only happens once a working file is open).
void (async () => {
  currentPath = null;
  titleEl.textContent = "Welcome";
  await mountEditor(welcomeMd);
  welcomeRow.classList.add("active");
  viewingWelcome = true;
})();
