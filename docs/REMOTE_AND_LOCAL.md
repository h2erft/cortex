# Local or secure: which address Cortex uses, and when

A controller can be reached two ways:

| | Address | Works from | Needs |
|---|---|---|---|
| **Building network** | `http://192.168.x.x` or `http://cortex.local` | inside the building only | nothing; works with the internet down |
| **Secure (remote)** | `https://<box>.<tailnet>.ts.net:8443` | anywhere | Tailscale on the device, signed in to an account that can see the controller |

## Cortex for Windows switches by itself

The app keeps both addresses for a controller and uses the building network whenever it answers.

- It learns the other address from the controller. `/health` reports `lan` (its building-network
  addresses), `https.name` (the name on its trusted certificate) and `id` (a random name for that one
  controller, made once and kept in `data/controller-id`). A controller found in the office therefore
  already knows its secure address, and one added by its secure address knows its office address.
- At start, when a page fails to load, when the controller stops answering, and when the PC wakes up, it
  asks every address at once and takes the first one **in order** (building network first) that is the
  same controller.
- "The same controller" means the same `id` (or the same name, for controllers older than 1.7.1-beta.4).
  At home, `192.168.1.50` may be somebody's printer or even another Cortex; it is never mistaken for
  the office one.
- While on the secure address it keeps checking the building network, and moves back when the window
  is not in use, so nobody's work is interrupted.
- The sign-in is carried across, so switching address does not ask for the password again.
- Code: `desktop-app/route.js` (pure, tested in `tests/desktop-app.test.js`) and `desktop-app/main.js`.

## Phones

A browser cannot do what the app does: a page loaded over https is not allowed to talk to a plain
http address, and a home-screen icon is one fixed link. So:

- **App → On your phone** shows two QR codes: *Anywhere* (the secure link) and *In the building only*.
- Add the **Anywhere** link to the home screen. On that address Cortex installs a small service worker
  that keeps one page, `/offline.html`. If the controller cannot be reached (no internet, Tailscale
  off), that page is shown instead of a browser error. It has a button that opens Cortex on the
  building network, and it returns to Cortex by itself when the secure link answers again.
- Remote access from a phone always needs Tailscale on that phone. There is no safe way around that:
  the controller's API has no login of its own, so it must never be published to the open internet
  (do not use Tailscale Funnel or port forwarding).
- A customer's phone gets access either by joining the tailnet or by having the controller shared with
  their Tailscale account from the admin console.

## A browser tab on a PC

A plain browser tab does not switch. Use the app, or keep two bookmarks.
