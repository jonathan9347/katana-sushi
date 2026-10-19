const DEFAULT_SENIOR_PWD_DISCOUNT_RATE = 0.2;

export function parseSeniorPwdDiscountRate(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SENIOR_PWD_DISCOUNT_RATE;
  if (value.trim() === "") {
    throw new Error("SENIOR_PWD_DISCOUNT_RATE must be a number between 0 and 1.");
  }

  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("SENIOR_PWD_DISCOUNT_RATE must be a number between 0 and 1.");
  }
  return rate;
}

export const SENIOR_PWD_DISCOUNT_RATE = parseSeniorPwdDiscountRate(
  process.env.SENIOR_PWD_DISCOUNT_RATE
);
