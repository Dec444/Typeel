import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

// ---------- state ----------
let crepe: Crepe | null = null;
let currentPath: string | null = null;
let savedMarkdown = "";
let dirty = false;

const editorEl = document.getElementById("editor") as HTMLElement;
const titleEl = document.getElementById("doc-title") as HTMLElement;
const dirtyDot = document.getElementById("dirty-dot") as HTMLElement;
const treeEl = document.getElementById("file-tree") as HTMLElement;

const WELCOME = `# Welcome to Typeel

A calm, **free** place to write — type, then organize your words and ideas layer by layer, like peeling an onion until the clearest thought is left.

- Open a folder in the sidebar to browse your notes
- Edit right here — it is full *WYSIWYG*, the way Typora works
- Press **Ctrl / Cmd + S** to save

> Tip: type \`/\` on a new line to open the block menu, or paste a table and it just works.

\`\`\`js
console.log("Happy writing!");
\`\`\`
`;

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

// ---------- folder tree ----------
interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

async function openFolderDialog(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir === "string") {
    treeEl.innerHTML = "";
    treeEl.appendChild(await buildTree(dir));
  }
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
function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("typeel-theme", dark ? "dark" : "light");
}

function initTheme(): void {
  const saved = localStorage.getItem("typeel-theme");
  // default to dark mode (Deep Slate) unless the user has chosen otherwise
  applyTheme(saved ? saved === "dark" : true);
}

// ---------- wiring ----------
document.getElementById("open-file")!.addEventListener("click", openFileDialog);
document.getElementById("save-file")!.addEventListener("click", saveFile);
document.getElementById("open-folder")!.addEventListener("click", openFolderDialog);
document.getElementById("toggle-theme")!.addEventListener("click", () =>
  applyTheme(!document.documentElement.classList.contains("dark")),
);

// reliable dirty signal: any input inside the editor surface
editorEl.addEventListener("input", () => onEdit(), true);

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveFile();
  } else if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    openFileDialog();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

initTheme();
mountEditor(WELCOME);
