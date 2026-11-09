import { postgres, Problem } from "@/lib/db";
import { loadDocument } from "@/lib/documents";
import { studyId, uid } from "@/lib/model";
import { currentActor } from "@/lib/web-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ study: string; id: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  const { study, id } = await params;
  if (!studyId.safeParse(study).success || !uid.safeParse(id).success) return new Response("Document was not found", { status: 404 });
  try {
    const doc = await loadDocument(postgres(), actor, study, id);
    if (doc.link) return new Response(null, { status: 303, headers: { Location: doc.link, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    return new Response(new Uint8Array(doc.bytes!), { headers: {
      "Content-Type": doc.mime, "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(doc.filename).replaceAll("'", "%27"),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof Problem) return new Response(error.message, { status: error.status });
    throw error;
  }
}
