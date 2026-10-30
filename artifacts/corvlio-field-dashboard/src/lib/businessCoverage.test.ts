import { describe, expect, it } from 'vitest';
import { validateBusinessHours, validateTimeZone } from './businessCoverage';

describe('business coverage validation', () => {
  it('accepts schedules', () => {
    for (const v of ['Mon-Fri 09:00-17:00', 'Mon-Fri 08:00-18:00; Sat 09:00-13:00', '24/7', 'Mon,Wed 9:00-12:30']) expect(validateBusinessHours(v)).toBeNull();
  });
  it('rejects bad schedules', () => {
    for (const v of ['', 'Mon-Fri', 'Funday 09:00-17:00', 'Mon 17:00-09:00', 'Mon 09:00-17:00;', 'Mon 25:00-26:00']) expect(validateBusinessHours(v)).not.toBeNull();
  });
  it('validates time zones', () => {
    expect(validateTimeZone('America/Chicago')).toBeNull();
    expect(validateTimeZone('Mars/Base')).not.toBeNull();
  });
});
