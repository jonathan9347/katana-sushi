export function getJwtSecret(): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  return secret || null;
}
