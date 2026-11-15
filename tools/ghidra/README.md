# Ghidra headless helpers

Small GhidraScripts used to read an already-analysed Ghidra project without the GUI (and without REA).
They only read; nothing is written back to the project.

```bash
export JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64      # Ghidra 12.2 needs Java 25
unset JAVA_TOOL_OPTIONS
G=<ghidra dir>/support/analyzeHeadless ; P="<project dir> <project name>"
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Strs.java  '<regex>' out.txt      # strings + the functions that use them
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Syms.java  '<regex>' out.txt      # symbols (e.g. 'Sync4.*vftable')
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Vt.java    out.txt <addr> <count> # dump a vtable
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Addr.java  out.c <addr> [addr…]   # decompile functions
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Ints.java  out.txt <addr> […]     # 256-entry int tables
$G $P -process -noanalysis -readOnly -scriptPath tools/ghidra -postScript Calls.java out.txt <addr>         # calls + pushed constants
```
Each run takes ~10 s on an analysed project. Keep decompiler output out of this repository.
