import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { open, save } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

// ---------- tabs (several documents inside one window) ----------
// The module globals above (currentPath / savedMarkdown / dirty / imageMap) and
// the live Crepe editor together represent the ACTIVE tab. Every other open
// document is parked in this list and swapped in when its tab is selected.
interface Tab {
  id: number;
  path: string | null;
  title: string;
  content: string; // markdown snapshot (the active tab's live text lives in the editor)
  saved: string; // last-saved baseline, for the dirty check
  dirty: boolean;
  isWelcome: boolean;
  images: Map<string, string>; // this document's dataURL -> original-src map
}
let tabs: Tab[] = [];
let activeId = -1;
let tabSeq = 1;
let dragId: number | null = null; // tab currently being dragged for reordering

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
const tabbar = document.getElementById("tabbar") as HTMLElement;
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
  const t = activeTab();
  if (t && t.dirty !== value) {
    t.dirty = value;
    renderTabs();
  }
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

  const sub = (src: string): string => {
    const inlined = local.get(src);
    if (inlined) return inlined; // local file -> fresh data URL
    // Repair a base64 data URL that an earlier buggy save percent-encoded.
    if (/^data:[^,]*;base64,/i.test(src) && src.includes("%")) {
      try {
        return src.replace(
          /^(data:[^,]*,)([\s\S]*)$/i,
          (_m, head, body) => head + decodeURIComponent(body).replace(/\s+/g, ""),
        );
      } catch {
        return src;
      }
    }
    return src;
  };
  return md
    .replace(IMG_MD, (_m, a, src, b) => a + sub(src) + b)
    .replace(IMG_HTML, (_m, a, src, b) => a + sub(src) + b);
}

// Turn our inlined data URLs back into the original on-disk paths before saving.
// The editor may re-encode the data URL when it serializes back to Markdown
// (e.g. percent-encoding "+" "/" "=" or stripping whitespace), so we match both
// the exact string and a normalized form rather than relying on an exact hit.
function normalizeDataUrl(s: string): string {
  let out = s;
  try {
    out = decodeURIComponent(s);
  } catch {
    /* leave as-is if it isn't valid percent-encoding */
  }
  return out.replace(/\s+/g, "");
}

function delocalizeImages(md: string): string {
  if (imageMap.size === 0) return md;

  // Fast path: any data URLs left verbatim.
  for (const [url, orig] of imageMap) {
    if (md.includes(url)) md = md.split(url).join(orig);
  }

  // Robust path: match data URLs the editor rewrote.
  const byNorm = new Map<string, string>();
  for (const [url, orig] of imageMap) byNorm.set(normalizeDataUrl(url), orig);

  const back = (full: string, pre: string, src: string, post: string): string => {
    if (!/^data:/i.test(src)) return full;
    const orig = imageMap.get(src) ?? byNorm.get(normalizeDataUrl(src));
    return orig ? pre + orig + post : full;
  };

  return md
    .replace(IMG_MD, (m, a, src, b) => back(m, a, src, b))
    .replace(IMG_HTML, (m, a, src, b) => back(m, a, src, b));
}

// Persist pasted/embedded images (blob:/data: that weren't inlined from an
// existing file) into an "assets" folder next to the document — the way a
// desktop editor does — so they survive saving and reopening. Each embedded src
// is mapped to its new relative path in imageMap, and delocalizeImages then
// writes that path into the file.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function collectImageSrcs(md: string): string[] {
  const out: string[] = [];
  for (const re of [IMG_MD, IMG_HTML]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md))) out.push(m[2]);
  }
  return out;
}

async function fetchAsBase64(src: string): Promise<{ b64: string; ext: string }> {
  const blob = await (await fetch(src)).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { b64: btoa(bin), ext: MIME_EXT[blob.type] || "png" };
}

