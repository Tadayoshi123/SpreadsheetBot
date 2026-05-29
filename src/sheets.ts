import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { JWT } from "google-auth-library";
import type { SheetConfig } from "./types.js";
import {
  parseLapTime,
  formatTimeForSheet,
  formatLapTimeSeconds,
} from "./time.js";
import {
  type TierBlock,
  type CarRowRef,
  resolveTierForLapTime,
  tierBlockAtRow,
  carRowsInTierBlock,
  resolveSortedInsertPhysical1Based,
  buildTierRowInsertRequests,
  buildTierRowDeleteRequests,
  tierBlocksFromColumnAMerges,
  tierBlocksFromColumnALabels,
} from "./tiers.js";
import {
  buildTunerNote,
  parseAlternatesBlock,
  alternatesCellText,
  alternatesNote,
  normalizeShareCode,
  extractTunerShareCodeDigitsFromNote,
  lookupTunerShareLine,
  lookupAlternateShareLines,
} from "./shareCode.js";
import {
  type DifficultyFormatMap,
  a1EscapeSheetTitle as escapeSheetTitle,
  buildApplyDifficultyFormatRequest,
  buildCopyDifficultyFormatRequest,
  difficultyCellText,
  mergeDifficultyFormatsFromConditionalRules,
  mergeDifficultyFormatsFromGridRows,
  parseOneOfRangeReference,
  validationListRangeA1,
} from "./difficultyFormat.js";
import {
  formatVideoForSheet,
  preserveVideoForSheet,
} from "./video-hyperlink.js";

export type NewEntryPayload = {
  /** R, S2, S1, A, B */
  car_class: string;
  car: string;
  time: string;
  tuner: string;
  tuner_share_code: string;
  driver: string;
  difficulty: string;
  drivetrain: string;
  tires: string;
  engine: string;
  build_type: string;
  performance: string;
  video: string;
  driving_characteristics?: string | null;
  other_characteristics?: string | null;
  alternate_tunes?: string | null;
};

/** Partial update: only supplied fields overwrite; omit = unchanged */
export type EditEntryPayload = {
  car_class: string;
  car: string;
  time?: string;
  tuner?: string;
  tuner_share_code?: string;
  driver?: string;
  difficulty?: string;
  drivetrain?: string;
  tires?: string;
  engine?: string;
  build_type?: string;
  performance?: string;
  video?: string;
  driving_characteristics?: string;
  other_characteristics?: string;
  /** empty string clears O cell + removes note */
  alternate_tunes?: string;
};

function normalizeCarKey(car: string): string {
  return car.trim().replace(/\s+/g, " ").toLowerCase();
}

function lapTimesNumericallyDistinct(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9;
}

