import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppUrl } from "./phone.js";

test("link do WhatsApp usa api.whatsapp.com e preserva emojis", () => {
  const url = buildWhatsAppUrl("(31) 99999-0000", "Oi! Tudo bem? 😊\nVacina 💚");
  assert.ok(url.startsWith("https://api.whatsapp.com/send?phone=5531999990000&text="));
  assert.ok(!url.includes("wa.me"));
  const text = new URL(url).searchParams.get("text");
  assert.equal(text, "Oi! Tudo bem? 😊\nVacina 💚");
});
