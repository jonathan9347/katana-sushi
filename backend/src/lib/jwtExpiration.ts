const durationPattern = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i;

export function jwtExpirationSeconds(value: string) {
  const match = value.length <= 100 ? durationPattern.exec(value) : null;
  if (!match) {
    throw new Error("JWT_EXPIRES_IN must be a positive duration such as 8h.");
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  const millisecondsPerUnit = unit.startsWith("y") || unit.startsWith("yr") || unit.startsWith("year")
    ? 365.25 * 24 * 60 * 60 * 1000
    : unit.startsWith("d")
      ? 24 * 60 * 60 * 1000
      : unit.startsWith("h")
        ? 60 * 60 * 1000
        : unit === "m" || unit.startsWith("min")
          ? 60 * 1000
          : unit === "s" || unit.startsWith("sec")
            ? 1000
            : 1;
  const milliseconds = amount * millisecondsPerUnit;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error("JWT_EXPIRES_IN must be a positive duration such as 8h.");
  }

  return Math.floor(milliseconds / 1000);
}
