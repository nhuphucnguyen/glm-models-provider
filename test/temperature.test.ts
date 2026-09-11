import {beforeEach, describe, expect, it} from 'vitest';
import {__setConfiguration} from './vscode-stub';
import {
  getConfiguredTopP,
  normalizeTemperatureValue,
} from '../src/provider/temperature';

beforeEach(() => {
  __setConfiguration({});
});

describe('normalizeTemperatureValue', () => {
  it('resolves the named presets', () => {
    expect(normalizeTemperatureValue('balanced')).toBe(0.7);
    expect(normalizeTemperatureValue('precise')).toBe(0.2);
    expect(normalizeTemperatureValue('creative')).toBe(0.9);
    expect(normalizeTemperatureValue('max')).toBe(1.0);
  });

  it('reads the configured value for the custom preset', () => {
    __setConfiguration({'glm-models-provider.temperature': 0.33});
    expect(normalizeTemperatureValue('custom')).toBe(0.33);
  });

  it('returns undefined for custom when nothing is configured', () => {
    expect(normalizeTemperatureValue('custom')).toBeUndefined();
  });

  it('clamps numbers into 0-1', () => {
    expect(normalizeTemperatureValue(2)).toBe(1);
    expect(normalizeTemperatureValue(-1)).toBe(0);
    expect(normalizeTemperatureValue(0.5)).toBe(0.5);
  });

  it('clamps a configured custom value too', () => {
    __setConfiguration({'glm-models-provider.temperature': 5});
    expect(normalizeTemperatureValue('custom')).toBe(1);
  });

  it('parses a numeric string', () => {
    expect(normalizeTemperatureValue('0.4')).toBe(0.4);
  });

  it('rejects values it cannot read', () => {
    expect(normalizeTemperatureValue('nonsense')).toBeUndefined();
    expect(normalizeTemperatureValue(undefined)).toBeUndefined();
    expect(normalizeTemperatureValue(Number.NaN)).toBeUndefined();
  });
});

describe('getConfiguredTopP', () => {
  it('defaults to the Z.AI recommendation', () => {
    expect(getConfiguredTopP()).toBe(0.95);
  });

  it('uses a configured value', () => {
    __setConfiguration({'glm-models-provider.topP': 0.5});
    expect(getConfiguredTopP()).toBe(0.5);
  });

  it('falls back when the configured value is unusable', () => {
    __setConfiguration({'glm-models-provider.topP': 0});
    expect(getConfiguredTopP()).toBe(0.95);
  });

  it('caps the configured value at 1', () => {
    __setConfiguration({'glm-models-provider.topP': 4});
    expect(getConfiguredTopP()).toBe(1);
  });
});
