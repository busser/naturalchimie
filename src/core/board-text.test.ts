import { describe, it, expect } from 'vitest';
import { parseBoard, formatBoard } from './board-text';
import type { Board, Cell } from './state';

const EMPTY_BOARD = `
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
`;

describe('parseBoard', () => {
  it('parses an empty 7-row diagram into a 9-row board of empties', () => {
    const board = parseBoard(EMPTY_BOARD);
    expect(board).toHaveLength(9);
    for (const row of board) {
      expect(row).toHaveLength(7);
      for (const cell of row) {
        expect(cell).toEqual({ kind: 'empty' });
      }
    }
  });

  it('flips the diagram so the bottom row becomes row 0', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
    expect(board[0][3]).toEqual({ kind: 'element', tier: 2 });
    expect(board[1][3]).toEqual({ kind: 'empty' });
  });

  it('places columns left-to-right, with column 0 on the left', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 . . . . . 9
    `);
    expect(board[0][0]).toEqual({ kind: 'element', tier: 1 });
    expect(board[0][6]).toEqual({ kind: 'element', tier: 9 });
  });

  it('accepts the 9-row form for diagrams that use the overflow zone', () => {
    const board = parseBoard(`
      . . . 2 . . .
      . . . 1 . . .
      . . . 1 . . .
      . . . 1 . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
    `);
    expect(board[8][3]).toEqual({ kind: 'element', tier: 2 });
    expect(board[7][3]).toEqual({ kind: 'element', tier: 1 });
    expect(board[0][3]).toEqual({ kind: 'element', tier: 12 });
  });

  it('parses every supported token', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      1 5 9 A B C E
    `);
    const row: Cell[] = [
      { kind: 'element', tier: 1 },
      { kind: 'element', tier: 5 },
      { kind: 'element', tier: 9 },
      { kind: 'element', tier: 10 },
      { kind: 'element', tier: 11 },
      { kind: 'element', tier: 12 },
      { kind: 'detonator' },
    ];
    expect(board[0]).toEqual(row);
  });

  it('tolerates indentation and leading/trailing blank lines', () => {
    const indented = parseBoard(`

          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . . . . .
          . . . 2 . . .

    `);
    const flush = parseBoard(
      [
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . 2 . . .',
      ].join('\n'),
    );
    expect(indented).toEqual(flush);
  });

  it('rejects rows with the wrong number of columns', () => {
    expect(() =>
      parseBoard(`
        . . . . . . .
        . . . . . .
      `),
    ).toThrow(/6 tokens, expected 7/);
  });

  it('rejects diagrams with more than 9 rows', () => {
    const tenRows = Array.from({ length: 10 }, () => '. . . . . . .').join('\n');
    expect(() => parseBoard(tenRows)).toThrow(/at most 9 rows, got 10/);
  });

  it('rejects unknown tokens', () => {
    expect(() =>
      parseBoard(`
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . X . . .
      `),
    ).toThrow(/unknown token "X"/);
  });

  it('rejects dynamite, which cannot occupy a board cell', () => {
    expect(() =>
      parseBoard(`
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . D . . .
      `),
    ).toThrow(/dynamite/);
  });
});

describe('formatBoard', () => {
  it('emits 7 rows when the overflow zone is empty', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
    const text = formatBoard(board);
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toBe(
      [
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . . . . .',
        '. . . 2 . . .',
      ].join('\n'),
    );
  });

  it('emits 9 rows when the overflow zone holds anything', () => {
    const board = parseBoard(`
      . . . 2 . . .
      . . . 1 . . .
      . . . 1 . . .
      . . . 1 . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
      . . . C . . .
    `);
    const text = formatBoard(board);
    expect(text.split('\n')).toHaveLength(9);
    expect(text.split('\n')[0]).toBe('. . . 2 . . .');
    expect(text.split('\n')[8]).toBe('. . . C . . .');
  });

  it('round-trips parse → format for a board using every token', () => {
    const original = [
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '. . . . . . .',
      '1 5 9 A B C E',
    ].join('\n');
    expect(formatBoard(parseBoard(original))).toBe(original);
  });
});

describe('toMatchBoard', () => {
  it('passes when the board equals the diagram', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
    expect(board).toMatchBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
  });

  it('passes for `.not` when the boards differ', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
    expect(board).not.toMatchBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 3 . . .
    `);
  });

  it('throws an assertion error when the boards differ', () => {
    const board = parseBoard(`
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . . . . .
      . . . 2 . . .
    `);
    expect(() =>
      expect(board).toMatchBoard(`
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . . . . .
        . . . 3 . . .
      `),
    ).toThrow(/expected board to match the diagram/);
  });
});

describe('round-trip', () => {
  it('format(parse(text)) is stable for the spec\'s example boards', () => {
    const examples = [
      // 1.3 — Drop into partially filled column (final state)
      `. . . . . . .
. . . . . . .
. . . . . . .
. . . 1 . . .
. . . 2 . . .
. . . 5 . . .
. . . 5 . . .`,
      // 2.4 — Genuine two-step cascade (final state)
      `. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. 3 . . . . .`,
      // 3.3 — Detonator chain (initial state)
      `. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . E . E . .`,
    ];
    for (const example of examples) {
      const board: Board = parseBoard(example);
      expect(formatBoard(board)).toBe(example);
    }
  });
});
