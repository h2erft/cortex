# Changelog

All notable changes to Cortex. Dates are when the work landed on `main`.

## v1.5.0 — beta (building map + animated units)

_Minor version bump — new building map, animated units, and the beta update channel.
`v1.5.0-beta.1` added the building map + graphics; `beta.2` adds the top-down LG-style graphics
on every view, the unit-type refresh fix, and the beta update channel; `beta.3` is the
"remember who is looking" round — customer vs technician views, tile polish, easy rename, the
Cortex brain mark + loader, floor plans on the map, and opt-in HTTPS. Publish as a GitHub
**pre-release**; drop the suffix for a full `v1.5.0` once it checks out on the box._

### beta.3

**Customer vs technician views**
- Bus address, channel, bus name and outdoor-system id are **gone from the unit tiles, list rows,
  section headers and map** for everyone. A technician sees them inside the unit's control panel
  (header line + Technician section); a customer never does.
- **Command preview** (the hex frames) is now technician-only, alongside pipe-in / pipe-out temps,
  raw frames and error history.
- The Send button reads **Send** / **Send again** for customers; technicians still see the target
  (`Send command → 0x15`, and the red live-bus version). Customer notices and toasts use plain
  words ("Connected to the equipment — Send changes the real unit right away").
- A unit nobody has named shows as **"Unit N"** instead of "Addr 0x17".
- Customers no longer get: the per-user *Bus address* card toggle (removed), the *System
  (physical)* group-by, the Settings → *Layout* wiring tab, the protocol reference, the ODU count
  on the summary tile, or the "new unit found at 0x…" prompt (it waits for a technician/admin).
  Technicians can search units by address.

**Unit tiles**
- Redesigned tile: **Set to** and **Room** are the same size and weight, each labelled; mode, fan
  and lock are matching chips; faults sit in one red note; names wrap to two lines. Consistent in
  comfortable and compact density, when off, in error, and for dual (cool / heat) setpoints.

**Rename**
- **Pencil next to the unit name** in the control panel — type, Enter. Any signed-in user can
  rename (even while a unit is locked for service); tiles, map and panel update immediately. Also
  in *Organize → Name & tags*.

**Device health**
- New **header button** (top right, next to Settings) for technicians and admins; the
  Settings → Advanced "Open" row is gone. The *Start page* option only lists Device health for
  those roles.

**Cortex brain mark + "Cortex is thinking…" loader**
- New logo: a geometric top-down brain. Calm in the header, login and setup wizard; fully animated
  (pulse, halo, sparks travelling in and out along its leads) as the loader.
- The loader covers the page while the app starts, and appears on Device health, update checks,
  floor-plan processing, and — prominently, with the progress bar and time left — during bus
  scans in the wizard and the Bus scan view. `brainLoader(size, label)` drops it in anywhere.
  Motion is disabled under the OS "reduce motion" setting.

**Building map: floor plans**
- Technicians/admins get an explicit **Edit layout** mode: add a floor-plan picture to any
  group ▸ subgroup, then drag units from a tray onto it (mouse or touch, snap to grid). Outside
  edit mode nothing moves and a tap opens the control panel as before; a group without a picture
  keeps the tile grid.
- Pictures are shrunk in the browser, then stored on the appliance (`/api/floorplan/:id`, files
  under `data/floorplans/`, JPEG/PNG/WebP only); positions live in the shared config so every
  browser sees the same layout. Opened as a bare file, pictures stay in that browser.
- Renaming a group or subgroup carries its floor plan along.

**HTTPS (opt-in)**
- `CORTEX_HTTPS=1` in `data/appliance.env` makes the appliance **also** serve https + wss (default
  port 8443). Plain http is untouched and there is no redirect, so it cannot lock a box out.
- The installer creates a self-signed certificate (hostname, hostname.local, localhost) if none
  exists and never overwrites one; a certificate you drop in (e.g. from `tailscale cert`) is used
  as is. Device health shows whether https is running, the port and the certificate expiry.
- "Use my location" works when Cortex is opened over https. See `appliance/README-appliance.md`,
  Part E.

**Fixes & housekeeping**
- Shared-config save limit raised from 32 kB to 256 kB (a large site could silently fail to save).
- Fan-only mode chip now has its colour; names and tags are HTML-escaped wherever they are shown.
- Settings → Layout lists units under their real outdoor systems (was hard-wired to two demo names).

**Building map & live unit graphics**
- Redesigned the indoor-unit graphic as a **top-down** SVG that matches real LG unit types
  (wall mount, 4-way / 1-way cassette, ducted, floor standing, ceiling suspended) so it lines up
  with a top-down floor plan.
- Each unit **animates its live state**: airflow leaves the body in the directions that type
  actually blows (4-way = all sides, wall/1-way/ducted = one side, ceiling = both ends,
  floor = upward), colored by mode, speed set by fan, with a flashing fault dot + error code.
