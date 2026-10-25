// The deterministic check registry (spec §7.3 S4). A rule with
// `checkType: "deterministic"` names one of these by `fn` and lists the
// lease key terms it reads; the loader refuses a pack whose rule names an
// unknown check or inputs the check does not take. Checks are pure: verified
// key terms in, an outcome out. No model is involved.

export type CheckOutcome = 'violates' | 'complies' | 'insufficient_input';

export interface CheckResult {
  outcome: CheckOutcome;
  // The statutory limit and the lease's value, in the unit the check names.
  limit?: number;
  actual?: number;
}

export type CheckInputs = Readonly<Record<string, number | undefined>>;

export interface DeterministicCheck {
  // Key terms the check needs; a rule must list every one.
  inputs: readonly string[];
  // Key terms the check uses when present; a rule may list them.
  optionalInputs: readonly string[];
  unit: 'usd' | 'hours';
  run(inputs: CheckInputs): CheckResult;
}

const isAmount = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Whole cents, so 10% comparisons never round the wrong way.
const cents = (usd: number) => Math.round(usd * 100);

// At most twice the monthly rent (§ 55.1-1208(A)(7), § 55.1-1226(A)).
function twoMonthsRent(totalCents: number, monthlyRentUsd: number): CheckResult {
  const limit = cents(monthlyRentUsd) * 2;
  return { outcome: totalCents > limit ? 'violates' : 'complies', limit: limit / 100, actual: totalCents / 100 };
}

export const CHECKS = {
  // § 55.1-1204(E): the lesser of 10% of the periodic rent or 10% of the
  // remaining balance. A lease rarely states the balance, so without it the
  // cap is 10% of the rent.
  lateFeeCap: {
    inputs: ['lateFee', 'monthlyRent'],
    optionalInputs: ['remainingBalance'],
    unit: 'usd',
    run({ lateFee, monthlyRent, remainingBalance }) {
      if (!isAmount(lateFee) || !isAmount(monthlyRent) || monthlyRent === 0) return { outcome: 'insufficient_input' };
      const base = isAmount(remainingBalance) ? Math.min(cents(monthlyRent), cents(remainingBalance)) : cents(monthlyRent);
      // fee > base / 10, kept in integers: fee * 10 > base.
      const outcome = cents(lateFee) * 10 > base ? 'violates' : 'complies';
      return { outcome, limit: Math.floor(base / 10) / 100, actual: cents(lateFee) / 100 };
    },
  },
  // § 55.1-1226(A): a security deposit of at most two months' rent.
  securityDepositCap: {
    inputs: ['securityDeposit', 'monthlyRent'],
    optionalInputs: [],
    unit: 'usd',
    run({ securityDeposit, monthlyRent }) {
      if (!isAmount(securityDeposit) || !isAmount(monthlyRent) || monthlyRent === 0) return { outcome: 'insufficient_input' };
      return twoMonthsRent(cents(securityDeposit), monthlyRent);
    },
  },
  // § 55.1-1208(A)(7): deposit plus damage insurance premiums together at
  // most two months' rent.
  depositPlusInsuranceCap: {
    inputs: ['securityDeposit', 'damageInsurancePremium', 'monthlyRent'],
    optionalInputs: [],
    unit: 'usd',
    run({ securityDeposit, damageInsurancePremium, monthlyRent }) {
      if (!isAmount(securityDeposit) || !isAmount(damageInsurancePremium) || !isAmount(monthlyRent) || monthlyRent === 0) {
        return { outcome: 'insufficient_input' };
      }
      return twoMonthsRent(cents(securityDeposit) + cents(damageInsurancePremium), monthlyRent);
    },
  },
  // § 55.1-1229(A): at least 72 hours' notice before routine maintenance.
  // Applies only when the lease states hours.
  maintenanceNoticeHours: {
    inputs: ['maintenanceNoticeHours'],
    optionalInputs: [],
    unit: 'hours',
    run({ maintenanceNoticeHours }) {
      if (!isAmount(maintenanceNoticeHours)) return { outcome: 'insufficient_input' };
      return { outcome: maintenanceNoticeHours < 72 ? 'violates' : 'complies', limit: 72, actual: maintenanceNoticeHours };
    },
  },
} satisfies Record<string, DeterministicCheck>;

export type CheckName = keyof typeof CHECKS;

export function isCheckName(name: string): name is CheckName {
  return Object.hasOwn(CHECKS, name);
}

// Runs a rule's check on the lease's verified key terms. The loader has
// already checked that `fn` exists, so an unknown name here is a bug.
export function runCheck(fn: string, inputs: CheckInputs): CheckResult {
  if (!isCheckName(fn)) throw new Error(`unknown deterministic check "${fn}"`);
  return CHECKS[fn].run(inputs);
}
