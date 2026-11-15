import ghidra.app.script.GhidraScript;
import java.io.*;
public class Ints extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); PrintWriter w = new PrintWriter(new FileWriter(a[0]));
    for (int i = 1; i < a.length; i++) { StringBuilder sb = new StringBuilder(a[i] + ":"); for (int k = 0; k < 256; k++) sb.append(k == 0 ? "" : ",").append(getInt(toAddr(a[i]).add(4L*k))); w.println(sb); }
    w.close();
  }
}
