import test from "node:test";
import assert from "node:assert/strict";
import { todayIsoInTimeZone } from "./date.js";

test("todayIsoInTimeZone usa o dia de Sao Paulo mesmo com o servidor em UTC", () => {
  // 02h UTC de 01/10 ainda e 30/09 em Sao Paulo (UTC-3).
  assert.equal(todayIsoInTimeZone("America/Sao_Paulo", new Date("2026-10-01T02:00:00Z")), "2026-09-30");
  assert.equal(todayIsoInTimeZone("America/Sao_Paulo", new Date("2026-10-01T03:00:00Z")), "2026-10-01");
});
