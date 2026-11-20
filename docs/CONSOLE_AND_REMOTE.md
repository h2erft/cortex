# Remote access and the controller console

Both exist so that nobody needs a keyboard, screen or SSH session on the controller.

## Remote access (Tailscale)

Settings ▸ Advanced ▸ Remote access, the setup wizard's Remote access step, or Device health.

1. Press **Turn remote access on**. The controller runs `tailscale up --operator=cortex`.
2. The first time, Tailscale answers with a sign-in page. The dashboard shows a button for it.
   Open it on any device, sign in and approve the controller.
3. The box turns green with the controller's Tailscale name and address. The trusted https
   certificate is requested straight away (it used to wait for the half-hourly check).

How it is allowed: the installer and the updater make the service user Tailscale's operator
(`tailscale set --operator=cortex`). Until that has happened, the server falls back to one exact sudo
rule. API: `GET /api/remote`, `POST /api/remote {on}`.

## Controller console

Settings ▸ Advanced ▸ Controller console.

- **Its own password.** Set the first time it is opened (10 characters or more). It is stored on the
  controller as a salted scrypt hash in `data/console.json` (mode 600) and checked by the controller.
  It is deliberately not in the shared settings, because those can be written by any page the
  controller serves. Changing it needs the old one.
- **Lock-out.** Five wrong passwords lock the console for five minutes.
- **Sessions** end after 15 minutes without a command, or with Close session.
- **Commands** run with `bash -c`, as the service user (`cortex`), one at a time, for at most two
  minutes, with the working folder carried from one command to the next. Output is plain text:
  programs that need a live screen (nano, top) do not work.
- **Every command is written to the service log.**
- **Not a root shell.** `sudo` works only for the exact commands in `cortex.sudoers`:
  `systemctl restart cortex-appliance`, `journalctl -u cortex-appliance -n 300 --no-pager`,
  `systemctl reboot`, `systemctl poweroff`, `systemctl start cortex-updater.service`,
  `tailscale up --operator=cortex`, `tailscale set --operator=cortex`, `tailscale down`.

If the console password is lost, delete `data/console.json` on the controller (that does need a
keyboard or SSH) and set a new one.

API: `GET /api/console`, `POST /api/console/password|open|run|close`.
