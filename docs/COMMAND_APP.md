# Cortex Command for Windows

Cortex Command is one page (`command-center.html`). It can run three ways, and the page is the same in
all three:

| How | What you get |
|---|---|
| **Windows app** (this document) | Start menu and desktop shortcut, its own updates, a tray icon that keeps watching after the window is closed, Windows notifications |
| Opened from a controller (`https://<controller>/command-center.html`) | Nothing to install; updates with that controller; alerts while closed via that controller (`docs/NOTIFICATIONS.md`) |
| Opened as a file | Works, but nothing runs when it is closed and it never updates |

## Installing

1. On the Cortex releases page, download `Cortex-Command-Setup-<version>.exe` from the newest release.
2. Run it. It installs for the current Windows user (no administrator prompt) and starts Command.
3. Windows may show "Windows protected your PC" because the installer is not code-signed yet. Choose
   **More info**, then **Run anyway**. Signing needs a certificate bought in AIROW's name; until then
   every install shows this once.

Moving from the browser version: in the old one, Settings ▸ Backup and data ▸ **Download a backup**; in
the app, Settings ▸ Backup and data ▸ **Restore from a backup**. The backup holds the buildings,
technicians, access grants, preferences, history and the console's sign-in.

## Updates

The app updates itself the same way a controller does.

1. About 15 seconds after it starts, and every 6 hours, it asks GitHub for the list of Cortex releases.
2. It picks one: with **Beta testing** off, the newest release that is not a pre-release; with it on,
   the newest of any kind. Releases without a Command installer are skipped.
3. If that is newer than what is running, it downloads the installer in the background and checks it
   against the SHA-256 in that release's `command-manifest.json`. A download that does not match is
   thrown away.
4. A bar appears: "ready to install". **Restart now** runs the installer silently and reopens Command.
   Buildings and settings live in the user's app-data folder and are not touched.

Settings ▸ App and updates has: the installed version, **Check now**, **Install updates automatically**
and **Beta testing**. Turning Beta testing off does not pull a beta install back to an older stable
version; it waits for the next stable one.

## Watching from the tray

With **Keep watching after the window is closed** on (the default), closing the window leaves Command in
the tray by the clock, still reading every building about every 20 seconds, including while signed out.
A change raises a Windows notification. Right-click the tray icon to quit for real. **Start with
Windows** starts it hidden in the tray at sign-in.

## How it is built

- `command-app/` is a small Electron app: `main.js` (window, tray, updater), `preload.js` (the few
  things the page may ask the app to do), `updater.js` (which release to pick; plain Node, tested by
  `tests/command-updater.test.js`).
- `.github/workflows/release.yml` has a `command-win` job: on a version tag it builds the installer on
  a Windows runner and attaches `Cortex-Command-Setup-<version>.exe` and `command-manifest.json` to the
  same release the controllers update from.
- `.github/workflows/command-build.yml` builds the installer on every push that touches the app or the
  page, as a check, and keeps it as a build artifact for 14 days.
- The page talks to the app only through `window.cmdApp`. Everything else in the page works without it.

## Not verified yet

Written and unit-tested here, and the page was tested in a browser with a stand-in for `window.cmdApp`.
What has not been run on a real Windows machine: the installer, the tray, Windows notifications,
start-with-Windows, and a real update from one version to the next. The first tagged release that
includes the app is the first real test.
