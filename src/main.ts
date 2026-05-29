import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { open, save } from "@tauri-apps/plugin-dialog";
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
  if (typeof selected === "string") await loadFile(selected);
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

async function openFolderDialog(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;

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
document.addEventListener("click", (e) => {
  if (e.target !== themeBtn && !themeMenu.contains(e.target as Node)) {
    themeMenu.classList.add("hidden");
  }
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
