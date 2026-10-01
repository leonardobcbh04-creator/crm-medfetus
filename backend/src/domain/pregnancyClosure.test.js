import test from "node:test";
import assert from "node:assert/strict";
import { hasPassedAutoCloseDate, shouldAutoClosePregnancy } from "./pregnancyClosure.js";

const TODAY = "2026-10-01";
const active = (dpp, overrides = {}) => ({ status: "ativa", closedAt: null, dpp, gestationalReviewRequired: false, autoCloseDisabled: false, ...overrides });

test("encerra so depois da DPP + 14 dias (no 15o dia apos a DPP)", () => {
  assert.equal(shouldAutoClosePregnancy(active("2026-09-17"), TODAY), false); // DPP + 14 = hoje
  assert.equal(shouldAutoClosePregnancy(active("2026-09-16"), TODAY), true); // DPP + 15
  assert.equal(shouldAutoClosePregnancy(active("2026-10-20"), TODAY), false); // DPP no futuro
});

test("nao encerra quem ja esta encerrada, foi reaberta, tem base em revisao ou nao tem DPP", () => {
  assert.equal(shouldAutoClosePregnancy(active("2026-08-01", { status: "encerrada", closedAt: "2026-09-01" }), TODAY), false);
  assert.equal(shouldAutoClosePregnancy(active("2026-08-01", { autoCloseDisabled: true }), TODAY), false);
  assert.equal(shouldAutoClosePregnancy(active("2026-08-01", { gestationalReviewRequired: true }), TODAY), false);
  assert.equal(shouldAutoClosePregnancy(active(null), TODAY), false);
});

test("hasPassedAutoCloseDate usa o mesmo limite", () => {
  assert.equal(hasPassedAutoCloseDate({ dpp: "2026-09-16" }, TODAY), true);
  assert.equal(hasPassedAutoCloseDate({ dpp: "2026-09-17" }, TODAY), false);
  assert.equal(hasPassedAutoCloseDate({ dpp: null }, TODAY), false);
});
