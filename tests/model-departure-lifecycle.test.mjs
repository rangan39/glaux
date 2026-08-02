import assert from "node:assert/strict";
import test from "node:test";

const { requestDepartureConfirmation } = await import("../src/hooks/use-model-departure-lifecycle.ts");

test("requests the browser-controlled departure confirmation", () => {
  let prevented = false;
  const event = {
    preventDefault() { prevented = true; },
    returnValue: false
  };
  requestDepartureConfirmation(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, true);
});
