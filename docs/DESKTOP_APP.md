# Cortex for Windows

A small program for the people who use a building's Cortex every day: the front desk, a facilities
manager, an owner. (Cortex Command is the other app, for whoever looks after many buildings.)

## What it does

1. **Finds the controller by itself.** On first start it searches the network the PC is on and lists
   every Cortex controller it finds, by name. One click connects, and it remembers.
2. **Opens Cortex in its own window,** from the Start menu or a desktop shortcut.
3. **Tells you when something needs attention.** It stays by the clock after the window is closed and
   raises a Windows notification when a unit reports a fault, a unit stops answering, Cortex spots a
   problem pattern, or the controller cannot be reached. No https, browser permission or account.
4. **Updates itself,** the same way Cortex Command does, with the same Beta testing switch.

## Installing

Download `Cortex-Setup-<version>.exe` from the newest release and run it. It installs for the current
Windows user with no administrator prompt. Windows shows "Windows protected your PC" once because the
installer is not code-signed yet: **More info ▸ Run anyway**.

## How it finds a controller

- It asks for `cortex.local`, the name every controller announces.
- It asks each of the 254 addresses around the PC's own address one read-only question: "are you
  Cortex?" (`GET /health`). Only private local networks are searched. This takes about ten seconds.
- If the building's network is split into several parts, the search cannot cross between them. Type the
  controller's address under **Know the address?** instead.

## If it cannot reach the controller

The window shows "Can't reach Cortex", keeps retrying every ten seconds, and offers **Search the
network** in case the controller's address changed.

## Menu, tray and settings

- Menu bar: **Cortex ▸ Open Cortex / Reload / Find controllers / App settings / Quit**, and **View** for
  zoom and full screen.
- Tray icon: hover for a one-line status ("17 of 22 units on"); right-click for the same choices.
- **App settings:** which notifications to get, a test notification, keep watching after the window is
  closed, start with Windows, updates and beta testing.

## What it does and does not do to the building

By itself the app only reads: `/health`, `/api/units`, `/api/events`, `/api/diag`, and the unit names
from `/api/appconfig`. It never sends a command. Everything that changes the building is done by the
person, in the controller's own page shown in the window.

The controller's page is treated as ordinary web content: it cannot reach the app's settings or the PC.
Links to anywhere else open in the normal browser.

## For whoever works on it next

- `desktop-app/main.js` (window, tray, watcher, updater), `discover.js` (finding controllers), `watch.js`
  (what to notify), `finder.html` (the app's own pages), `preload.js` (bridge, only for `finder.html`).
- `updater.js` is not stored here: the build copies `command-app/updater.js` in. `U.product()` tells it
  which manifest (`cortex-desktop-manifest.json`) and installer name (`Cortex-Setup-…exe`) are its own.
- Tests: `tests/desktop-app.test.js` (discovery and notification rules, no network) and
  `tests/desktop-ui.test.js` (the pages, clicked through with a stand-in for the app).
- **Not run on Windows yet:** the installer, the real network search, the tray, notifications and
  self-update. The build is checked by `.github/workflows/command-build.yml`.

## Local or secure, by itself (1.7.1-beta.4)

The app keeps a controller's building-network address and its secure (Tailscale) address, prefers the
building network, and switches when one stops answering. **On your phone** shows QR codes for both
links. How it decides, and what phones can and cannot do: [REMOTE_AND_LOCAL.md](REMOTE_AND_LOCAL.md).
