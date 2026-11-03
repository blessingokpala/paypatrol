import { readFileSync, appendFileSync } from "node:fs";
import { extractInvoiceFromFile } from "./src/lib/ai/gemini.server";
const todo = ["001","002","003","004","005"];
const deadline = Date.now() + 520_000;
while (todo.length && Date.now() < deadline) {
  const f = todo[0];
  const r = await extractInvoiceFromFile(readFileSync(`/tmp/fx/INV-DEMO-${f}.pdf`).toString("base64"), "application/pdf");
  if (r.ok) { appendFileSync("/tmp/fx/inv.log", f + " " + JSON.stringify({ model: r.model, ref: r.data.invoice_reference, total: r.data.total, currency: r.data.currency, recipient: r.data.requested_payment_recipient, change: r.data.payment_change_instructions, missing: r.data.missing_fields, uncertain: r.data.uncertain_fields }) + "\n"); todo.shift(); }
  else { appendFileSync("/tmp/fx/inv.log", f + " busy " + r.error.code + " " + new Date().toISOString() + "\n"); await new Promise(s => setTimeout(s, 15000)); }
}
