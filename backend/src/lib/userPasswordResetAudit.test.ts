import assert from "node:assert/strict";
import { test } from "node:test";
import { createPasswordResetAuditLog, formatPasswordResetAuditMessage } from "./userPasswordResetAudit";

test("password reset audit contains only the target name, never the password", () => {
  const audit = createPasswordResetAuditLog("admin-id", "staff-id", "Alex Staff");

  assert.deepEqual(audit, {
    user_id: "admin-id",
    action: "password_reset",
    entity: "user",
    entity_id: "staff-id",
    new_value: { name: "Alex Staff" }
  });
  assert.equal("password" in audit.new_value, false);
  assert.equal(formatPasswordResetAuditMessage("Alex Staff"), "Reset password for Alex Staff");
});