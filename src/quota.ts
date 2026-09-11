import {GlmApiError} from './api';

const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';

/** Z.AI's window-unit enum, with both the length and the display name. */
const UNITS: Record<number, {minutes: number; name: string}> = {
  1: {minutes: 1440, name: 'day'},
  3: {minutes: 60, name: 'hour'},
  5: {minutes: 1, name: 'minute'},
  6: {minutes: 10080, name: 'week'},
};

const FIVE_HOUR_MINUTES = 300;
const WEEKLY_MINUTES = 7 * 24 * 60;

export interface PlanWindow {
  label: string;
  /** Percent of the window quota already consumed (0-100). */
  usedPercent: number;
  /** Total quota for the window, when reported (e.g. tokens). */
  usage?: number;
  /** Remaining quota for the window, when reported (e.g. tokens). */
  remaining?: number;
  /** Epoch milliseconds when the window resets, when reported. */
  resetTime?: number;
}

export interface PlanQuota {
  planName?: string;
  fiveHour?: PlanWindow;
  weekly?: PlanWindow;
  /** Raw limit types seen in the response, for diagnostics when no window matches. */
  limitTypes?: string[];
}

interface RawLimit {
  type?: string;
  unit?: number;
  number?: number;
  percentage?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  nextResetTime?: number;
}

interface QuotaResponse {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: {
    planName?: string;
    plan?: string;
    plan_type?: string;
    packageName?: string;
    level?: string;
    limits?: RawLimit[];
  };
}

function toWindow(
  raw: RawLimit,
): (PlanWindow & {windowMinutes: number}) | undefined {
  if (
    (raw.type !== 'TOKENS_LIMIT' && raw.type !== 'CREDIT_LIMIT') ||
    typeof raw.percentage !== 'number' ||
    !Number.isFinite(raw.percentage)
  ) {
    return undefined;
  }

  const unit = typeof raw.unit === 'number' ? UNITS[raw.unit] : undefined;
  const windowMinutes =
    unit && typeof raw.number === 'number' ? unit.minutes * raw.number : 0;

  const usedPercent = Math.max(0, Math.min(100, raw.percentage));
  let label: string;
  if (windowMinutes === FIVE_HOUR_MINUTES) {
    label = '5-hour window';
  } else if (windowMinutes === WEEKLY_MINUTES) {
    label = 'Weekly window';
  } else {
    label = `${raw.number ?? '?'} ${unit?.name ?? 'window'} window`;
  }

  return {
    label,
    windowMinutes,
    usedPercent,
    usage: typeof raw.usage === 'number' ? raw.usage : undefined,
    remaining: typeof raw.remaining === 'number' ? raw.remaining : undefined,
    resetTime:
      typeof raw.nextResetTime === 'number' && raw.nextResetTime > 0
        ? raw.nextResetTime
        : undefined,
  };
}

export function parsePlanQuota(payload: unknown): PlanQuota {
  const data =
    payload && typeof payload === 'object'
      ? (payload as QuotaResponse).data
      : undefined;
  const limits = data && Array.isArray(data.limits) ? data.limits : [];

  const windows = limits
    .map(toWindow)
    .filter((w): w is PlanWindow & {windowMinutes: number} => w !== undefined);

  const planName =
    data?.planName ??
    data?.plan ??
    data?.plan_type ??
    data?.packageName ??
    data?.level;

  return {
    planName: typeof planName === 'string' && planName ? planName : undefined,
    fiveHour: windows.find(w => w.windowMinutes === FIVE_HOUR_MINUTES),
    weekly: windows.find(w => w.windowMinutes === WEEKLY_MINUTES),
    limitTypes: limits.map(l => String(l?.type ?? 'unknown')),
  };
}

function snippet(text: string, max = 300): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '<empty body>';
  }
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

/** A hung poll blocks every later one, so bound it well under the poll interval. */
const QUOTA_TIMEOUT_MS = 10_000;

export async function fetchPlanQuota(apiKey: string): Promise<PlanQuota> {
  let response: Response;
  try {
    response = await fetch(QUOTA_URL, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new GlmApiError(
        `request timed out after ${QUOTA_TIMEOUT_MS / 1000}s`,
        0,
      );
    }
    throw new GlmApiError(
      `request failed: ${error instanceof Error ? error.message : String(error)}`,
      0,
    );
  }

  const body = await response.text();
  if (!response.ok) {
    throw new GlmApiError(
      `HTTP ${response.status}: ${snippet(body)}`,
      response.status,
    );
  }

  let payload: QuotaResponse;
  try {
    payload = JSON.parse(body) as QuotaResponse;
  } catch {
    throw new GlmApiError(`non-JSON response: ${snippet(body)}`, 0);
  }

  if (!payload?.data || !Array.isArray(payload.data.limits)) {
    throw new GlmApiError(
      `unexpected response (success=${String(payload?.success)}, code=${String(payload?.code)}, msg=${String(payload?.msg)}): ${snippet(body)}`,
      typeof payload?.code === 'number' ? payload.code : 0,
    );
  }

  return parsePlanQuota(payload);
}
