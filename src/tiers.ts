import type { sheets_v4 } from "googleapis";
import { parseTierMaxFromLabel, parseTierMinFromLabel } from "./time.js";

export type TierBlock = {
  label: string;
  /** `<45.000` tiers — checked in ascending order */
  upperBound: number | null;
  /** `>48.000` tiers — lapTime must be >= lowerBound */
  lowerBound: number | null;
  /** 1-based first row of the column-A merge */
  startRow: number;
  /** 1-based last row of the column-A merge (inclusive) */
  endRow: number;
};

export type CarRowRef = {
  offset: number;
  car: string;
  timeNum: number;
};

export function parseTierBounds(label: string): {
  upperBound: number | null;
  lowerBound: number | null;
} {
  return {
    upperBound: parseTierMaxFromLabel(label),
    lowerBound: parseTierMinFromLabel(label),
  };
}

/** Pick tier block from column-A labels (`<` then `>`). */
export function resolveTierForLapTime(
  tiers: readonly TierBlock[],
  lapTime: number
): TierBlock {
  const upperTiers = tiers
    .filter((t) => t.upperBound != null)
    .sort((a, b) => a.upperBound! - b.upperBound!);
  for (const tier of upperTiers) {
    if (lapTime < tier.upperBound!) return tier;
  }
  for (const tier of tiers.filter((t) => t.lowerBound != null)) {
    if (lapTime >= tier.lowerBound!) return tier;
  }
  if (upperTiers.length > 0) return upperTiers[upperTiers.length - 1]!;
  throw new Error(
    `Lap time ${lapTime} does not match any tier threshold in column A.`
  );
}

export function tierBlockAtRow(
  tiers: readonly TierBlock[],
  physicalRow: number
): TierBlock | undefined {
  return tiers.find(
    (t) => physicalRow >= t.startRow && physicalRow <= t.endRow
  );
}

export function carRowsInTierBlock(
  rows: readonly CarRowRef[],
  tier: TierBlock,
  dataStartRow: number
): CarRowRef[] {
  return rows.filter((r) => {
    const phys = dataStartRow + r.offset;
    return phys >= tier.startRow && phys <= tier.endRow;
  });
}

/** 1-based row to insert before, sorted by time within the tier block. */
export function resolveSortedInsertPhysical1Based(
  tier: TierBlock,
  dataStartRow: number,
  tierCars: readonly Pick<CarRowRef, "offset" | "timeNum">[],
  newTimeNum: number
): number {
  const idx = tierCars.findIndex((r) => r.timeNum > newTimeNum);
  if (idx < 0) {
    if (tierCars.length === 0) return tier.startRow;
    return dataStartRow + tierCars[tierCars.length - 1]!.offset + 1;
  }
  return dataStartRow + tierCars[idx]!.offset;
}

/** Avoid inheriting header formatting when inserting on the first data row. */
export function insertInheritFromBefore(
  insertPhysical1Based: number,
  dataStartRow: number
): boolean {
  return insertPhysical1Based > dataStartRow;
}

export function columnAMergeGridRange(
  sheetId: number,
  startRow: number,
  endRowInclusive: number
): sheets_v4.Schema$GridRange {
  return {
    sheetId,
    startRowIndex: startRow - 1,
    endRowIndex: endRowInclusive,
    startColumnIndex: 0,
    endColumnIndex: 1,
  };
}

export function buildTierRowInsertRequests(
  sheetId: number,
  tier: TierBlock,
  insertPhysical1Based: number,
  dataStartRow: number
): sheets_v4.Schema$Request[] {
  const newEndRow = Math.max(tier.endRow + 1, insertPhysical1Based);
  return [
    {
      unmergeCells: {
        range: columnAMergeGridRange(sheetId, tier.startRow, tier.endRow),
      },
    },
    {
      insertDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: insertPhysical1Based - 1,
          endIndex: insertPhysical1Based,
        },
        inheritFromBefore: insertInheritFromBefore(
          insertPhysical1Based,
          dataStartRow
        ),
      },
    },
    {
      mergeCells: {
        range: columnAMergeGridRange(sheetId, tier.startRow, newEndRow),
        mergeType: "MERGE_ALL",
      },
    },
  ];
}

export function buildTierRowDeleteRequests(
  sheetId: number,
  tier: TierBlock,
  deletePhysical1Based: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [
    {
      unmergeCells: {
        range: columnAMergeGridRange(sheetId, tier.startRow, tier.endRow),
      },
    },
    {
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: deletePhysical1Based - 1,
          endIndex: deletePhysical1Based,
        },
      },
    },
  ];
  const newEndRow = tier.endRow - 1;
  if (newEndRow >= tier.startRow) {
    requests.push({
      mergeCells: {
        range: columnAMergeGridRange(sheetId, tier.startRow, newEndRow),
        mergeType: "MERGE_ALL",
      },
    });
  }
  return requests;
}

/** Build tier blocks from column-A merges + label text on the merge top-left cell. */
export function tierBlocksFromColumnAMerges(
  merges: readonly sheets_v4.Schema$GridRange[],
  columnAValues: readonly (readonly string[])[],
  tierScanFromRow = 1
): TierBlock[] {
  const colAMerges = merges
    .filter(
      (m) =>
        m.startColumnIndex === 0 &&
        m.endColumnIndex === 1 &&
        m.startRowIndex != null &&
        m.endRowIndex != null
    )
    .sort((a, b) => a.startRowIndex! - b.startRowIndex!);

  const blocks: TierBlock[] = [];
  for (const merge of colAMerges) {
    const startRow = merge.startRowIndex! + 1;
    const endRow = merge.endRowIndex!;
    const label = columnACellText(columnAValues, tierScanFromRow, startRow);
    const bounds = parseTierBounds(label);
    if (bounds.upperBound == null && bounds.lowerBound == null) continue;
    blocks.push({ label, ...bounds, startRow, endRow });
  }
  return blocks;
}

/** Fallback when column A is not merged yet: infer blocks from tier labels only. */
export function tierBlocksFromColumnALabels(
  columnAValues: readonly (readonly string[])[],
  tierScanFromRow = 1
): TierBlock[] {
  const labelRows: {
    row: number;
    label: string;
    upperBound: number | null;
    lowerBound: number | null;
  }[] = [];

  for (let i = 0; i < columnAValues.length; i++) {
    const label = columnACellText(columnAValues, tierScanFromRow, tierScanFromRow + i);
    if (!label) continue;
    const bounds = parseTierBounds(label);
    if (bounds.upperBound == null && bounds.lowerBound == null) continue;
    labelRows.push({
      row: tierScanFromRow + i,
      label,
      ...bounds,
    });
  }

  return labelRows.map((lr, i) => ({
    label: lr.label,
    upperBound: lr.upperBound,
    lowerBound: lr.lowerBound,
    startRow: lr.row,
    endRow:
      i + 1 < labelRows.length ? labelRows[i + 1]!.row - 1 : lr.row,
  }));
}

function columnACellText(
  columnAValues: readonly (readonly string[])[],
  tierScanFromRow: number,
  physicalRow: number
): string {
  const idx = physicalRow - tierScanFromRow;
  if (idx < 0 || idx >= columnAValues.length) return "";
  const cell = columnAValues[idx]?.[0];
  if (cell == null) return "";
  return String(cell).trim();
}
