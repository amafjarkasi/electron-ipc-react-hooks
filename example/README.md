# Example app — electron-ipc-react-hooks

Live Electron + Vite + React demo of the library.

## Run manually

```bash
# from repo root
npm run build
cd example
npm install
npm run build
npx electron .
```

Or during development:

```bash
cd example
npm run dev
```

## Automated tests

From the **repo root**:

```bash
# Library unit tests + browser mock harness
npm test
npm run test:harness

# Playwright Electron E2E (builds library + example first)
npm run test:e2e
```

E2E sets `E2E=1` so native dialogs/notifications are stubbed.

See [docs/REVIEW.md](../docs/REVIEW.md) for the feature matrix and review findings.
