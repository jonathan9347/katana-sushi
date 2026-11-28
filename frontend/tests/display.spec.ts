import { expect, test } from "@playwright/test";
import { describeActivity, humanizeEnum, shortRef } from "../src/lib/display";

test("display helpers humanize enum values and avoid exposing machine identifiers", () => {
  expect(humanizeEnum("pending_approval")).toBe("Pending Approval");
  expect(humanizeEnum("a8a4c80e-38cc-4ff9-a6a4-a1706e0d58f6")).toBe("Not available");
  expect(shortRef("CAT-20261128-123")).toBe("CAT-20261128-123");
  expect(shortRef("a8a4c80e-38cc-4ff9-a6a4-a1706e0d58f6")).toBe("Reference unavailable");
});

test("activity descriptions stay concise and do not expose API paths or UUIDs", () => {
  const identifier = "a8a4c80e-38cc-4ff9-a6a4-a1706e0d58f6";
  const createdProduct = describeActivity({
    actor_name: "Alex Rivera",
    actor_role: "admin",
    action: "CREATE",
    entity: "PRODUCT",
    entity_id: identifier,
    created_at: "2026-11-28T00:00:00.000Z",
    message: `Completed POST /api/admin/products/${identifier}`
  });

  expect(createdProduct.sentence).toBe("Alex Rivera created a product");
  expect(createdProduct.sentence).not.toContain(identifier);
  expect(createdProduct.sentence).not.toContain("/api/");

  const resetPassword = describeActivity({
    actor_name: "Alex Rivera",
    actor_role: "admin",
    action: "RESET_PASSWORD",
    entity: "USER",
    entity_id: identifier,
    created_at: "2026-11-28T00:00:00.000Z",
    message: `Completed POST /api/admin/users/${identifier}/reset-password`
  });
  expect(resetPassword.sentence).toBe("Alex Rivera reset a user's password");
});
