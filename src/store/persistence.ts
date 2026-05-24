// localStorage persistence per docs/10-persistence.md. Two
// independent keys: a single in-progress run snapshot, and a
// top-10 leaderboard of finished runs. Encoded payloads carry a
// `version` integer; on a mismatch the entry is silently
// discarded (there is no migration code).
//
// The pure encode/decode helpers and the leaderboard math are
// the testable surface. The `*Run` / `*Scores` functions are
// thin wrappers that compose those with a Storage handle so the
// caller can pass `window.localStorage` in production and an
// in-memory fake in tests. Every Storage call is wrapped in a
// try/catch: storage quota, private browsing, and
// browser-disabled storage all degrade silently.

import { computeBoardSum } from '../core/score';
import { pieceToActive, computePool } from '../core/spawn';
import {
  type ActivePiece,
  type Board,
  type Cell,
  type Piece,
  type State,
  type Tier,
} from '../core/state';

const RUN_KEY = 'naturalchimie:run';
const SCORES_KEY = 'naturalchimie:scores';
const RUN_VERSION = 1;
const SCORES_VERSION = 1;
const PLAYFIELD_HEIGHT = 7;
const BOARD_HEIGHT = 9;
const BOARD_WIDTH = 7;
const LEADERBOARD_SIZE = 10;
const MIN_TIER = 1;
const MAX_TIER = 12;

type EncodedCell =
  | null
  | { readonly tier: number }
  | { readonly kind: 'detonator' };

type EncodedPiece =
  | {
      readonly kind: 'pair';
      readonly left: { readonly tier: number };
      readonly right: { readonly tier: number };
    }
  | { readonly kind: 'dynamite' }
  | { readonly kind: 'detonator' };

type EncodedRun = {
  readonly version: number;
  readonly board: readonly (readonly EncodedCell[])[];
  readonly activePiece: EncodedPiece;
  readonly nextPiece: EncodedPiece;
  readonly poolMax: number;
  readonly score: {
    readonly comboScore: number;
    readonly boardSum: number;
  };
};

export type LeaderboardEntry = {
  readonly score: number;
  readonly highestTier: number;
  readonly highestTierCount: number;
  readonly timestamp: string;
};

type EncodedScores = {
  readonly version: number;
  readonly entries: readonly LeaderboardEntry[];
};

// `State.active` is non-null on every stable board (the save trigger),
// so encoding can require it at the type level. The runtime guard sits
// in saveRun.
type SavableState = State & { readonly active: ActivePiece };

export function encodeRun(state: SavableState): EncodedRun {
  return {
    version: RUN_VERSION,
    board: encodeBoard(state.board),
    activePiece: encodeActive(state.active),
    nextPiece: encodePiece(state.preview),
    poolMax: poolMaxOf(state.board),
    score: {
      comboScore: state.comboScore,
      boardSum: state.score - state.comboScore,
    },
  };
}

export function decodeRun(raw: unknown): State | null {
  if (!isObject(raw)) return null;
  if (raw.version !== RUN_VERSION) return null;
  const board = decodeBoard(raw.board);
  if (board === null) return null;
  const active = decodePieceToActive(raw.activePiece);
  if (active === null) return null;
  const preview = decodePiece(raw.nextPiece);
  if (preview === null) return null;
  if (!isObject(raw.score)) return null;
  if (!isFiniteNumber(raw.score.comboScore)) return null;
  if (!isFiniteNumber(raw.score.boardSum)) return null;
  if (!isFiniteNumber(raw.poolMax)) return null;
  return {
    board,
    active,
    preview,
    score: raw.score.comboScore + raw.score.boardSum,
    comboScore: raw.score.comboScore,
  };
}

export function encodeScores(
  entries: readonly LeaderboardEntry[],
): EncodedScores {
  return { version: SCORES_VERSION, entries };
}