- The animated graphic now appears **everywhere a unit shows** — building map, group/unit grid
  cards, and the control drawer.
- Set a unit's **type** from its control panel (tech/admin); the graphic updates immediately.

**Setup, manufacturer & controller**
- Manufacturer locked to **LG**; other brands show "Coming soon" (no way to select them yet).
- New wizard step for **LG system generation** — Gen 4 (4800 baud) or Gen 5 (9600 baud) — feeding
  the bus baud rate; a tech can still set baud manually.
- **Device health** moved out of the sidebar into Settings → Advanced.
- Admins can **rename the site** from the UI.
- "Use my location" now detects a non-secure (plain-http appliance) context and guides to manual
  latitude/longitude entry instead of failing silently.

**Updates / OTA**
- New **update channel** — Settings → Updates → *Beta testing* (admin only). Off by default:
  appliances only auto-update to **stable** releases (GitHub "latest" already skips pre-releases,
  so existing customer boxes never pull a beta). Turn it on for a test box to also receive
  alpha / beta / rc builds.
- Updater and the in-app check now compare full semver including the pre-release suffix, so a beta
  box correctly promotes to the final stable (`1.4.4` supersedes `1.4.4-beta.1`).

**Known / next**
- Backend (always-on) scheduling — needs testing on the box against the live bus.
- Floor plans: pinch-zoom / pan for large drawings, and including the pictures in Backup (today a
  backup keeps the unit positions but not the image files).
- New groups still take the outdoor system's name ("System #3") until a technician renames them.
- HTTPS is opt-in and manual to enable; certificate renewal for the Tailscale route is manual.
- Unit lists still live in each browser; moving them to the appliance is the next step so names,
  types and groups match everywhere without a re-import.
- Real push/email alerting is not yet wired.
- Verify on the wire: the ODU/system grouping byte and whether ODU faults reach indoor replies.

## v1.4.3 — 2026-11-11 (controller validation + big feature round)

**Protocol & master mode (field-validated on a live Multi V IV, 14 indoor units)**
- Setpoint is sent in the basic cmd0 frame (byte 6 = °C − 15); Cortex no longer auto-sends the
  destructive cmd5 frame. Replies decode to error, mode/fan, setpoint, room/pipe temps, valve
  position, and system group. Temperatures use `C = (192 − code) / 3`.
- Safety guards: discovery sends read-only frames only, refuses to blind-sweep a write command,
  never addresses `0xFF`, and warns against running alongside a real LG central.
- One-tap **guided setup**, fixed the "phantom units" bug (one bus master at a time + reply
  address validation), **background re-discovery** with a prompt to add newly found units, a
  live scan countdown, and button tooltips.
- Expanded **error-code reference** to the real Multi V codes (incl. CH36, CH104, CH151,
  CH204/206) with a safe fallback for unknown codes.
- Schedule/master **collision guard**: polling pauses while a schedule transmits.

**Organization**
- 2-level **group → subgroup** tree in the sidebar (collapsible, rename, move units), separate
  from the physical outdoor-unit grouping.
- Multi-select **delete** and **move** for units; import drawer/ID bug fixed; imported units
  show live room temps.

**Schedules**
- Start empty; a real engine now **fires bus commands** at the set time.
- **nth-weekday** recurrence (1st–5th / last of the month) and **outdoor-temperature
  conditions** backed by live weather.

**Weather & device health**
- Live local weather (Open-Meteo) from the site location (geolocate or enter coordinates).
- Device health reads **real OS vitals** (CPU, memory, disk, temperature, uptime, bus activity)
  via a new `/api/device` endpoint; shows "unavailable" off the appliance instead of fake data.

**Accounts, sessions & settings**
- Sessions persist across refresh with an admin-set **idle auto-logout** (15 min–8 h or never).
- Command-center first-run setup wizard + recovery code (replaced the hardcoded demo login).
- New settings: setpoint limits, backup/restore, 12/24-hour clock, start page, outdoor-temp
  test override, real site location.
- Real header **bus-health light** (green healthy / red problem / grey offline).

## v1.4.2 — 2026-11-10
De-brand of the main UI to "Cortex", protocol-reference corrections, and the first batch of
master-mode decode fixes.

## v1.4.1 — 2026-11-10
De-branded main UI (AIROW retained only in About/credits), OTA auto-config in the installer,
working power buttons, and fresh-install setup.

## v1.4.0 — 2026-11-10
Reply-parser decode from the ACP firmware, README with real screenshots, layout and
update-flow fixes.

## v1.3.0 and earlier
Initial appliance + UI, LGAP decode from firmware, master/CC mode beta, GitHub + OTA setup.

---

*Cortex by AIROW. Not affiliated with or endorsed by LG.*
