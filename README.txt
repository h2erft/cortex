CORTEX — local copy
===================

What's in this folder
---------------------
  cortex.html          ... Cortex — the single-building controller
  command-center.html  ... Cortex Command — the multi-site fleet console
  appliance/           ... the mini-PC backend (installer, service, updater)
  docs/HANDOFF.md      ... developer notes (history, what is decoded, next steps)
  LGAP_reference.md    ... the decoded LG bus protocol

  Open Cortex (customer).bat  ... double-click to open the controller as a demo
  Open Command Center.bat     ... double-click to open the fleet console

Demo vs. the real thing
-----------------------
  Opening cortex.html as a file is a DEMO: it runs the setup wizard, keeps its state in
  this browser only, and cannot reach any equipment.

  The real controller is the appliance: install it on a mini-PC (see README.md and
  appliance/README-appliance.md), then open http://<box>:8080 from any phone or laptop.
  There the unit list, settings, trends and floor plans live on the box and every screen
  shows the same thing.

Logins
------
  There are no built-in logins or access codes. The first-time setup wizard has you
  create the owner account and the access codes.

Updates
-------
  Appliances update themselves from GitHub releases. See README.md -> Releases / OTA.
