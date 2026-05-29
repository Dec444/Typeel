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
let themeName = localStorage.getItem("typeel-theme-name") || "a";
let darkMode = (localStorage.getItem("typeel-theme") || "dark") === "dark";

const editorEl = document.getElementById("editor") as HTMLElement;
const titleEl = document.getElementById("doc-title") as HTMLElement;
const dirtyDot = document.getElementById("dirty-dot") as HTMLElement;
const treeEl = document.getElementById("file-tree") as HTMLElement;
const folderTreeEl = document.getElementById("folder-tree") as HTMLElement;
const welcomeRow = document.getElementById("welcome-row") as HTMLElement;
const wordcountBtn = document.getElementById("wordcount") as HTMLElement;
const blocktypeEl = document.getElementById("blocktype") as HTMLElement;
const themeBtn = document.getElementById("theme-btn") as HTMLElement;
const themeMenu = document.getElementById("theme-menu") as HTMLElement;
const exportBtn = document.getElementById("export-btn") as HTMLElement;
const exportMenu = document.getElementById("export-menu") as HTMLElement;

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
async function openFileDialog(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }],
  });
  if (typeof selected !== "string") return;
  await loadFile(selected);
  // Reveal the file's folder + siblings in the sidebar.
  await showFolder(dirname(selected));
  highlightActive(selected);
}

async function loadFile(path: string): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  try {
    const content = await invoke<string>("read_file", { path });
    currentPath = path;
    titleEl.textContent = basename(path);
    await mountEditor(content);
    highlightActive(path);
  } catch (e) {
    alert("Could not open file:\n" + e);
  }
}

async function saveFile(): Promise<void> {
  const content = getContent();
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
    await invoke("write_file", { path, contents: content });
    savedMarkdown = content;
    setDirty(false);
  } catch (e) {
    alert("Could not save file:\n" + e);
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx < 0) return p;
  return p.slice(0, idx) || "/";
}

// ---------- new / welcome ----------
async function newFile(): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  currentPath = null;
  titleEl.textContent = "Untitled";
  await mountEditor("");
  clearActive();
}

async function loadWelcome(): Promise<void> {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  currentPath = null;
  titleEl.textContent = "Welcome";
  await mountEditor(welcomeMd);
  clearActive();
  welcomeRow.classList.add("active");
}

function clearActive(): void {
  treeEl
    .querySelectorAll<HTMLElement>(".tree-row.active")
    .forEach((row) => row.classList.remove("active"));
}

// ---------- folder tree ----------
interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

async function showFolder(dir: string): Promise<void> {
  folderTreeEl.innerHTML = "";

  // Show the project folder name as a collapsible root, so it stays
  // visible while editing.
  const root = document.createElement("div");
  root.className = "tree-row folder folder-root";
  const tree = await buildTree(dir);
  let expanded = true;
  const label = () => (expanded ? "\u25BE " : "\u25B8 ") + basename(dir);
  root.textContent = label();
  root.addEventListener("click", () => {
    expanded = !expanded;
    tree.style.display = expanded ? "" : "none";
    root.textContent = label();
  });

  folderTreeEl.appendChild(root);
  folderTreeEl.appendChild(tree);
}

async function openFolderDialog(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  await showFolder(dir);
}

async function buildTree(dirPath: string): Promise<HTMLElement> {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  let entries: Entry[] = [];
  try {
    entries = await invoke<Entry[]>("list_dir", { path: dirPath });
  } catch {
    /* unreadable directory — show nothing */
  }

  for (const entry of entries) {
    const li = document.createElement("li");

    if (entry.is_dir) {
      const row = document.createElement("div");
      row.className = "tree-row folder";
      row.textContent = "\u25B8 " + entry.name; // ▸
      let expanded = false;
      let childUl: HTMLElement | null = null;
      row.addEventListener("click", async () => {
        if (expanded) {
          childUl?.remove();
          childUl = null;
          expanded = false;
          row.textContent = "\u25B8 " + entry.name;
        } else {
          childUl = await buildTree(entry.path);
          li.appendChild(childUl);
          expanded = true;
          row.textContent = "\u25BE " + entry.name; // ▾
        }
      });
      li.appendChild(row);
    } else {
      const row = document.createElement("div");
      row.className = "tree-row file";
      row.dataset.path = entry.path;
      row.textContent = entry.name;
      row.addEventListener("click", () => loadFile(entry.path));
      li.appendChild(row);
    }

    ul.appendChild(li);
  }

  return ul;
}

function highlightActive(path: string): void {
  treeEl.querySelectorAll<HTMLElement>(".tree-row.file").forEach((row) => {
    row.classList.toggle("active", row.dataset.path === path);
  });
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

// ---------- wiring ----------
document.getElementById("new-file")!.addEventListener("click", newFile);
document.getElementById("open-file")!.addEventListener("click", openFileDialog);
document.getElementById("save-file")!.addEventListener("click", saveFile);
document.getElementById("open-folder")!.addEventListener("click", openFolderDialog);
welcomeRow.addEventListener("click", loadWelcome);
document.getElementById("toggle-theme")!.addEventListener("click", toggleDark);

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
});

// reliable dirty signal: any input inside the editor surface
editorEl.addEventListener("input", () => {
  onEdit();
  updateWordCount();
  updateBlockType();
}, true);

document.addEventListener("selectionchange", updateBlockType);

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
loadWelcome();
