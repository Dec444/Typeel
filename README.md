# Typeel

**Peel your thoughts.** Typeel is a free, cross-platform Markdown editor with a clean,
distraction-free writing experience — what you type is formatted live, right in front of
you, with no split-screen preview to fuss with.

<!-- Add a screenshot at docs/screenshot.png, then uncomment:
![Typeel screenshot](docs/screenshot.png)
-->

## Getting Typeel

There are two ways to get Typeel. **Most people want Option 1.** Option 2 is for those who'd
rather compile it themselves, or who are on a platform without a ready-made download.

### Option 1 — Download a ready-made installer (easiest)

Go to the [**Releases**](https://github.com/Dec444/Typeel/releases) page and
download the file for your computer:

| Your system | Download |
|-------------|----------|
| macOS (Apple Silicon — M1 or newer) | the `aarch64` `.dmg` |
| macOS (Intel) | the `x64` / `x86_64` `.dmg` |
| Windows | the `.msi` or `.exe` |
| Linux | the `.AppImage` or `.deb` |

Then install it:

- **macOS** — open the `.dmg`, drag **Typeel** into your Applications folder, and open it.
  Typeel is signed and notarized by Apple, so it launches normally with no security warning.
- **Windows** — run the installer. If a blue "Windows protected your PC" box appears, click
  **More info**, then **Run anyway**. Once only.
- **Linux** — for an `.AppImage`, make it executable and run it:
  ```bash
  chmod +x Typeel*.AppImage
  ./Typeel*.AppImage
  ```
  For a `.deb`, install it with your package manager, e.g. `sudo apt install ./Typeel*.deb`.

> The one-time prompts above show up simply because Typeel is a small independent app.
> It's safe to open.

### Option 2 — Build it yourself from source

If you'd rather compile Typeel from the source code, you'll need a few free developer tools
and then a single build command.

**1. Install the prerequisites**

- [Node.js](https://nodejs.org) 18 or newer (includes npm)
- [Rust](https://rustup.rs) (stable)
- Your platform's one-time build dependencies for Tauri — see
  https://v2.tauri.app/start/prerequisites/
  - **macOS:** the Xcode **Command Line Tools** only — run `xcode-select --install`
    (this is *not* the multi-gigabyte Xcode app).
  - **Windows:** WebView2 (already on Windows 11) plus the Microsoft C++ Build Tools.
  - **Linux:** `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, and a few others
    listed at the link above.

**2. Get the code**

```bash
git clone https://github.com/Dec444/Typeel.git
cd Typeel
```

**3. Build the app**

```bash
npm install          # downloads dependencies (first run also fetches Rust crates)
npm run tauri:build  # compiles Typeel and creates an installer
```

The first build compiles the Rust side and takes a few minutes. When it finishes, your
installer/app is in `src-tauri/target/release/bundle/` — open it like any other app.

> Just want to run it without making an installer? Use `npm run tauri:dev` to launch Typeel
> directly (with live reload while you poke around).

## Writing

Typeel formats text as you go — type Markdown and it becomes formatted content instantly.

Start a line with one of these (followed by a space):

| Type this | You get |
|-----------|---------|
| `# ` | Heading 1 (use `## `, `### ` for smaller headings) |
| `- ` or `* ` | Bullet list |
| `1. ` | Numbered list |
| `- [ ] ` | Checkbox / to-do item |
| `> ` | Quote |
| Three backticks | Code block |
| `---` | Horizontal divider |

For inline formatting, surround text with `**` for **bold**, `*` for *italic*, and
backticks for `code`. Selecting any text also pops up a small formatting toolbar.

**The `/` menu.** Type `/` on an empty line to open a menu for inserting things — headings,
tables, images, code blocks, and more.

**Rearranging.** Hover over a paragraph or heading and a handle (the six dots) appears to its
left. Drag that handle to move the block up or down; click the **+** next to it to add a new
block.

**Knowing where you are.** The bottom-left of the window always shows the current block type
(Heading 1, Paragraph, Quote, and so on), so you're never guessing.

## Opening & saving files

- **New document** — the **New** button, or `Ctrl/Cmd + N`.
- **Open a file** — the **Open** button, or `Ctrl/Cmd + O`. Images stored alongside the file
  (referenced by relative paths) are displayed automatically.
- **Save** — the **Save** button, or `Ctrl/Cmd + S`. A dot beside the filename means you have
  unsaved changes.

## The sidebar

- **Outline** — the sidebar lists the headings in the current document; click any heading to
  jump to it, and the section you're in stays highlighted as you write.
- **Welcome** — the pinned **Welcome** entry opens the built-in guide at any time. It sets your
  current document aside rather than closing it: a **← your file** button appears so you can
  return to exactly where you left off, unsaved changes and all.
- **Hide it** — the ❮ button at the top of the sidebar collapses it for a wider writing area,
  and a ❯ button at the left of the toolbar brings it back. Your choice is remembered.

## Word count

The bottom-right shows a live word count. Click it to hide or show the count whenever you like.

## Themes & fonts

Click **Theme** in the toolbar to choose a look — **Black & White**, **Cream & Slate**, or
**Ivory & Rose** — and use the ◐ button beside it to switch between light and dark. Typeel
opens in Cream & Slate (dark) by default. Your choice is remembered next time you open the app.

Click **Font** to set the editor typeface — **Source Sans 3**, **Sulphur Point**, or
**Ysabeau Infant**. That preference is remembered too.

## Exporting

Click **Export** and pick:

- **HTML file** — saves a clean, self-contained web page of your document.
- **PDF** — opens your document in your web browser with the print dialog ready; choose
  **Save as PDF** there to create the PDF.

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| New document | `Ctrl/Cmd + N` |
| Open file | `Ctrl/Cmd + O` |
| Save | `Ctrl/Cmd + S` |

## Feedback

Found a bug or have an idea? Please open an issue on the
[GitHub repository](https://github.com/Dec444/Typeel/issues).

---

Free and open source under the [MIT license](LICENSE).
