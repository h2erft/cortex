import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class Addr extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); PrintWriter w = new PrintWriter(new FileWriter(a[0]));
    DecompInterface d = new DecompInterface(); d.openProgram(currentProgram);
    for (int i = 1; i < a.length; i++) { Function f = getFunctionContaining(toAddr(a[i])); if (f == null) { w.println("// no function at " + a[i]); continue; }
      DecompileResults r = d.decompileFunction(f, 300, monitor);
      w.println("//==== " + f.getEntryPoint() + " size " + f.getBody().getNumAddresses());
      w.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// FAILED " + r.getErrorMessage()); }
    w.close();
  }
}
