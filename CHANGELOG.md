# Changelog

All notable changes to Typeel are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

_Nothing yet._

## [0.1.4] - 2026-06-01

### Added

- **Tabs.** Open several documents in one window. New documents and opened files appear as tabs; `Ctrl`/`Cmd`+`T` opens a tab, `Ctrl`/`Cmd`+`W` closes one, and clicking a tab switches to it. Tabs can be dragged sideways to reorder them, and right-clicking (or double-clicking) a tab renames it. The tab strip stays hidden while only one document is open. Each tab keeps its own unsaved-changes state.
- **Multiple windows.** Open additional editor windows with the toolbar button (⧉) next to **New**, or with `Ctrl`/`Cmd`+`Shift`+`N`. Each window is independent.
- **Native menu (macOS).** A standard menu bar with File (New Tab, New Window, Open, Save, Close Tab), Edit, and Window entries. Windows and Linux keep the in-app toolbar only.

## [0.1.3] - 2026-05-31

### Added

- **Font picker** in the toolbar — write in Source Sans 3, Sulphur Point, or Ysabeau Infant. Your choice is remembered.
- **Blossom & Rose theme** — a warm peach palette with dusty-rose accents.
- **Collapsible sidebar** — hide it with the ❮ button for a wider writing space, and bring it back with the ❯ button at the left of the toolbar. The state is remembered between sessions.
- **Pinned Welcome** entry in the sidebar for quick access to the built-in guide.
- **Images saved alongside your document.** Pasted or inserted images are written to an `assets` folder next to the file and referenced by path, so they persist and display when you reopen.

### Changed

- Typeel now **opens in Fluffy & Dust (dark)** by default.
- **Fluffy & Dust** was recolored to a softer Ivory/slate palette.
- **Wider text column**, reducing the empty side margins on large or stretched windows.

### Removed

- The **Plum & Peach** theme.

### Fixed

- **Images in opened files now display** — pictures referenced by relative paths next to a Markdown file load correctly, and the original paths are written back when you save.
- **Opening Welcome no longer replaces your document** — your work is set aside and a "← your file" button returns you to exactly where you left off, including unsaved changes.

## Earlier releases

Notes for 0.1.0–0.1.3 are available on the
[GitHub Releases](https://github.com/Dec444/Typeel/releases) page.

[Unreleased]: https://github.com/Dec444/Typeel/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Dec444/Typeel/releases/tag/v0.1.4
[0.1.3]: https://github.com/Dec444/Typeel/releases/tag/v0.1.3