async function persistEmbeddedImages(md: string): Promise<void> {
  if (!currentPath) return; // need a document location to place the assets folder
  const sep = currentPath.includes("\\") ? "\\" : "/";
  const assetsDir = dirOf(currentPath) + sep + "assets";

  const embedded = [...new Set(collectImageSrcs(md))].filter(
    (s) => /^(blob:|data:)/i.test(s) && !imageMap.has(s),
  );
  for (const src of embedded) {
    try {
      const { b64, ext } = await fetchAsBase64(src);
      const fname = await invoke<string>("save_image", { dir: assetsDir, data: b64, ext });
      imageMap.set(src, "assets/" + fname);
    } catch {
      /* leave it inline if it can't be written */
    }
  }
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
  // Already open in a tab? Just focus it.
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    await switchTab(existing.id);
    return;
  }

  let content: string;
  try {
    content = await invoke<string>("read_file", { path });
  } catch (e) {
    alert("Could not open file:\n" + e);
    return;
  }

  // Reuse a pristine blank tab instead of stacking an empty one behind the file.
  const cur = activeTab();
  const reuse = !!cur && isBlank(cur);
  // Preserve the OUTGOING tab (its content + image map) before we repoint globals.
  if (!reuse) snapshotActive();

  const images = new Map<string, string>();
  imageMap = images; // localizeImages fills the active map
  const display = await localizeImages(content, dirOf(path));

  const t = makeTab({ path, title: basename(path), content: display, saved: display, images });
  if (reuse) {
    tabs[tabs.findIndex((x) => x.id === cur!.id)] = t;
  } else {
    tabs.push(t);
  }
  await loadTab(t);
}

async function saveFile(): Promise<void> {
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

  const editorContent = getContent();
  await persistEmbeddedImages(editorContent);
  const fileContent = delocalizeImages(editorContent);

  try {
    await invoke("write_file", { path, contents: fileContent });
    savedMarkdown = editorContent;
    setDirty(false);
    const t = activeTab();
    if (t) {
      t.path = currentPath;
      t.title = titleEl.textContent || t.title;
      t.saved = savedMarkdown;
      t.isWelcome = false;
    }
    welcomeRow.classList.remove("active");
    renderTabs();
  } catch (e) {
    alert("Could not save file:\n" + e);
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

// ---------- tab machinery ----------
function activeTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeId);
}

// A tab that can be silently reused: empty, untitled, unsaved, not Welcome.
function isBlank(t: Tab): boolean {
  if (t.path || t.isWelcome) return false;
  const live = t.id === activeId ? getContent() : t.content;
  return !t.dirty && live.trim() === "";
}

function makeTab(init: Partial<Tab>): Tab {
  const content = init.content ?? "";
  return {
    id: tabSeq++,
    path: init.path ?? null,
    title: init.title ?? "Untitled",
    content,
    saved: init.saved ?? content,
    dirty: init.dirty ?? false,
    isWelcome: init.isWelcome ?? false,
    images: init.images ?? new Map<string, string>(),
  };
}

// Write the live editor + globals back into the active tab object.
function snapshotActive(): void {
  const t = activeTab();
  if (!t) return;
  t.content = getContent();
  t.path = currentPath;
  t.title = titleEl.textContent || "Untitled";
  t.saved = savedMarkdown;
  t.dirty = dirty;
  t.images = imageMap;
}

// Make a parked tab the live one: load its state into the globals and editor.
async function loadTab(t: Tab): Promise<void> {
  activeId = t.id;
  currentPath = t.path;
  imageMap = t.images;
  titleEl.textContent = t.title;
  const wantDirty = t.dirty; // mountEditor's setDirty(false) will overwrite t.dirty
  const wantSaved = t.saved;
  await mountEditor(t.content);
  savedMarkdown = wantSaved;
  if (wantDirty) setDirty(true);
  welcomeRow.classList.toggle("active", t.isWelcome);
  renderTabs();
}

async function switchTab(id: number): Promise<void> {
  if (id === activeId) return;
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  snapshotActive();
  await loadTab(t);
}

// Add a new tab, reusing a pristine blank tab if the active one qualifies.
async function addTab(t: Tab): Promise<void> {
  const cur = activeTab();
  if (cur && isBlank(cur)) {
    tabs[tabs.findIndex((x) => x.id === cur.id)] = t; // discard the blank
  } else {
    snapshotActive();
    tabs.push(t);
  }
  await loadTab(t);
}

async function closeTab(id: number): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const isActive = id === activeId;
  const t = tabs[idx];
  const isDirty = isActive ? dirty : t.dirty;
  const name = isActive ? titleEl.textContent || "Untitled" : t.title;
  if (isDirty && !confirm("Discard unsaved changes in \u201C" + name + "\u201D?")) return;

  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    // Never leave the window empty — drop back to a fresh blank document.
    await addTab(makeTab({}));
    return;
  }
  if (isActive) {
    await loadTab(tabs[Math.min(idx, tabs.length - 1)]);
  } else {
    renderTabs();
  }
}

