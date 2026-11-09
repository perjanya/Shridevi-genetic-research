import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { Problem } from "../lib/db";

type Cell = string | number | null;
type Sheet = { rows: Map<number, Map<string, Cell>>; date1904: boolean };

function scan(source: string, handlers: {
  open?: (tag: SaxesTagNS) => void; close?: (tag: SaxesTagNS) => void; text?: (value: string) => void;
}) {
  const parser = new SaxesParser({ xmlns: true });
  if (handlers.open) parser.on("opentag", handlers.open);
  if (handlers.close) parser.on("closetag", handlers.close);
  if (handlers.text) { parser.on("text", handlers.text); parser.on("cdata", handlers.text); }
  parser.on("doctype", () => { throw new Problem("Workbook XML must not contain a document type."); });
  parser.write(source).close();
}

function attribute(tag: SaxesTagNS, name: string) {
  return Object.values(tag.attributes).find(attr => attr.local === name)?.value ?? "";
}

export async function readSheet(path: string, name: string): Promise<Sheet> {
  if (!path.toLowerCase().endsWith(".xlsx") || (await stat(path)).size > 12 * 1024 * 1024) throw new Problem("Choose a trusted XLSX workbook under 12 MB.");
  const zip = await JSZip.loadAsync(await readFile(path));
  async function part(key: string, required = true) {
    const entry = zip.file(key);
    if (!entry) {
      if (!required) return "";
      throw new Problem("Workbook is missing " + key + ".");
    }
    const result = await entry.async("string");
    if (result.length > 20_000_000) throw new Problem("A worksheet is too large.");
    return result;
  }
  let sheetRel = "";
  let date1904 = false;
  scan(await part("xl/workbook.xml"), { open(tag) {
    if (tag.local === "sheet" && attribute(tag, "name") === name) sheetRel = attribute(tag, "id");
    if (tag.local === "workbookPr") date1904 = ["1", "true"].includes(attribute(tag, "date1904"));
  } });
  if (!sheetRel) throw new Problem("The workbook needs a " + name + " worksheet.");
  let sheetPath = "";
  let stringsPath = "";
  scan(await part("xl/_rels/workbook.xml.rels"), { open(tag) {
    if (tag.local !== "Relationship" || attribute(tag, "TargetMode") === "External") return;
    const target = attribute(tag, "Target");
    const localPath = target.startsWith("/") ? posix.normalize(target).slice(1) : posix.join("xl", target);
    if (attribute(tag, "Id") === sheetRel) sheetPath = localPath;
    if (attribute(tag, "Type").endsWith("/sharedStrings")) stringsPath = localPath;
  } });
  if (!sheetPath.startsWith("xl/")) throw new Problem("Workbook worksheet relationship is unavailable.");
  const shared: string[] = [];
  if (stringsPath.startsWith("xl/")) {
    let text = "";
    let reading = false;
    scan(await part(stringsPath, false), {
      open(tag) { if (tag.local === "si") text = ""; if (tag.local === "t") reading = true; },
      text(value) { if (reading) text += value; },
      close(tag) { if (tag.local === "t") reading = false; if (tag.local === "si") shared.push(text); },
    });
  }
  const rows: Sheet["rows"] = new Map();
  let current: { address: string; type: string; raw: string } | undefined;
  let reading = false;
  scan(await part(sheetPath), {
    open(tag) {
      if (tag.local === "c") current = { address: attribute(tag, "r"), type: attribute(tag, "t"), raw: "" };
      if (current && (tag.local === "t" || tag.local === "v")) reading = true;
    },
    text(value) { if (current && reading) current.raw += value; },
    close(tag) {
      if (tag.local === "t" || tag.local === "v") reading = false;
      if (tag.local !== "c" || !current) return;
      const ref = /^([A-Z]+)(\d+)$/.exec(current.address);
      if (ref && current.raw !== "") {
        const value = current.type === "s" ? shared[Number(current.raw)] :
          ["", "n"].includes(current.type) ? Number(current.raw) : current.raw;
        if (value === undefined) throw new Problem("Workbook shared string is missing.");
        const row = Number(ref[2]);
        if (!rows.has(row)) rows.set(row, new Map());
        rows.get(row)!.set(ref[1], value);
      }
      current = undefined;
    },
  });
  return { rows, date1904 };
}
