import assert from "node:assert/strict";
import test from "node:test";

const { requestDepartureConfirmation, shouldReconcileAfterPageShow } = await import("../src/hooks/use-model-departure-lifecycle.ts");

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

test("reruns authoritative cleanup only when a page is restored from the back-forward cache", () => {
  assert.equal(shouldReconcileAfterPageShow({ persisted: true }), true);
  assert.equal(shouldReconcileAfterPageShow({ persisted: false }), false);
});
