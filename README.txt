CORTEX by AIROW — local copy
================================

FOR A NEW CLAUDE SESSION (read this first)
------------------------------------------
  Open cortex.html in a text editor. The very top has a "CORTEX HANDOFF NOTES" block:
  project summary, what's decoded on the LG bus (and how sure we are), history, and next
  steps. Upload cortex.html + this README to a new chat and say "read the handoff notes."

What's in this folder
---------------------
  command-center.html  ... Cortex Command — the multi-site fleet console (that's YOU, the owner)
  cortex.html          ... Cortex — the single-building controller (that's the CUSTOMER side)

  Open Command Center.bat     ... double-click to open the fleet console
  Open Cortex (customer).bat  ... double-click to open the customer controller

Either .bat just opens the matching page in your default browser. You can also
double-click the .html files directly.

Logins (demo)
-------------
  Command Center : owner / airow
  Cortex         : runs its first-time setup wizard on first open (you create the
                   owner account, access codes, and run the bus scan). After that it
                   remembers everything in this browser.

Where data lives
----------------
  Each page keeps its state in THIS browser's local storage (settings, users,
  schedules, the Command Center's buildings and access grants). Open it in the same
  browser to see your saved state. Clearing site data resets it.

Remote access (next step)
-------------------------
  Right now these open locally in your browser. To reach them from your phone or
  another machine, they need to be *served* (a local web server) and exposed through
  your Tailscale. We'll set that up next — this folder is the starting point.

Updates
-------
  When we change the software, the updated files get pushed back into this same
  folder. Re-open the page (or refresh) to get the new version. Your saved state
  stays put.

Local-first on purpose.
