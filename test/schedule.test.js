import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { parseTime } from '../lib/schedule.js';

describe('parseTime', () => {
  test('reads a 24-hour time', () => {
    assert.deepEqual(parseTime('03:00'), [3, 0]);
    assert.deepEqual(parseTime('3:05'), [3, 5]);
    assert.deepEqual(parseTime('23:59'), [23, 59]);
    assert.deepEqual(parseTime('00:00'), [0, 0]);
  });

  // A time the scheduler would silently never fire at is worse than a refusal to install.
  for (const at of ['24:00', '03:60', '3pm', '0300', '3', '', undefined]) {
    test(`refuses ${JSON.stringify(at)}`, () => {
      assert.throws(() => parseTime(at), /--at/);
    });
  }
});
