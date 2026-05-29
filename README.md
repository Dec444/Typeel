# Typeel

A lightweight, free, cross-platform **WYSIWYG Markdown editor** — a Typora-style
writing experience built with [Tauri 2](https://v2.tauri.app/) and the
[Milkdown **Crepe**](https://milkdown.dev/) editor (Crepe is explicitly inspired by Typora).

Because it uses Tauri (the OS-native webview) instead of bundling a full browser,
the packaged app is a few MB rather than ~150 MB.

## Features in this scaffold

- True inline WYSIWYG editing (Crepe): headings, lists, tables, task lists,
  code blocks with highlighting, images, math, slash `/` block menu
- Sidebar folder browser for your `.md` files (lazy-expanding tree)
- Open / Save with native dialogs, `Ctrl/Cmd+S` to save, `Ctrl/Cmd+O` to open
- Unsaved-changes indicator and discard guard
- Light / dark theme toggle (persisted)

## Who needs to install what

There are two completely separate situations — don't confuse them:

- **People using Typeel** (your users) install **nothing** but the app itself. You
  hand them a finished installer — `.dmg`/`.app` on macOS, `.msi`/`.exe` on Windows,
  `.AppImage`/`.deb` on Linux — they double-click it, done. No Xcode, no Rust, no
  toolchain. The app is self-contained and uses the OS's built-in webview at runtime.
- **You, compiling the app**, need a build toolchain (below). Note this is the
  **Xcode Command Line Tools** (`xcode-select --install`) — *not* the multi-gigabyte
  Xcode IDE from the App Store. Or skip installing anything locally and let GitHub
  build all three platforms for you (see "Releasing in the cloud").

## Building it yourself — prerequisites

1. **Node.js** 18+ and npm — https://nodejs.org
2. **Rust** (stable) — https://rustup.rs
3. **Platform build deps** — follow the one-time setup for your OS:
   https://v2.tauri.app/start/prerequisites/
   - macOS: Xcode Command Line Tools only (`xcode-select --install`)
   - Windows: WebView2 (preinstalled on Win 11) + MSVC build tools
   - Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, etc. (see the link)

## Run it

```bash
npm install          # installs frontend deps (downloads Rust crates on first run too)
npm run tauri:dev    # launches the desktop app with hot reload
```

The first `tauri:dev` compiles the Rust side and will take a few minutes; later
runs are fast.

## Build a distributable

```bash
npm run tauri:build
```

Installers/bundles land in `src-tauri/target/release/bundle/`.

## Releasing in the cloud (no local toolchain needed)

`.github/workflows/release.yml` builds installers for macOS (Apple Silicon + Intel),
Windows, and Linux on GitHub's runners, which already have every toolchain
preinstalled — so you can ship all three platforms without a Mac, without Xcode,
and without installing anything locally.

To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

That triggers the workflow; a few minutes later a **draft GitHub Release** appears
with all the installers attached. Review it and hit publish. (You can also run it
by hand from the repo's Actions tab via "Run workflow".)

One-time setup: in the repo's Settings → Actions → General → Workflow permissions,
select "Read and write permissions" so the action can create the release. Otherwise
the build succeeds but fails at the upload step with "Resource not accessible by
integration".

Two notes on distribution:

- **macOS "damaged" warning.** Unsigned Apple Silicon builds downloaded from the web
  can be flagged as damaged. The proper fix is code-signing + notarization (needs an
  Apple Developer account, $99/yr — see the Tauri macOS signing guide); as a stopgap,
  an ad-hoc signing identity avoids the "damaged" message.
- **Windows SmartScreen.** Unsigned `.exe`/`.msi` installers show a "Windows protected
  your PC" prompt until you sign with a code-signing certificate.

Neither blocks the app from running — they're trust prompts that signing removes.

## Project layout

```
typeel/
├─ index.html              # app shell (sidebar + toolbar + editor mount)
├─ src/
│  ├─ main.ts              # editor lifecycle, file ops, folder tree, theme
│  ├─ styles.css           # chrome styling + Crepe light/dark tokens
│  └─ assets/fonts/        # bundled Tilt Neon font
├─ src-tauri/
│  ├─ src/main.rs          # read_file / write_file / list_dir commands
│  ├─ Cargo.toml
│  ├─ tauri.conf.json      # window + bundle config
│  ├─ icons/               # app icon (peeled-layers mark)
│  └─ capabilities/default.json
├─ .github/workflows/
│  └─ release.yml          # cloud build for macOS / Windows / Linux
└─ package.json
```

## How it fits together

File I/O is done through **custom Rust commands** (`read_file`, `write_file`,
`list_dir`) rather than the `fs` plugin. This sidesteps Tauri's filesystem
permission scoping entirely — the frontend asks the native dialog for a path,
then hands that path to Rust, which has full disk access. The only plugin
enabled is `dialog` (for the native pickers).

The editor itself is a `Crepe` instance mounted into `#editor`. Opening a file
destroys and recreates the instance with the new content; saving calls
`crepe.getMarkdown()` and writes it back.

## Ideas to extend

- **Recent files / reopen last folder** — persist paths in `localStorage`
- **Tabs** — keep multiple `Crepe` instances and swap the mounted one
- **Export to PDF/HTML** — render the markdown and use Tauri's print or a Rust crate
- **Outline panel** — parse headings from `getMarkdown()` into a jump list
- **Theme tuning** — copy the full token set from
  `node_modules/@milkdown/crepe/lib/theme/` and adjust the `.dark .crepe .milkdown`
  block in `styles.css`
- **File watching / auto-reload** — add `tauri-plugin-fs` `watch()` or a Rust watcher
- **App menu & shortcuts** — `@tauri-apps/api/menu`

## Notes

- The icons in `src-tauri/icons/` are the Typeel logo (peeled layers + cursor). To
  regenerate the full set from any square PNG: `npm run tauri icon path/to/logo.png`.
- `crepe.getMarkdown()` can throw on certain malformed nodes (e.g. a code block
  with no language); `getContent()` guards against this by falling back to the
  last-saved text.

MIT — do whatever you like with it.
