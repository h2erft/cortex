import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;
public class Calls extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs(); PrintWriter w = new PrintWriter(new FileWriter(a[0]));
    for (int i = 1; i < a.length; i++) { Function f = getFunctionContaining(toAddr(a[i])); w.println("//==== " + f.getEntryPoint());
      InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true); ArrayDeque<String> pushes = new ArrayDeque<>();
      while (it.hasNext()) { Instruction in = it.next(); String m = in.getMnemonicString();
        if (m.equals("PUSH")) { pushes.addLast(in.getDefaultOperandRepresentation(0)); if (pushes.size() > 6) pushes.removeFirst(); }
        else if (m.equals("CALL")) { String t = in.getDefaultOperandRepresentation(0); Reference[] rs = in.getReferencesFrom();
          for (Reference r : rs) { Symbol s = getSymbolAt(r.getToAddress()); if (s != null) { t = s.getName(true); break; } }
          w.println(in.getAddress() + " CALL " + t + " <- " + String.join(",", pushes)); pushes.clear(); } }
    }
    w.close();
  }
}
