import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionActor, sessionCookie } from "./accounts";
import { postgres, Problem } from "./db";

export async function currentActor() {
  const token = (await cookies()).get(sessionCookie)?.value;
  return token ? sessionActor(postgres(), token) : null;
}
export async function requireActor() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in");
  return actor;
}
export async function verifyOrigin() {
  const allowed = process.env.APP_ORIGIN;
  const origin = (await headers()).get("origin");
  if (!allowed || !origin || new URL(allowed).origin !== origin) throw new Problem("The request origin is not authorized.", 403);
}
