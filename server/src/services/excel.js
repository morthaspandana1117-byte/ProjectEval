import ExcelJS from "exceljs";
import User from "../models/Users.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Year-of-study range supported by the User schema (currently 1–6).
const YEAR_PATH = User.schema.path("year").options;
export const MIN_YEAR = YEAR_PATH.min;
export const MAX_YEAR = YEAR_PATH.max;
const STANDARD_YEARS = [1, 2, 3, 4]; // always given a sheet, even when empty
export const UNASSIGNED_YEAR = "Unassigned Year";

const ordinal = (n) => `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n] ?? "th"}`;
export const yearSheetName = (year) => `${ordinal(year)} Year`;

/**
 * Splits rows into year-of-study groups, preserving their existing order.
 * Sheets for years 1–4 are always present; higher supported years only when they have rows.
 * Rows with a missing or invalid year go to an "Unassigned Year" group — never dropped.
 * @returns {{ name: string, rows: object[] }[]}
 */
export function groupRowsByYear(rows, getYear) {
  const byYear = new Map(STANDARD_YEARS.map((y) => [y, []]));
  const unassigned = [];
  for (const row of rows) {
    const year = getYear(row);
    if (Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
    } else {
      unassigned.push(row);
    }
  }
  const groups = [...byYear.keys()].sort((a, b) => a - b).map((y) => ({ name: yearSheetName(y), rows: byYear.get(y) }));
  if (unassigned.length) groups.push({ name: UNASSIGNED_YEAR, rows: unassigned });
  return groups;
}

export function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProjectEval";
  workbook.created = new Date();
  return workbook;
}

/** Adds a formatted sheet. Values are written as plain cells (never formulas). */
export function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.addRows(rows);

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  if (rows.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
}

export async function sendWorkbook(res, workbook, filename) {
  res.setHeader("Content-Type", XLSX_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  await workbook.xlsx.write(res);
  res.end();
}
