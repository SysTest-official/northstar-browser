# Northstar Browser

A desktop browser built with Electron and Chromium/Blink.

**Website:** https://systest-official.github.io/website/  
**Contact:** northstar-browser@proton.me  
**License:** MIT

## Run from source

Use Node.js 22.12 or later:

```sh
npm install
npm start
```

## Package

```sh
npm run pack
npm run dist:linux
npm run dist:windows
npm run dist:mac
```

The Linux AppImage target is ready to build. Debian packages need the project homepage and maintainer contact in package metadata. Windows and macOS releases should be built and signed on their target platforms.

## Local profiles

Northstar profiles are stored locally on this device. Each profile keeps separate cookies, site storage, permissions, preferences, favorites, history, and saved tabs. There is no server sign-in or cloud sync. Private tabs use a separate non-persistent session.

## Project status

Northstar is an early release. Some browser features and platform packages are still being refined. See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the project change log.