function renderTabs(): void {
  // Keep the active tab's display fields current (cheap; no content snapshot).
  const at = activeTab();
  if (at) {
    at.title = titleEl.textContent || at.title;
    at.dirty = dirty;
  }

  tabbar.innerHTML = "";
  // With a single document, hide the strip to keep the clean, focused look.
  if (tabs.length < 2) {
    tabbar.classList.add("hidden");
    return;
  }
  tabbar.classList.remove("hidden");

  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.title = t.path || t.title;
    el.draggable = true;

    const dot = document.createElement("span");
    dot.className = "tab-dot" + (t.dirty ? "" : " hidden");
    dot.textContent = "\u25CF";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = t.title;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close tab";
    close.innerHTML = "&#215;";
    close.draggable = false;
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      void closeTab(t.id);
    });

    el.append(dot, label, close);
    el.addEventListener("click", () => void switchTab(t.id));

    // --- drag to reorder ---
    el.addEventListener("dragstart", (e) => {
      dragId = t.id;
      el.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(t.id));
      }
    });
    el.addEventListener("dragend", () => {
      dragId = null;
      clearDropMarks();
      el.classList.remove("dragging");
    });
    el.addEventListener("dragover", (e) => {
      if (dragId === null || dragId === t.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const after = isAfter(el, e.clientX);
      el.classList.toggle("drop-after", after);
      el.classList.toggle("drop-before", !after);
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("drop-before", "drop-after");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const after = isAfter(el, e.clientX);
      clearDropMarks();
      reorderTab(dragId, t.id, after);
    });

    tabbar.appendChild(el);
  }

  const add = document.createElement("button");
  add.className = "tab-add";
  add.title = "New tab";
  add.innerHTML = "&#43;";
  add.addEventListener("click", () => void newFile());
  tabbar.appendChild(add);
}

// Is the cursor past the horizontal midpoint of a tab? (drop goes after it)
function isAfter(el: HTMLElement, clientX: number): boolean {
  const rect = el.getBoundingClientRect();
  return clientX > rect.left + rect.width / 2;
}

function clearDropMarks(): void {
  tabbar.querySelectorAll(".tab").forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

// Move the dragged tab to just before/after the tab it was dropped on.
function reorderTab(fromId: number | null, toId: number, placeAfter: boolean): void {
  if (fromId === null || fromId === toId) return;
  const from = tabs.findIndex((t) => t.id === fromId);
  if (from === -1) return;
  const [moved] = tabs.splice(from, 1);
  let to = tabs.findIndex((t) => t.id === toId);
  if (to === -1) {
    tabs.splice(from, 0, moved); // target vanished; put it back
    return;
  }
  if (placeAfter) to += 1;
  tabs.splice(to, 0, moved);
  renderTabs();
}

// ---------- new / welcome ----------
// "New" opens a fresh tab; the working documents in other tabs are untouched.
async function newFile(): Promise<void> {
  await addTab(makeTab({ title: "Untitled", content: "" }));
}

// The pinned Welcome row opens (or focuses) a Welcome tab.
async function loadWelcome(): Promise<void> {
  const w = tabs.find((t) => t.isWelcome);
  if (w) {
    await switchTab(w.id);
    return;
  }
  await addTab(makeTab({ title: "Welcome", content: welcomeMd, saved: welcomeMd, isWelcome: true }));
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
async function newWindow() {
  try {
    await invoke("new_window");
  } catch (err) {
    console.error("Could not open a new window:", err);
  }
}

document.getElementById("new-file")!.addEventListener("click", newFile);
document.getElementById("new-window")!.addEventListener("click", newWindow);
document.getElementById("open-file")!.addEventListener("click", openFileDialog);
document.getElementById("save-file")!.addEventListener("click", saveFile);
welcomeRow.addEventListener("click", loadWelcome);
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
    if (e.shiftKey) newWindow();
    else newFile();
  } else if (mod && e.key.toLowerCase() === "t") {
    e.preventDefault();
    newFile();
  } else if (mod && e.key.toLowerCase() === "w") {
    e.preventDefault();
    void closeTab(activeId);
  }
});

// Native menu items (macOS) forward their action here.
void listen<string>("menu", (e) => {
  switch (e.payload) {
    case "new_tab":
      void newFile();
      break;
    case "open":
      void openFileDialog();
      break;
    case "save":
      void saveFile();
      break;
    case "close_tab":
      void closeTab(activeId);
      break;
  }
});

window.addEventListener("beforeunload", (e) => {
  snapshotActive();
  if (tabs.some((t) => t.dirty)) {
    e.preventDefault();
    e.returnValue = "";
  }
});

applyTheme();
setSidebar(sidebarCollapsed);
applyFont(editorFont);
// Boot with Welcome as the first tab.
void loadWelcome();
