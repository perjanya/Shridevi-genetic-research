import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, Problem, type Database, type Queryable } from "./db";
import { editable, required, type Actor } from "./model";
import { getStudy } from "./studies";

const types = {
  pdf: "application/pdf",
  txt: "text/plain",
} as const;
const maxBytes = 3 * 1024 * 1024;
const allowedLink = z.url({ protocol: /^https$/ });

export async function attachDocument(db: Database, actor: Actor, studyId: string, slotRaw: string, file: File | null, linkRaw: string) {
  if (!editable(actor)) throw new Problem("Document editing access required.", 403);
  const slot = required.parse(slotRaw);
  const link = linkRaw.trim() ? allowedLink.parse(linkRaw.trim()) : null;
  if (link) {
    const url = new URL(link);
    const approvedHost = (process.env.DOCUMENT_LINK_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase());
    if (!approvedHost.includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443"))
      throw new Problem("Choose an approved institutional document host.");
  }
  if (Boolean(file) === Boolean(link)) throw new Problem("Provide one document or one institutional link.");
  const filename = file ? required.parse(file.name.replace(/[\\/\x00-\x1f\x7f]/g, "_")) : slot;
  let mime = "text/uri-list";
  let bytes: Buffer | null = null;
  if (file) {
    if (file.size < 1 || file.size > maxBytes) throw new Problem("Upload a PDF or UTF-8 text file up to 3 MB.");
    const ext = filename.split(".").at(-1)?.toLowerCase();
    bytes = Buffer.from(await file.arrayBuffer());
    if (ext === "pdf" && bytes.subarray(0, 5).toString() === "%PDF-") mime = types.pdf;
    else if (ext === "txt") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Problem("Text files must be UTF-8."); }
      if (bytes.includes(0)) throw new Problem("This file contains binary data.");
      mime = types.txt;
    } else throw new Problem("Upload a valid PDF or UTF-8 text file.");
  }
  return db.transaction(async tx => {
    await getStudy(tx, actor, studyId, true);
    const existing = (await tx.query<{ version: number }>("SELECT coalesce(max(version),0)::int AS version FROM documents WHERE study_id=$1 AND slot=$2", [studyId, slot])).rows[0];
    const version = existing.version + 1;
    const id = randomUUID();
    await tx.query("INSERT INTO documents(id,study_id,slot,version,filename,mime,bytes,link,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, studyId, slot, version, filename, mime, bytes, link, actor.id]);
    await audit(tx, "study", studyId, actor.id, "Document version added", { id, slot, version, filename });
    return id;
  });
}

type DocumentMetadata = { id: string; slot: string; filename: string; version: number; created_at: Date };
export async function listDocuments(db: Queryable, actor: Actor, studyId: string) {
  await getStudy(db, actor, studyId);
  return (await db.query<DocumentMetadata>("SELECT id,slot,filename,version,created_at FROM documents WHERE study_id=$1 ORDER BY slot,version DESC", [studyId])).rows;
}

export async function loadDocument(db: Database, actor: Actor, studyId: string, documentId: string) {
  return db.transaction(async tx => {
    await getStudy(tx, actor, studyId, true);
    const found = (await tx.query<DocumentMetadata & { bytes: Buffer | null; link: string | null; mime: string }>(
      "SELECT id,slot,filename,version,created_at,bytes,link,mime FROM documents WHERE study_id=$1 AND id=$2", [studyId, documentId])).rows[0];
    if (!found) throw new Problem("Document was not found.", 404);
    return { ...found, bytes: found.bytes === null ? null : Buffer.from(found.bytes) };
  });
}
