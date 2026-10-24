# Northstar

Northstar is an Electron desktop browser built on Chromium/Blink. It includes tabbed browsing, private windows/tabs, bookmarks, history, downloads, configurable search, and local browser profiles.

## Run from source

- Install Node.js 22.12 or newer.
- Run `npm install`.
- Run `npm start`.

## Build installers

- `npm run pack` creates an unpacked app for the current platform.
- `npm run dist:linux` creates a Linux AppImage.
- `npm run dist:linux:deb` creates a Linux deb package after the project homepage and Debian maintainer contact are set in package metadata.
- `npm run dist:windows` creates a Windows NSIS installer.
- `npm run dist:mac` creates macOS dmg and zip packages.

Installer builds should be run on the target operating system. Platform signing and notarization credentials are required for trusted signed releases.

## Local profiles and data

Profiles are on-device browser identities; they do not use server sign-in or cloud sync. Each profile has separate cookies, site storage, permissions, settings, favorites, history, and saved tabs. Private tabs use a separate non-persistent session. The existing default profile keeps the earlier Northstar storage partition, and its session and permission files are migrated on first launch.

Profile data is stored in Electron's `userData` directory under `profiles/`. Removing a profile clears its local session and browser storage.

## Release checks

Run `npm audit` to inspect dependency advisories and `npm run pack` to validate the packaged app for the current platform. Installer signing, notarization, publisher details for deb packages, update hosting, and release automation must be configured by the distributor.
