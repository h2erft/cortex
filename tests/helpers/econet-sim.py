#!/usr/bin/env python3
"""A pretend Rheem/Ruud EcoNet system on a pretend RS-485 adapter, for tests.
Written independently of Cortex's own encoder (so the two check each other).
Prints the serial device path, then:
  - answers "read" messages addressed to the thermostat (0x380) or outdoor unit (0x400);
  - accepts "write" messages to the thermostat and remembers the new value;
  - every 2 s the thermostat asks the outdoor unit for two values and the outdoor unit answers
    (the background chatter a real system has);
  - appends every write it receives to the file given as the first argument ("NAME value")."""
import os, pty, select, struct, sys, time, tty
log_file = sys.argv[1]
master, slave = pty.openpty(); tty.setraw(slave); tty.setraw(master)
print(os.ttyname(slave), flush=True)
def crc(b):
    c = 0
    for x in b:
        c ^= x
        for _ in range(8): c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c
def frame(dst, src, cmd, data):
    f = bytes([0x80, dst >> 16 & 255, dst >> 8 & 255, dst & 255, 0, 0x80, src >> 16 & 255, src >> 8 & 255, src & 255, 0, len(data), 0, 0, cmd]) + bytes(data)
    c = crc(f); return f + bytes([c & 255, c >> 8])
num = lambda v: bytes([0, 0, 0]) + struct.pack('>f', v)
enum = lambda v, t: bytes([2, 0, 0, v, len(t)]) + t.encode()
text = lambda t: bytes([1, 0, 0]) + t.encode()
STAT = {'SPT': num(71.6), 'HEATSETP': num(68.0), 'COOLSETP': num(74.0), 'STATMODE': enum(1, 'Cooling '), 'HVACMODE': enum(2, 'Low Cool'), 'SCHEDULE': enum(0, 'Off     '),
        'STAT_FAN': enum(0, 'Auto    '), 'STATNFAN': enum(0, 'Auto    '), 'RELH7005': num(44.0), 'F_ACTCFM': num(812.0), 'ALRMALRT': num(1.0), 'ALARM_01': text('T101 Filter reminder   '), 'ALARM_02': text('        ')}
ODU = {'TEMP_OAT': num(88.2), 'PRES_SUC': num(131.0), 'PRES_LIQ': num(342.0), 'PRODMODN': text('RA1736AJ1NA     ')}
DEV = {0x380: STAT, 0x400: ODU}
def names(data): return [bytes(data[i:i + 8]).replace(b'\x00', b'').decode().strip() for i in range(4, len(data) - 7, 10)]
def answer(dst, src, ns):
    out = b''
    for n in ns:
        item = DEV[src].get(n, bytes([21])); out += bytes([len(item)]) + item
    return frame(dst, src, 6, out)
buf, last = bytearray(), time.time()
while True:
    r, _, _ = select.select([master], [], [], 0.2)
    if r:
        try: buf += os.read(master, 512)
        except OSError: pass
    while len(buf) >= 16:
        if buf[0] != 0x80 or buf[5] != 0x80: del buf[:1]; continue
        total = 16 + buf[10]
        if len(buf) < total: break
        f = bytes(buf[:total])
        if crc(f[:-2]) != f[-2] | f[-1] << 8: del buf[:1]; continue
        del buf[:total]
        dst, src, cmd, data = f[1] << 16 | f[2] << 8 | f[3], f[6] << 16 | f[7] << 8 | f[8], f[13], f[14:-2]
        if dst not in DEV: continue
        if cmd == 0x1E: os.write(master, answer(src, dst, names(data)))
        elif cmd == 0x1F and dst == 0x380:
            n, v = bytes(data[6:14]).replace(b'\x00', b'').decode().strip(), struct.unpack('>f', data[14:18])[0]
            open(log_file, 'a').write('%s %g\n' % (n, v))
            if n in STAT: STAT[n] = enum(int(v), 'Set %d   ' % int(v)) if data[2] & 0x7F == 2 else num(v)
            os.write(master, frame(src, dst, 6, b''))
    if time.time() - last > 2:
        last = time.time(); ask = [2, 1]
        for n in ('TEMP_OAT', 'PRES_SUC'): ask += [0, 0] + list(n.encode().ljust(8, b'\x00'))
        os.write(master, frame(0x400, 0x380, 0x1E, ask)); time.sleep(0.03); os.write(master, answer(0x380, 0x400, ['TEMP_OAT', 'PRES_SUC']))
