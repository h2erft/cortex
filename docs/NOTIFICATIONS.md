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
