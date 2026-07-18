# ThTeX React PWA example

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

The deployable output is `dist/`. The build precaches the application and the
XeLaTeX runtime, so the PWA can reopen offline after its first complete visit.

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
