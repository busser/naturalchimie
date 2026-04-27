// Vitest setup: registers custom matchers used across the test suite.

import { expect } from 'vitest';
import { parseBoard, formatBoard } from './src/core/board-text';
import type { Board } from './src/core/state';

interface BoardMatchers<R = unknown> {
  toMatchBoard(expected: string): R;
}

declare module 'vitest' {
  // Augmenting Vitest's matcher interface so `toMatchBoard` is typed on `expect`.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T> extends BoardMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends BoardMatchers {}
}

expect.extend({
  toMatchBoard(received: Board, expected: string) {
    const expectedBoard = parseBoard(expected);
    const actualText = formatBoard(received);
    const expectedText = formatBoard(expectedBoard);
    const pass = actualText === expectedText;
    return {
      pass,
      message: () =>
        pass
          ? 'expected board not to match the diagram, but it did'
          : 'expected board to match the diagram',
      actual: actualText,
      expected: expectedText,
    };
  },
});
