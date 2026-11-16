# Notifications from a Cortex controller

Three ways an alert can leave the controller. All three fire for the same things: a unit raising an
error code, a unit that stops answering, and a cycle-diagnosis advisory (a fault pattern that has been
present for about ten minutes).

| Way | Needs | Good for |
|---|---|---|
| **Browser / phone push** (Settings ▸ Notifications ▸ Turn on for this device) | Cortex opened over **https with a trusted certificate**; controller has internet access | Alerts on a phone or PC with Cortex closed, no extra service |
| **Webhook** (Settings ▸ Fault alerts) | Any URL that accepts a POST: Home Assistant, ntfy, Node-RED | Sites without https, or to feed another system |
| **Cortex Command** | Command open in a browser that can reach the controller | A fleet view; pops a message and can beep when a building raises an alert |

## Why push needs https

Browsers only allow service workers and push on a secure page. A self-signed certificate is not enough:
the browser must trust it. The simplest trusted certificate for a controller on Tailscale:

1. On the controller: `tailscale cert <machine-name>.<tailnet>.ts.net`
2. Copy the two files it writes to `<data>/tls/cert.pem` and `<data>/tls/key.pem`.
3. Add `CORTEX_HTTPS=1` to `<data>/appliance.env` and restart the Cortex service.
4. Open `https://<machine-name>.<tailnet>.ts.net:<https port>` (Device health shows the port).
5. iPhone / iPad only: Share ▸ Add to Home Screen, and open Cortex from that icon. iOS delivers web push
   only to home-screen apps.
6. Settings ▸ Notifications ▸ **Turn on for this device**, then **Send a test**.

Tailscale certificates expire after 90 days; re-run step 1–2 before then.

## How it works

`appliance/push.js` implements Web Push with Node's own crypto (RFC 8291 message encryption, RFC 8292
VAPID). The controller makes one VAPID key pair on first start and keeps it, with the list of subscribed
browsers, in `<data>/push.json`. Each subscription remembers which kinds of alert that person asked for.
A push service that answers 404 or 410 means the browser unsubscribed, and the entry is dropped.

**Status:** the encryption and signing are covered by `tests/push.test.js` (round-trip against an
independent decrypt, signature verification). It has not yet been delivered through a real push service
to a real phone.

## Cortex Command: alerts while it is closed (v1.7.0-beta.11)

Cortex Command is one page that shows every building. Each building's own controller already sends that
building's alerts (above). Command adds one more kind: **fleet alerts**, for someone who looks after
several buildings and wants one place to hear about all of them.

How it works, step by step:

1. Open Command from a controller, not as a file: `https://<controller address>/command-center.html`.
   That controller becomes the "home" controller.
2. Command gives the home controller its list of buildings: a name and an address for each. Nothing
   else (no technicians, no access grants) leaves the browser.
3. In Command ▸ Settings ▸ **Alerts while Command is closed**, press **Turn on alerts**. The browser asks
   for permission once.
4. About once a minute the home controller asks each building three read-only questions: are you there,
   which units are in error or silent, and are there open diagnosis advisories.
5. When an answer changes, it sends a notification to every device that turned fleet alerts on.

What you get told: went offline (after two missed checks), back online, units in error, a unit stopped
answering, new diagnosis advisory. Each change once.

Things to know:

- The home controller must be able to reach the other buildings' addresses. With Tailscale that means
  it is on the same tailnet as they are.
- If Command is opened over https, give the buildings https addresses too. A browser will not let an
  https page talk to an http address, so the live tiles would stay empty (the alerts still work,
  because the controller does that checking, not the browser).
- Fleet alerts and a building's own alerts are separate switches. A phone with both turned on, for a
  building that is also the home controller, hears about a fault twice: once from the building, once
  from the fleet. Turn one off if that is too much.
- Files: `appliance/fleetwatch.js` (the watcher), `data/fleet.json` (list and last state).
  Endpoints: `GET/POST /api/fleet`, `POST /api/fleet/test`.

