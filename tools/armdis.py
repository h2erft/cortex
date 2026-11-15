#!/usr/bin/env python3
"""Tiny ARM (32-bit, little-endian) function disassembler for a not-stripped ELF.

Used on 2026-11-14 to read the LG ACP's own control-engine binary and settle the cmd4 / cmd5 frame
layouts (see docs/KIT_FINDINGS.md section 7). The binary is the operator's own controller image and is
NOT in this repository — ask the operator for it. Nothing here talks to a bus or a device.

    pip install capstone          # plus binutils for `readelf`
    python3 tools/armdis.py path/to/engine.elf FindAcCmd4SendData ap_mkchksum
    python3 tools/armdis.py path/to/engine.elf --list FindAc        # list function symbols matching a word

If the image is a flash dump with many ELF files inside, carve the one you need first: search the
dump for the bytes 7F 45 4C 46 ("\\x7fELF"), cut from the header that precedes the symbol-name
string you are after up to the next header, and check it with `readelf -h`.

Each `ldr rX, [pc, #n]` is annotated with the literal it loads: a symbol name, or the C string at
that address — which is what makes the builders readable ("ON", "OFF", SQL text, column names).
Do NOT name this file dis.py: capstone imports the standard `dis` module and would pick this up.
"""
import sys,subprocess,struct
if len(sys.argv)<3: sys.exit(__doc__)
ELF=sys.argv[1]
from capstone import *
d=open(ELF,'rb').read()
# text section mapping via readelf
import re
secs=subprocess.run(['readelf','-SW',ELF],capture_output=True,text=True).stdout
S=[]
for m in re.finditer(r'\]\s+(\S+)\s+\S+\s+([0-9a-f]{8})\s+([0-9a-f]{6})\s+([0-9a-f]{6})',secs):
    S.append((m.group(1),int(m.group(2),16),int(m.group(3),16),int(m.group(4),16)))
def off(va):
    for n,a,o,sz in S:
        if a and a<=va<a+sz: return o+(va-a)
syms={}
for l in subprocess.run(['readelf','-sW',ELF],capture_output=True,text=True).stdout.splitlines():
    p=l.split()
    if len(p)>=8 and p[3] in('FUNC','OBJECT'):
        try: syms[int(p[1],16)]=(p[7],int(p[2]))
        except: pass
byname={v[0]:(k,v[1]) for k,v in syms.items()}
def cstr(va):
    o=off(va)
    if o is None: return None
    e=d.find(b'\0',o); s=d[o:e]
    try:
        t=s.decode('ascii')
        return t if len(t)>1 and all(31<ord(c)<127 or c in'\n\t' for c in t) else None
    except: return None
md=Cs(CS_ARCH_ARM,CS_MODE_ARM); md.detail=False
def dis(name,maxn=None):
    va,sz=byname[name]; o=off(va); code=d[o:o+sz]
    print(f'=== {name} @ {va:#x} size {sz}')
    n=0
    for i in md.disasm(code,va):
        extra=''
        m=re.search(r'\[pc, #(-?0x[0-9a-f]+|-?\d+)\]',i.op_str)
        if i.mnemonic.startswith('ldr') and m:
            tgt=i.address+8+int(m.group(1),0); v=struct.unpack('<I',d[off(tgt):off(tgt)+4])[0]
            s=cstr(v); extra=f'   ; ={v:#x}'+(f' "{s[:70]}"' if s else '')+(f' <{syms[v][0]}>' if v in syms else '')
        if i.mnemonic in('bl','b','blx'):
            try:
                t=int(i.op_str.strip('#'),16)
                if t in syms: extra=f'   ; <{syms[t][0]}>'
            except: pass
        print(f'{i.address:6x}: {i.mnemonic:7s}{i.op_str}{extra}')
        n+=1
        if maxn and n>=maxn: break
if __name__=='__main__':
    if sys.argv[2]=='--list':
        word=sys.argv[3] if len(sys.argv)>3 else ''
        for va,(nm,sz) in sorted(syms.items()):
            if word.lower() in nm.lower(): print(f'{va:8x} {sz:6d} {nm}')
    else:
        for nm in sys.argv[2:]: dis(nm)