function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  _label: string,
  maxAttempts = 5
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { code?: number })?.code;
      const msg = String((e as Error)?.message ?? e);
      const retryable =
        status === 429 ||
        status === 503 ||
        /429|rate|Quota|UNAVAILABLE|backendError/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw e;
      const delayMs = Math.min(8000, 400 * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function validateEnum(
  field: string,
  value: string,
  allowed: readonly string[]
): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid ${field}: "${value}". Allowed: ${allowed.join(", ")}`
    );
  }
}

export function validateMergedRowAgainstEnums(cfg: SheetConfig, row14: readonly string[]): void {
  const e = cfg.enums;
  validateEnum("difficulty", row14[4]!.trim(), e.difficulty);
  validateEnum("drivetrain", row14[5]!.trim(), e.drivetrain);
  validateEnum("tires", row14[6]!.trim(), e.tires);
  validateEnum("engine", row14[7]!.trim(), e.engine);
  validateEnum("build_type", row14[8]!.trim(), e.buildType);
  validateEnum("performance", row14[9]!.trim(), e.performance);
  parseLapTime(row14[1]!.trim());
}

function editPayloadPatchCount(p: EditEntryPayload): number {
  const keys = [
    "time",
    "tuner",
    "tuner_share_code",
    "driver",
    "difficulty",
    "drivetrain",
    "tires",
    "engine",
    "build_type",
    "performance",
    "video",
    "driving_characteristics",
    "other_characteristics",
    "alternate_tunes",
  ] as const;
  let n = 0;
  for (const k of keys) {
    if (p[k] !== undefined) n++;
  }
  return n;
}

export function validateEntryPayload(
  cfg: SheetConfig,
  p: NewEntryPayload
): void {
  const e = cfg.enums;
  validateEnum("difficulty", p.difficulty, e.difficulty);
  validateEnum("drivetrain", p.drivetrain, e.drivetrain);
  validateEnum("tires", p.tires, e.tires);
  validateEnum("engine", p.engine, e.engine);
  validateEnum("build_type", p.build_type, e.buildType);
  validateEnum("performance", p.performance, e.performance);
  normalizeShareCode(p.tuner_share_code);
  parseLapTime(p.time);
  if (p.alternate_tunes?.trim()) {
    parseAlternatesBlock(p.alternate_tunes);
  }
}

type DataRow = CarRowRef;

const LOOKUP_LABELS = [
  "Car",
  "Time",
  "Tuner",
  "Driver",
  "Difficulty",
  "Drivetrain",
  "Tires",
  "Engine",
  "Build type",
  "Performance",
  "Video",
  "Driving characteristics",
  "Other characteristics",
  "Alternative tune(s)",
] as const;

function displayCellData(c: sheets_v4.Schema$CellData | null | undefined): string {
  if (!c) return "-";
  const fv = c.formattedValue?.trim();
  if (fv) return fv;
  const uv = c.userEnteredValue;
  if (!uv) return "-";
  if (uv.stringValue != null && uv.stringValue.trim()) return uv.stringValue.trim();
  if (uv.numberValue != null) return String(uv.numberValue);
  if (uv.boolValue != null) return String(uv.boolValue);
  if (uv.formulaValue != null && uv.formulaValue.trim()) return uv.formulaValue.trim();
  return "-";
}

export class SheetsEntryService {
  /** Per tab: difficulty label (lowercase) → cell format from sheet rules. */
  private readonly difficultyFormatByTab = new Map<string, DifficultyFormatMap>();

  constructor(
    private readonly auth: JWT,
    private readonly spreadsheetId: string,
    private readonly sheetConfig: SheetConfig
  ) {}

  private sheets() {
    return google.sheets({ version: "v4", auth: this.auth });
  }

  private async getSheetMetaByTitle(tabTitle: string): Promise<{
    sheetId: number;
    merges: sheets_v4.Schema$GridRange[];
  }> {
    const res = await withBackoff(
      () =>
        this.sheets().spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: "sheets.properties,sheets.merges",
        }),
      "spreadsheets.get.meta"
    );
    const found = res.data.sheets?.find(
      (s) => s.properties?.title === tabTitle
    );
    const id = found?.properties?.sheetId;
    if (id == null) {
      throw new Error(`Sheet tab not found: "${tabTitle}"`);
    }
    return { sheetId: id, merges: found?.merges ?? [] };
  }

  private async getSheetIdByTitle(tabTitle: string): Promise<number> {
    const { sheetId } = await this.getSheetMetaByTitle(tabTitle);
    return sheetId;
  }

  private async readColumnAValues(
    tabTitle: string,
    tierScanFrom = 1,
    maxRows = 500
  ): Promise<string[][]> {
    const range = `${a1EscapeSheetTitle(tabTitle)}!A${tierScanFrom}:A${tierScanFrom + maxRows - 1}`;
    const res = await withBackoff(
      () =>
        this.sheets().spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range,
          majorDimension: "COLUMNS",
        }),
      "values.get.columnA"
    );
    const col = res.data.values?.[0] ?? [];
    return col.map((cell) => [cell == null ? "" : String(cell)]);
  }

  private async readTierBlocks(tabTitle: string): Promise<TierBlock[]> {
    const { merges } = await this.getSheetMetaByTitle(tabTitle);
    const columnAValues = await this.readColumnAValues(tabTitle);
    const fromMerges = tierBlocksFromColumnAMerges(merges, columnAValues);
    if (fromMerges.length > 0) return fromMerges;
    return tierBlocksFromColumnALabels(columnAValues);
  }

  private tabForClass(classKey: string): string {
    const k = classKey.trim().toUpperCase();
    const tab = this.sheetConfig.classToSheetTab[k];
    if (!tab) {
      const ok = Object.keys(this.sheetConfig.classToSheetTab).join(", ");
      throw new Error(`Unknown class "${classKey}". Use one of: ${ok}`);
    }
    return tab;
  }

  private dataStartRowForTab(_tabTitle: string): number {
    return this.sheetConfig.defaultDataStartRow;
  }

  /**
   * Loads difficulty → format from the spreadsheet (validation list + conditional rules).
   * Cached per tab for the lifetime of this service instance.
   */
  private async getDifficultyFormatMap(
    tabTitle: string,
    sheetId: number
  ): Promise<DifficultyFormatMap> {
    const cacheKey = `${this.spreadsheetId}::${tabTitle}`;
    const cached = this.difficultyFormatByTab.get(cacheKey);
    if (cached) return cached;

    const map: DifficultyFormatMap = new Map();
    const dataStartRow = this.dataStartRowForTab(tabTitle);
    const anchorRange = `${escapeSheetTitle(tabTitle)}!F${dataStartRow}`;

    const anchorRes = await withBackoff(
      () =>
        this.sheets().spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          ranges: [anchorRange],
          includeGridData: true,
          fields:
            "sheets.properties,sheets.conditionalFormats,sheets.data.rowData.values.dataValidation",
        }),
      "spreadsheets.get.difficultyRules"
    );

    const sheet = anchorRes.data.sheets?.[0];
    mergeDifficultyFormatsFromConditionalRules(
      map,
      sheet?.conditionalFormats,
      sheetId
    );

    const validation =
      sheet?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
    const validationType = validation?.condition?.type;
    const rangeFormula = validation?.condition?.values?.[0]?.userEnteredValue;

    if (validationType === "ONE_OF_RANGE" && rangeFormula) {
      const parsed = parseOneOfRangeReference(rangeFormula);
      if (parsed) {
        const listRange = validationListRangeA1(parsed, tabTitle);
        const listRes = await withBackoff(
          () =>
            this.sheets().spreadsheets.get({
              spreadsheetId: this.spreadsheetId,
              ranges: [listRange],
              includeGridData: true,
              fields: "sheets.data.rowData.values.effectiveFormat,sheets.data.rowData.values.userEnteredFormat,sheets.data.rowData.values.formattedValue,sheets.data.rowData.values.userEnteredValue",
            }),
          "spreadsheets.get.difficultyList"
        );
        mergeDifficultyFormatsFromGridRows(
          map,
          listRes.data.sheets?.[0]?.data?.[0]?.rowData
        );
      }
    }

    this.difficultyFormatByTab.set(cacheKey, map);
    return map;
  }

  /** Fallback: copy format from another row that already has this difficulty label. */
  private async buildDifficultyFormatCopyFromRow(
    tabTitle: string,
    sheetId: number,
    difficulty: string,
    targetRowZeroBased: number
  ): Promise<sheets_v4.Schema$Request | null> {
    const dataStartRow = this.dataStartRowForTab(tabTitle);
    const range = `${escapeSheetTitle(tabTitle)}!F${dataStartRow}:F`;
    const want = difficulty.trim().toLowerCase();
    if (!want) return null;

    const res = await withBackoff(
      () =>
        this.sheets().spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          ranges: [range],
          includeGridData: true,
          fields: "sheets.data.rowData.values",
        }),
      "spreadsheets.get.difficultyRowFallback"
    );

    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    for (let i = 0; i < rowData.length; i++) {
      const sourceRowZeroBased = dataStartRow - 1 + i;
      if (sourceRowZeroBased === targetRowZeroBased) continue;

      const cell = rowData[i]?.values?.[0];
      if (difficultyCellText(cell).toLowerCase() !== want) continue;

      return buildCopyDifficultyFormatRequest(
        sheetId,
        sourceRowZeroBased,
        targetRowZeroBased
      );
    }

    return null;
  }

  /**
   * Column F format from spreadsheet rules (dropdown source range, then conditional
   * formatting), then an existing row as fallback.
   */
  private async buildDifficultyFormatRequest(
    tabTitle: string,
    sheetId: number,
    difficulty: string,
    targetRowZeroBased: number
  ): Promise<sheets_v4.Schema$Request | null> {
    const want = difficulty.trim().toLowerCase();
    if (!want) return null;

    const map = await this.getDifficultyFormatMap(tabTitle, sheetId);
    const fromRules = map.get(want);
    if (fromRules) {
      return buildApplyDifficultyFormatRequest(
        sheetId,
        targetRowZeroBased,
        fromRules
      );
    }

    return this.buildDifficultyFormatCopyFromRow(
      tabTitle,
      sheetId,
      difficulty,
      targetRowZeroBased
    );
  }

  private async readDataRows(
    tabTitle: string,
    dataStartRow: number
  ): Promise<DataRow[]> {
    const range = `${a1EscapeSheetTitle(tabTitle)}!B${dataStartRow}:C`;
    const res = await withBackoff(
      () =>
        this.sheets().spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range,
          majorDimension: "ROWS",
        }),
      "values.get"
    );
    const rows = res.data.values ?? [];
    const out: DataRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const carCell = row[0];
      const timeCell = row[1];
      const car =
        typeof carCell === "string"
          ? carCell
          : carCell != null
            ? String(carCell)
            : "";
      const timeStr =
        typeof timeCell === "string"
          ? timeCell
          : timeCell != null
            ? String(timeCell)
            : "";
      const carTrim = car.trim();
      if (!carTrim && !timeStr.trim()) continue;
      if (!carTrim || !timeStr.trim()) continue;
      const timeNum = parseLapTime(timeStr);
      out.push({ offset: i, car: carTrim, timeNum });
    }
    return out;
  }

  private async locateCarBoRow(
    tabTitle: string,
    dataStartRow: number,
    carQuery: string
  ): Promise<{
    rowIndex: number;
    padded: string[];
    physical1Based: number;
  } | null> {
    const key = normalizeCarKey(carQuery);
    const range = `${a1EscapeSheetTitle(tabTitle)}!B${dataStartRow}:O`;
    const res = await withBackoff(
      () =>
        this.sheets().spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range,
          majorDimension: "ROWS",
        }),
      "values.get.locateBo"
    );
    const rows = res.data.values ?? [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const carCell = row[0];
      const carStr =
        typeof carCell === "string"
          ? carCell
          : carCell != null
            ? String(carCell)
            : "";
      if (!normalizeCarKey(carStr)) continue;
      if (normalizeCarKey(carStr) === key) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex < 0) return null;

    const matched = rows[rowIndex] ?? [];
    const padded = matched.map((v) =>
      v == null ? "" : typeof v === "string" ? v : String(v)
    );
    while (padded.length < 14) padded.push("");

    return {
      rowIndex,
      padded,
      physical1Based: dataStartRow + rowIndex,
    };
  }

  private async persistRowCells(params: {
    tabTitle: string;
    sheetId: number;
    physical1Based: number;
    rowStrings: string[];
    difficulty: string;
    tunerNote: string;
    /** When set (including empty string), O column note is written; omit to leave note unchanged */
    alternateNoteWrite?: string;
  }): Promise<void> {
    const {
      tabTitle,
      sheetId,
      physical1Based,
      rowStrings,
      difficulty,
      tunerNote,
      alternateNoteWrite,
    } = params;

    const r0 = physical1Based - 1;
    const dCol = 3;
    const oCol = 14;

    const range = `${a1EscapeSheetTitle(tabTitle)}!B${physical1Based}:O${physical1Based}`;

    await withBackoff(
      () =>
        this.sheets().spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowStrings] },
        }),
      "values.update.persist"
    );

    const noteRequests: sheets_v4.Schema$Request[] = [
      {
        updateCells: {
          range: {
            sheetId,
            startRowIndex: r0,
            endRowIndex: r0 + 1,
            startColumnIndex: dCol,
            endColumnIndex: dCol + 1,
          },
          rows: [{ values: [{ note: tunerNote }] }],
          fields: "note",
        },
      },
    ];

    if (alternateNoteWrite !== undefined) {
      noteRequests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: r0,
            endRowIndex: r0 + 1,
            startColumnIndex: oCol,
            endColumnIndex: oCol + 1,
          },
          rows: [{ values: [{ note: alternateNoteWrite }] }],
          fields: "note",
        },
      });
    }

    const formatRequests: sheets_v4.Schema$Request[] = [...noteRequests];
    const difficultyFormat = await this.buildDifficultyFormatRequest(
      tabTitle,
      sheetId,
      difficulty,
      r0
    );
    if (difficultyFormat) formatRequests.unshift(difficultyFormat);

    if (formatRequests.length === 0) return;

    await withBackoff(
      () =>
        this.sheets().spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: formatRequests },
        }),
      "batchUpdate.persistFormatNotes"
    );
  }

  /**
   * Find row by car name (same normalization as duplicate detection) and format B–O plus notes on D & O.
   */
  async lookupCarFormatted(carClassKey: string, carQuery: string): Promise<string> {
    const tabTitle = this.tabForClass(carClassKey);
    const dataStartRow = this.dataStartRowForTab(tabTitle);

    const located = await this.locateCarBoRow(tabTitle, dataStartRow, carQuery);
    if (!located) {
      throw new Error(
        `No car matching "${carQuery.trim()}" was found in **${tabTitle}**.`
      );
    }

    const { padded, physical1Based } = located;

    const a1Row = `${a1EscapeSheetTitle(tabTitle)}!B${physical1Based}:O${physical1Based}`;

    const gridRes = await withBackoff(
      () =>
        this.sheets().spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          ranges: [a1Row],
          includeGridData: true,
        }),
      "spreadsheets.get.lookupGrid"
    );

    const gridSheet = gridRes.data.sheets?.[0];
    const gridData = gridSheet?.data?.[0];
    const rowCells = gridData?.rowData?.[0]?.values;

    const lines: string[] = [];
    lines.push(`**${tabTitle}** · row **${physical1Based}**`);
    lines.push("");

    for (let i = 0; i < LOOKUP_LABELS.length; i++) {
      const label = LOOKUP_LABELS[i]!;
      let text: string;
      let note: string | undefined;
      const cellData = rowCells?.[i];
      if (cellData && typeof cellData === "object") {
        text = displayCellData(cellData);
        note =
          typeof cellData.note === "string" ? cellData.note.trim() : undefined;
      } else {
        const pv = padded[i]?.trim();
        text = pv ? pv : "-";
      }

      lines.push(`**${label}:** ${text}`);
      if (note && label === "Tuner") {
        lines.push(lookupTunerShareLine(note));
      } else if (note && label === "Alternative tune(s)") {
        for (const ln of lookupAlternateShareLines(note)) {
          lines.push(ln);
        }
      }
      lines.push("");
    }

    let out = lines.join("\n").trim();
    const max = 1900;
    if (out.length > max) {
      out = `${out.slice(0, max - 20)}\n… _(truncated)_`;
    }
    return out;
  }

  /**
   * Merge optional fields into an existing row. If `time` changes, row is deleted/reinserted sorted.
   */
  async editEntry(p: EditEntryPayload): Promise<string> {
    if (editPayloadPatchCount(p) === 0) {
      throw new Error(
        "Provide at least one field to change (e.g. `time`, `tuner`, `video`, …)."
      );
    }

    const tabTitle = this.tabForClass(p.car_class);
    const dataStartRow = this.dataStartRowForTab(tabTitle);
    const located = await this.locateCarBoRow(tabTitle, dataStartRow, p.car);
    if (!located) {
      throw new Error(
        `No car matching "${p.car.trim()}" was found in **${tabTitle}**.`
      );
    }

    const { padded: origPadded, physical1Based: originalPhysical } =
      located;
    const merged = [...origPadded];
    while (merged.length < 14) merged.push("");

    const a1Row = `${a1EscapeSheetTitle(tabTitle)}!B${originalPhysical}:O${originalPhysical}`;
    const gridRes = await withBackoff(
      () =>
        this.sheets().spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          ranges: [a1Row],
          includeGridData: true,
        }),
      "spreadsheets.get.editGrid"
    );
    const rowCells = gridRes.data.sheets?.[0]?.data?.[0]?.rowData?.[0]
      ?.values as sheets_v4.Schema$CellData[] | undefined;

    let tunerNoteFromGrid = "";
    if (
      rowCells?.[2] &&
      typeof (rowCells[2] as sheets_v4.Schema$CellData).note === "string"
    ) {
      tunerNoteFromGrid = (
        rowCells[2] as sheets_v4.Schema$CellData
      ).note!.trim();
    }

    let altNoteFromGrid = "";
    if (
      rowCells?.[13] &&
      typeof (rowCells[13] as sheets_v4.Schema$CellData).note === "string"
    ) {
      altNoteFromGrid = (
        rowCells[13] as sheets_v4.Schema$CellData
      ).note!.trim();
    }

    if (p.time !== undefined) merged[1] = formatTimeForSheet(p.time);
    if (p.tuner !== undefined) merged[2] = p.tuner.trim();
    if (p.driver !== undefined) merged[3] = p.driver.trim();
    if (p.difficulty !== undefined) merged[4] = p.difficulty.trim();
    if (p.drivetrain !== undefined) merged[5] = p.drivetrain.trim();
    if (p.tires !== undefined) merged[6] = p.tires.trim();
    if (p.engine !== undefined) merged[7] = p.engine.trim();
    if (p.build_type !== undefined) merged[8] = p.build_type.trim();
    if (p.performance !== undefined) merged[9] = p.performance.trim();
    merged[10] = preserveVideoForSheet(rowCells?.[10], merged[10] ?? "", p.video);
    if (p.driving_characteristics !== undefined) {
      merged[11] =
        p.driving_characteristics.trim() === ""
          ? "-"
          : p.driving_characteristics.trim();
    }
    if (p.other_characteristics !== undefined) {
      merged[12] =
        p.other_characteristics.trim() === ""
          ? "-"
          : p.other_characteristics.trim();
    }

    let alternateNoteWrite: string | undefined;
    const alternateTunesTouched = p.alternate_tunes !== undefined;
    if (alternateTunesTouched) {
      const block = (p.alternate_tunes ?? "").trim();
      if (!block || block === "-") {
        merged[13] = "-";
        alternateNoteWrite = "";
      } else {
        const alts = parseAlternatesBlock(p.alternate_tunes!);
        merged[13] = alternatesCellText(alts);
        alternateNoteWrite = alternatesNote(alts);
      }
    }

    let shareInputForBuild: string;
    if (p.tuner_share_code !== undefined) {
      shareInputForBuild = p.tuner_share_code.trim();
      normalizeShareCode(shareInputForBuild);
    } else {
      const extracted =
        tunerNoteFromGrid !== ""
          ? extractTunerShareCodeDigitsFromNote(tunerNoteFromGrid)
          : null;
      if (!extracted) {
        throw new Error(
          "Cannot derive tuner share code from sheet cell note. Provide `tuner_share_code`, or restore a note on the Tuner column (D)."
        );
      }
      shareInputForBuild = extracted;
    }

    validateMergedRowAgainstEnums(this.sheetConfig, merged);

    const oldTimeNum = parseLapTime(origPadded[1]!.trim());
    const newTimeNum = parseLapTime(merged[1]!.trim());

    const reorderNeeded =
      p.time !== undefined &&
      lapTimesNumericallyDistinct(oldTimeNum, newTimeNum);

    if (
      alternateNoteWrite === undefined &&
      reorderNeeded &&
      altNoteFromGrid.trim()
    ) {
      alternateNoteWrite = altNoteFromGrid;
    }

    const rowStrings = merged.slice(0, 14).map((c) => c.trim());
    const tunerNote = buildTunerNote(rowStrings[2]!, shareInputForBuild);
    const sheetId = await this.getSheetIdByTitle(tabTitle);

    let targetPhysical = originalPhysical;

    if (reorderNeeded) {
      const tierBlocksBefore = await this.readTierBlocks(tabTitle);
      const origTier =
        tierBlockAtRow(tierBlocksBefore, originalPhysical) ??
        resolveTierForLapTime(tierBlocksBefore, oldTimeNum);

      await withBackoff(
        () =>
          this.sheets().spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: buildTierRowDeleteRequests(
                sheetId,
                origTier,
                originalPhysical
              ),
            },
          }),
        "batchUpdate.edit-delete"
      );

      const tierBlocks = await this.readTierBlocks(tabTitle);
      const targetTier = resolveTierForLapTime(tierBlocks, newTimeNum);
      const rowsRest = await this.readDataRows(tabTitle, dataStartRow);
      const tierCars = carRowsInTierBlock(rowsRest, targetTier, dataStartRow);
      targetPhysical = resolveSortedInsertPhysical1Based(
        targetTier,
        dataStartRow,
        tierCars,
        newTimeNum
      );

      await withBackoff(
        () =>
          this.sheets().spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: buildTierRowInsertRequests(
                sheetId,
                targetTier,
                targetPhysical,
                dataStartRow
              ),
            },
          }),
        "batchUpdate.edit-insert"
      );
    }

    await this.persistRowCells({
      tabTitle,
      sheetId,
      physical1Based: targetPhysical,
      rowStrings,
      difficulty: rowStrings[4]!,
      tunerNote,
      alternateNoteWrite,
    });

    if (reorderNeeded) {
      return (
        `Updated **${rowStrings[0]}** (${rowStrings[1]}) — ` +
        `re-sorted into **${tabTitle}** at row **${targetPhysical}**.`
      );
    }
    return (
      `Updated **${tabTitle}** row **${targetPhysical}** — **${rowStrings[0]}**.`
    );
  }

  /**
   * Insert sorted row into B:O + notes D/O; column A tier merge is expanded/rebuilt.
   */
  async addOrUpdateRow(p: NewEntryPayload): Promise<string> {
    const tabTitle = this.tabForClass(p.car_class);
    const dataStartRow = this.dataStartRowForTab(tabTitle);

    validateEntryPayload(this.sheetConfig, p);

    const newTimeNum = parseLapTime(p.time);
    const newCarKey = normalizeCarKey(p.car);
    normalizeShareCode(p.tuner_share_code);

    let rows = await this.readDataRows(tabTitle, dataStartRow);
    const dupIdx = rows.findIndex((r) => normalizeCarKey(r.car) === newCarKey);

    const sheetId = await this.getSheetIdByTitle(tabTitle);

    if (dupIdx >= 0) {
      const existing = rows[dupIdx]!;
      if (existing.timeNum <= newTimeNum) {
        return (
          `This car is already listed with a faster or equal time ` +
          `(${formatLapTimeSeconds(existing.timeNum)}). No changes made.`
        );
      }
      const dupPhysical1Based = dataStartRow + existing.offset;
      const tierBlocksBefore = await this.readTierBlocks(tabTitle);
      const dupTier =
        tierBlockAtRow(tierBlocksBefore, dupPhysical1Based) ??
        resolveTierForLapTime(tierBlocksBefore, existing.timeNum);

      await withBackoff(
        () =>
          this.sheets().spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: buildTierRowDeleteRequests(
                sheetId,
                dupTier,
                dupPhysical1Based
              ),
            },
          }),
        "batchUpdate.delete"
      );
      rows = await this.readDataRows(tabTitle, dataStartRow);
    }

    const tierBlocks = await this.readTierBlocks(tabTitle);
    const targetTier = resolveTierForLapTime(tierBlocks, newTimeNum);
    const tierCars = carRowsInTierBlock(rows, targetTier, dataStartRow);
    const insertPhysical1Based = resolveSortedInsertPhysical1Based(
      targetTier,
      dataStartRow,
      tierCars,
      newTimeNum
    );

    await withBackoff(
      () =>
        this.sheets().spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: buildTierRowInsertRequests(
              sheetId,
              targetTier,
              insertPhysical1Based,
              dataStartRow
            ),
          },
        }),
      "batchUpdate.insert"
    );

    const m = p.driving_characteristics?.trim()
      ? p.driving_characteristics.trim()
      : "-";
    const n = p.other_characteristics?.trim()
      ? p.other_characteristics.trim()
      : "-";

    let oText = "-";
    let oNote = "";
    if (p.alternate_tunes?.trim()) {
      const alts = parseAlternatesBlock(p.alternate_tunes);
      oText = alternatesCellText(alts);
      oNote = alternatesNote(alts);
    }

    const rowStrings: string[] = [
      p.car.trim(),
      formatTimeForSheet(p.time),
      p.tuner.trim(),
      p.driver.trim(),
      p.difficulty,
      p.drivetrain,
      p.tires,
      p.engine,
      p.build_type,
      p.performance,
      formatVideoForSheet(p.video),
      m,
      n,
      oText,
    ];

    const tunerNote = buildTunerNote(p.tuner, p.tuner_share_code);

    await this.persistRowCells({
      tabTitle,
      sheetId,
      physical1Based: insertPhysical1Based,
      rowStrings,
      difficulty: p.difficulty,
      tunerNote,
      alternateNoteWrite: oNote.length > 0 ? oNote : undefined,
    });

    return (
      `Added **${p.car.trim()}** (${formatTimeForSheet(p.time)}) ` +
      `to **${tabTitle}** at row ${insertPhysical1Based}.`
    );
  }
}
