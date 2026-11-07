/**
 * The result of reading `--expires`.
 * - `default`: the flag was absent, so the gateway applies its 90-day default.
 * - `never`: the token never expires (needs confirmation, see {@link confirmNeverExpires}).
 * - `at`: an explicit instant, as an ISO-8601 string.
 * - `invalid`: not understood; `message` says what is accepted.
 * @lastreviewed null
 */
export type ExpiresChoice =
  { kind: "default" } | { kind: "never" } | { kind: "at"; iso: string } | { kind: "invalid"; message: string };

const ACCEPTED =
  "Use a number of days like 90d, a date like 2027-03-01, a full date-time like 2027-03-01T12:00:00Z (or with an offset such as +02:00), or never.";
const DAY_MS = 86_400_000;

/**
 * Read an `--expires` value: `90d` (days from now), an ISO date or date-time, or `never`.
 * A date alone means the start of that day, UTC. A past or present instant is refused.
 * @param raw The flag's value, or `undefined` when absent.
 * @param now Injectable clock for tests.
 * @lastreviewed null
 */
export function parseExpires(raw: string | undefined, now: Date = new Date()): ExpiresChoice {
  if (raw === undefined) {
    return { kind: "default" };
  }
  const text = raw.trim();
  if (text.toLowerCase() === "never") {
    return { kind: "never" };
  }
  const days = /^(\d+)d$/i.exec(text);
  if (days) {
    const n = Number(days[1]);
    if (!Number.isSafeInteger(n) || n < 1 || n > 36_500) {
      return {
        kind: "invalid",
        message: `--expires ${raw}: the number of days must be between 1 and 36_500. ${ACCEPTED}`,
      };
    }
    return { kind: "at", iso: new Date(now.getTime() + n * DAY_MS).toISOString() };
  }
  // A date alone is the start of that day, UTC. Anything with a time must be a full ISO date-time with
  // seconds and a Z or numeric offset, because core refuses every other spelling.
  const withDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const withTime = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  const parts = withDate ?? withTime;
  if (parts) {
    const full = withDate ? `${text}T00:00:00Z` : text;
    const t = Date.parse(full);
    // Date.parse rolls 2027-02-31 over to March; reject a day that does not exist.
    const day = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    const real = day.getUTCMonth() === Number(parts[2]) - 1 && day.getUTCDate() === Number(parts[3]);
    if (!Number.isNaN(t) && real) {
      if (t <= now.getTime()) {
        return { kind: "invalid", message: `--expires ${raw} is not in the future.` };
      }
      return { kind: "at", iso: new Date(t).toISOString() };
    }
  }
  return { kind: "invalid", message: `--expires ${raw} is not understood. ${ACCEPTED}` };
}

/** The slice of the prompt provider {@link confirmNeverExpires} uses. */
export interface NeverExpiresPrompt {
  confirm(
    message: string,
    options: string[],
    opts?: { destructive?: boolean; safeOption?: string }
  ): Promise<string | undefined>;
  warn(message: string): void;
}

/**
 * Settle whether a token that never expires may be minted.
 *
 * `--expires never` has to be typed out, so under `--yes` that flag IS the decision and the token is
 * minted (with the warning printed). Without `--yes` the user is asked, with the safe option first and
 * marked destructive, so an empty answer or end of input declines. Nothing but the explicit flag can
 * reach this: `--yes` alone never mints a never-expiring token, because the default is 90 days.
 * @returns whether to go ahead.
 * @lastreviewed null
 */
export async function confirmNeverExpires(prompt: NeverExpiresPrompt, yes: boolean | undefined): Promise<boolean> {
  const warning =
    "A token that never expires stays valid until you revoke it. If it leaks, whoever holds it keeps your access.";
  if (yes) {
    prompt.warn(`${warning} Creating it because --expires never was passed explicitly.`);
    return true;
  }
  const cancel = "Cancel";
  const create = "Create a token that never expires";
  const answer = await prompt.confirm(`${warning} Create it anyway?`, [cancel, create], {
    destructive: true,
    safeOption: cancel,
  });
  return answer === create;
}
