import type { SheetConfig } from "./types.js";

function unionStrings(arrays: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const arr of arrays) {
    for (const v of arr) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

/** Union enums/classes for Discord slash choices across multiple tracks on one guild. */
export function unionSheetConfigs(configs: readonly SheetConfig[]): SheetConfig {
  if (configs.length === 0) {
    throw new Error("unionSheetConfigs: no configs");
  }
  const base = configs[0]!;
  const classToSheetTab: Record<string, string> = {};
  for (const c of configs) {
    for (const [k, v] of Object.entries(c.classToSheetTab)) {
      if (!(k in classToSheetTab)) classToSheetTab[k] = v;
    }
  }
  const e = base.enums;
  return {
    defaultDataStartRow: Math.min(
      ...configs.map((c) => c.defaultDataStartRow)
    ),
    classToSheetTab,
    enums: {
      difficulty: unionStrings(configs.map((c) => c.enums.difficulty)),
      drivetrain: unionStrings(configs.map((c) => c.enums.drivetrain)),
      tires: unionStrings(configs.map((c) => c.enums.tires)),
      engine: unionStrings(configs.map((c) => c.enums.engine)),
      buildType: unionStrings(configs.map((c) => c.enums.buildType)),
      performance: unionStrings(configs.map((c) => c.enums.performance)),
    },
  };
}
