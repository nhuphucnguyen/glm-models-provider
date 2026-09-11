import {describe, expect, it} from 'vitest';
import {parsePlanQuota} from '../src/quota';

/** Unit enum per Z.AI: 1=day, 3=hour, 5=minute, 6=week. */
const HOUR = 3;
const WEEK = 6;
const DAY = 1;

describe('parsePlanQuota', () => {
  it('picks out the 5-hour and weekly windows', () => {
    const quota = parsePlanQuota({
      data: {
        planName: 'Coding Pro',
        limits: [
          {
            type: 'TOKENS_LIMIT',
            unit: HOUR,
            number: 5,
            percentage: 40,
            remaining: 600_000,
            nextResetTime: 1_800_000_000_000,
          },
          {
            type: 'TOKENS_LIMIT',
            unit: WEEK,
            number: 1,
            percentage: 12,
          },
        ],
      },
    });

    expect(quota.planName).toBe('Coding Pro');
    expect(quota.fiveHour).toMatchObject({
      label: '5-hour window',
      usedPercent: 40,
      remaining: 600_000,
      resetTime: 1_800_000_000_000,
    });
    expect(quota.weekly).toMatchObject({
      label: 'Weekly window',
      usedPercent: 12,
    });
  });

  it('clamps percentages into 0-100', () => {
    const quota = parsePlanQuota({
      data: {
        limits: [
          {type: 'TOKENS_LIMIT', unit: HOUR, number: 5, percentage: 140},
          {type: 'TOKENS_LIMIT', unit: WEEK, number: 1, percentage: -5},
        ],
      },
    });

    expect(quota.fiveHour?.usedPercent).toBe(100);
    expect(quota.weekly?.usedPercent).toBe(0);
  });

  it('labels windows it does not recognise using the unit name', () => {
    const quota = parsePlanQuota({
      data: {
        limits: [{type: 'CREDIT_LIMIT', unit: DAY, number: 3, percentage: 50}],
      },
    });

    expect(quota.fiveHour).toBeUndefined();
    expect(quota.weekly).toBeUndefined();
    expect(quota.limitTypes).toEqual(['CREDIT_LIMIT']);
  });

  it('ignores limits with no usable percentage', () => {
    const quota = parsePlanQuota({
      data: {
        limits: [
          {type: 'TOKENS_LIMIT', unit: HOUR, number: 5},
          {type: 'SOMETHING_ELSE', unit: WEEK, number: 1, percentage: 10},
        ],
      },
    });

    expect(quota.fiveHour).toBeUndefined();
    expect(quota.weekly).toBeUndefined();
    expect(quota.limitTypes).toEqual(['TOKENS_LIMIT', 'SOMETHING_ELSE']);
  });

  it('falls back through the plan name fields', () => {
    expect(parsePlanQuota({data: {plan: 'Lite', limits: []}}).planName).toBe(
      'Lite',
    );
    expect(
      parsePlanQuota({data: {packageName: 'Max', limits: []}}).planName,
    ).toBe('Max');
    expect(parsePlanQuota({data: {limits: []}}).planName).toBeUndefined();
  });

  it('treats a malformed payload as empty rather than throwing', () => {
    expect(parsePlanQuota(undefined).limitTypes).toEqual([]);
    expect(parsePlanQuota({data: {limits: 'nope'}}).limitTypes).toEqual([]);
  });

  it('drops a zero reset time rather than reporting the epoch', () => {
    const quota = parsePlanQuota({
      data: {
        limits: [
          {
            type: 'TOKENS_LIMIT',
            unit: HOUR,
            number: 5,
            percentage: 10,
            nextResetTime: 0,
          },
        ],
      },
    });

    expect(quota.fiveHour?.resetTime).toBeUndefined();
  });
});