export function decodeScores(raw: unknown): LeaderboardEntry[] | null {
  if (!isObject(raw)) return null;
  if (raw.version !== SCORES_VERSION) return null;
  if (!Array.isArray(raw.entries)) return null;
  const out: LeaderboardEntry[] = [];
  for (const e of raw.entries) {
    const entry = decodeEntry(e);
    if (entry === null) return null;
    out.push(entry);
  }
  return out;
}

export function buildLeaderboardEntry(
  state: State,
  timestamp: string,
): LeaderboardEntry {
  let highestTier = 0;
  let highestTierCount = 0;
  for (const row of state.board) {
    for (const cell of row) {
      if (cell.kind !== 'element') continue;
      if (cell.tier > highestTier) {
        highestTier = cell.tier;
        highestTierCount = 1;
      } else if (cell.tier === highestTier) {
        highestTierCount++;
      }
    }
  }
  // The displayed score on game-over is preserved at the pre-drop
  // value (docs/01-gameplay-rules.md "Scoring"), but the leaderboard
  // score is `comboScore + boardSum` evaluated against the
  // game-over board (docs/10-persistence.md "Leaderboard"), which is
  // a different quantity.
  const score = state.comboScore + computeBoardSum(state.board);
  return { score, highestTier, highestTierCount, timestamp };
}

export function insertLeaderboardEntry(
  entries: readonly LeaderboardEntry[],
  entry: LeaderboardEntry,
): LeaderboardEntry[] {
  return [...entries, entry].sort(compareEntries).slice(0, LEADERBOARD_SIZE);
}

