import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.regex.*;
public class Syms extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); Pattern p = Pattern.compile(a[0]); PrintWriter w = new PrintWriter(new FileWriter(a[1]));
    SymbolIterator it = currentProgram.getSymbolTable().getAllSymbols(true);
    while (it.hasNext()) { Symbol s = it.next(); String n = s.getName(true); if (p.matcher(n).find()) w.println(s.getAddress() + " " + n); }
    w.close();
  }
}
