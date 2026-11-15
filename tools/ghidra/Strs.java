import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import java.io.*;
import java.util.regex.*;
public class Strs extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); Pattern p = Pattern.compile(a[0]); PrintWriter w = new PrintWriter(new FileWriter(a[1]));
    DataIterator it = currentProgram.getListing().getDefinedData(true);
    while (it.hasNext()) { Data d = it.next(); if (!d.hasStringValue()) continue; String s = String.valueOf(d.getValue());
      if (!p.matcher(s).find()) continue; StringBuilder sb = new StringBuilder();
      for (Reference r : getReferencesTo(d.getAddress())) { Function f = getFunctionContaining(r.getFromAddress()); sb.append(" ").append(f == null ? ("@" + r.getFromAddress()) : f.getEntryPoint().toString()); }
      w.println(d.getAddress() + " | " + s.replace("\n", "\\n") + " |" + sb); }
    w.close();
  }
}