// Local-timezone ISO 8601, matching the example in the spec. The
// runtime `Date.toISOString()` is always UTC, so we format manually
// to keep the offset.
export function formatLocalTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const tzMin = -date.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const tzAbs = Math.abs(tzMin);
  const tzHours = pad(Math.floor(tzAbs / 60));
  const tzMinutes = pad(tzAbs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${tzHours}:${tzMinutes}`;
}

export function loadRun(storage: Storage): State | null {
  const raw = safeRead(storage, RUN_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return decodeRun(parsed);
}

export function saveRun(storage: Storage, state: State): void {
  if (state.active === null) return;
  const payload = encodeRun(state as SavableState);
  safeWrite(storage, RUN_KEY, JSON.stringify(payload));
}

export function clearRun(storage: Storage): void {
  safeRemove(storage, RUN_KEY);
}

export function loadScores(storage: Storage): LeaderboardEntry[] {
  const raw = safeRead(storage, SCORES_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return decodeScores(parsed) ?? [];
}

export function saveScores(
  storage: Storage,
  entries: readonly LeaderboardEntry[],
): void {
  safeWrite(storage, SCORES_KEY, JSON.stringify(encodeScores(entries)));
}

export function recordRunInLeaderboard(
  storage: Storage,
  state: State,
  timestamp: string,
): void {
  const next = insertLeaderboardEntry(
    loadScores(storage),
    buildLeaderboardEntry(state, timestamp),
  );
  saveScores(storage, next);
}

function encodeBoard(board: Board): EncodedCell[][] {
  const rows: EncodedCell[][] = [];
  // Only the 7x7 playfield is serialized; the overflow zone is empty
  // by definition on a stable board (docs/10-persistence.md).
  for (let r = 0; r < PLAYFIELD_HEIGHT; r++) {
    const row: EncodedCell[] = [];
    for (let c = 0; c < BOARD_WIDTH; c++) {
      row.push(encodeCell(board[r][c]));
    }
    rows.push(row);
  }
  return rows;
}

function encodeCell(cell: Cell): EncodedCell {
  switch (cell.kind) {
    case 'empty':
      return null;
    case 'element':
      return { tier: cell.tier };
    case 'detonator':
      return { kind: 'detonator' };
  }
}

function decodeBoard(raw: unknown): Board | null {
  if (!Array.isArray(raw) || raw.length !== PLAYFIELD_HEIGHT) return null;
  const rows: Cell[][] = [];
  for (let r = 0; r < PLAYFIELD_HEIGHT; r++) {
    const row = raw[r];
    if (!Array.isArray(row) || row.length !== BOARD_WIDTH) return null;
    const decoded: Cell[] = [];
    for (let c = 0; c < BOARD_WIDTH; c++) {
      const cell = decodeCell(row[c]);
      if (cell === null) return null;
      decoded.push(cell);
    }
    rows.push(decoded);
  }
  // Pad the overflow zone with empty cells so the runtime board has
  // its full height.
  for (let r = PLAYFIELD_HEIGHT; r < BOARD_HEIGHT; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < BOARD_WIDTH; c++) row.push({ kind: 'empty' });
    rows.push(row);
  }
  return rows;
}

function decodeCell(raw: unknown): Cell | null {
  if (raw === null) return { kind: 'empty' };
  if (!isObject(raw)) return null;
  if (raw.kind === 'detonator') return { kind: 'detonator' };
  if (isTier(raw.tier)) return { kind: 'element', tier: raw.tier };
  return null;
}

function encodeActive(active: ActivePiece): EncodedPiece {
  switch (active.kind) {
    case 'pair':
      // Save fires immediately after a spawn step, so the pair is
      // always horizontal at the spawn column. `first` is the left
      // half, `second` the right.
      return {
        kind: 'pair',
        left: { tier: active.first },
        right: { tier: active.second },
      };
    case 'dynamite':
      return { kind: 'dynamite' };
    case 'detonator':
      return { kind: 'detonator' };
  }
}

function encodePiece(piece: Piece): EncodedPiece {
  switch (piece.kind) {
    case 'pair':
      return {
        kind: 'pair',
        left: { tier: piece.first },
        right: { tier: piece.second },
      };
    case 'dynamite':
      return { kind: 'dynamite' };
    case 'detonator':
      return { kind: 'detonator' };
  }
}

function decodePiece(raw: unknown): Piece | null {
  if (!isObject(raw)) return null;
  switch (raw.kind) {
    case 'pair': {
      if (!isObject(raw.left) || !isObject(raw.right)) return null;
      if (!isTier(raw.left.tier) || !isTier(raw.right.tier)) return null;
      return { kind: 'pair', first: raw.left.tier, second: raw.right.tier };
    }
    case 'dynamite':
      return { kind: 'dynamite' };
    case 'detonator':
      return { kind: 'detonator' };
    default:
      return null;
  }
}

function decodePieceToActive(raw: unknown): ActivePiece | null {
  const piece = decodePiece(raw);
  if (piece === null) return null;
  return pieceToActive(piece);
}

function decodeEntry(raw: unknown): LeaderboardEntry | null {
  if (!isObject(raw)) return null;
  if (!isFiniteNumber(raw.score)) return null;
  if (!isFiniteNumber(raw.highestTier)) return null;
  if (!isFiniteNumber(raw.highestTierCount)) return null;
  if (typeof raw.timestamp !== 'string') return null;
  return {
    score: raw.score,
    highestTier: raw.highestTier,
    highestTierCount: raw.highestTierCount,
    timestamp: raw.timestamp,
  };
}

function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.highestTier !== b.highestTier) return b.highestTier - a.highestTier;
  if (a.highestTierCount !== b.highestTierCount) {
    return b.highestTierCount - a.highestTierCount;
  }
  if (a.score !== b.score) return b.score - a.score;
  // Newer timestamps rank above older ones. Parsing through Date
  // handles any timezone offset correctly; lexicographic compare
  // would only work for matching offsets.
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}

function poolMaxOf(board: Board): number {
  const pool = computePool(board);
  return pool[pool.length - 1];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTier(value: unknown): value is Tier {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TIER &&
    value <= MAX_TIER
  );
}

function safeRead(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Spec: degrade silently.
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Spec: degrade silently.
  }
}
