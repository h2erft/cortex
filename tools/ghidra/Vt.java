import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class Vt extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); PrintWriter w = new PrintWriter(new FileWriter(a[0]));
    for (int i = 1; i < a.length; i += 2) { Address ad = toAddr(a[i]); int n = Integer.parseInt(a[i+1]); w.println("## " + a[i]);
      for (int k = 0; k < n; k++) { long v = getInt(ad.add(4L*k)) & 0xffffffffL; Function f = getFunctionAt(toAddr(v));
        w.println(String.format("+0x%x %08x %s", 4*k, v, f == null ? "" : ("fn size " + f.getBody().getNumAddresses()))); } }
    w.close();
  }
}
