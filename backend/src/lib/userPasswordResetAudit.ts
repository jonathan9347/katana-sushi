export function createPasswordResetAuditLog(actorId: string, targetUserId: string, targetName: string) {
  return {
    user_id: actorId,
    action: "password_reset",
    entity: "user",
    entity_id: targetUserId,
    new_value: { name: targetName }
  };
}

export function formatPasswordResetAuditMessage(targetName: string) {
  return `Reset password for ${targetName}`;
}