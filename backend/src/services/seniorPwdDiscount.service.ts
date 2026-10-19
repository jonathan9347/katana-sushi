export type SeniorPwdDiscountInput = {
  aLaCarteTotal: number;
  guestCount: number;
  seniorPwdCount: number;
  discountRate: number;
};

export type SeniorPwdDiscount = {
  discountBase: number;
  guestCount: number;
  seniorPwdCount: number;
  discountRate: number;
  discountAmount: number;
};

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const exponent = Number(exponentText ?? 0);
  const [whole, fraction = ""] = coefficient.split(".");
  let numerator = BigInt(`${whole}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);

  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);

  return { numerator, denominator };
}

function roundPositiveRatioHalfUp(numerator: bigint, denominator: bigint) {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function calculateSeniorPwdDiscount(input: SeniorPwdDiscountInput): SeniorPwdDiscount {
  const { aLaCarteTotal, guestCount, seniorPwdCount, discountRate } = input;
  if (!Number.isFinite(aLaCarteTotal) || aLaCarteTotal < 0) {
    throw new RangeError("A la carte total must be a non-negative amount.");
  }
  if (!Number.isSafeInteger(guestCount) || guestCount < 1) {
    throw new RangeError("Total guests must be at least 1.");
  }
  if (!Number.isSafeInteger(seniorPwdCount) || seniorPwdCount < 0 || seniorPwdCount > guestCount) {
    throw new RangeError("Senior/PWD count must be between 0 and total guests.");
  }
  if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 1) {
    throw new RangeError("Senior/PWD discount rate must be between 0 and 1.");
  }

  const baseCents = Math.round(aLaCarteTotal * 100);
  if (!Number.isSafeInteger(baseCents)) {
    throw new RangeError("A la carte total is outside the supported currency range.");
  }
  const { numerator: rateNumerator, denominator: rateDenominator } = decimalFraction(discountRate);
  const numerator = BigInt(baseCents) * BigInt(seniorPwdCount) * rateNumerator;
  const denominator = BigInt(guestCount) * rateDenominator;
  const discountCents = seniorPwdCount === 0
    ? 0n
    : roundPositiveRatioHalfUp(numerator, denominator);

  return {
    discountBase: baseCents / 100,
    guestCount,
    seniorPwdCount,
    discountRate,
    discountAmount: Number(discountCents) / 100
  };
}
