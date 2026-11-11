# Changelog

All notable changes to Cortex. Dates are when the work landed on `main`.

## v1.4.3 — pending (controller validation + big feature round)

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

**Known / still to do**
- Schedules run while a dashboard is open; backend (always-on) scheduling is the next step.
- Real push/email alerting is not yet wired.
- Verify on the wire: the ODU/system grouping byte and whether ODU faults reach indoor replies.

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
