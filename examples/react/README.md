# ThTeX React PWA example

Live deployment: **[thtex.pages.dev](https://thtex.pages.dev/)**

A Vite + React example that compiles XeLaTeX documents entirely in the browser.
The production build is a static, installable PWA suitable for Cloudflare Pages.

## Run locally

From this directory:

```sh
pnpm install
pnpm dev
```

The first command links the local `@arnon3339/thtex` package. Starting or building the app
automatically installs the XeLaTeX worker and runtime into `public/xelatex`.

## Production build

```sh
pnpm build
pnpm preview
```

The deployable output is `dist/`. The build precaches the small application
shell. On the first production visit, the service worker takes control before
XeLaTeX starts; every runtime response is then stored in a dedicated cache.
The example also downloads the engine WASM binaries before showing the ready
state, so it can reopen and perform its first compilation offline afterward.

Wait until the UI shows `Ready` before disconnecting. Closing the tab while the
runtime progress bar is still moving leaves an incomplete offline cache; open
the application online again and let initialization finish to repair it.

## Cloudflare Pages

Connect the repository and use these build settings:

| Setting | Value |
| --- | --- |
| Root directory | `examples/react` |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Node.js version | 20 or newer |

No Pages Functions, environment variables, or server process are required.

Cloudflare Pages limits individual static assets to 25 MiB. The
`thtex:assets` script uses `--max-file-size 24MiB`, which splits the larger ICU
runtime data into manifest-backed chunks that the ThTeX worker reassembles in
memory. Do not remove that option when deploying to Pages.
