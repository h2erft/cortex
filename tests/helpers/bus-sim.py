#!/usr/bin/env python3
"""A pretend RS-485 adapter with pretend indoor units on it, for tests.
Prints the serial device path to give the controller, then answers safe cmd0 reads
(80 00 A0 <addr> 00 00 00 ck) for the addresses given on the command line with a valid 16-byte reply.
Every byte it receives is counted in the file given as the first argument."""
import os, pty, sys, tty
count_file, addrs = sys.argv[1], {int(a) for a in sys.argv[2:]}
master, slave = pty.openpty(); tty.setraw(slave); tty.setraw(master)
print(os.ttyname(slave), flush=True)
ck = lambda b: (sum(b) & 0xFF) ^ 0x55
buf, total = bytearray(), 0
while True:
    try: d = os.read(master, 256)
    except OSError: continue
    if not d: continue
    total += len(d); open(count_file, 'w').write(str(total)); buf += d
    while len(buf) >= 8:
        f = buf[:8]
        if f[0] == 0x80 and f[2] == 0xA0 and ck(f[:7]) == f[7]:
            del buf[:8]
            if f[3] in addrs:
                r = [0x10, 0x01, 0xA0, 0x40, f[3], 0, 0x04, 0x18, 0x60, 0, 0, 0, 0, 0, 0]; r.append(ck(r)); os.write(master, bytes(r))
        else: del buf[:1]
