import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { addAccount } from "../lib/accounts";
import { postgres, Problem, shutdown } from "../lib/db";
import { migrate } from "./migrate";
import { importWorkbook } from "./import-workbook";

const db = postgres();
try {
  const [command, file] = process.argv.slice(2);
  if (command === "migrate") {
    await migrate(db);
    console.log("Migrations applied.");
  } else if (command === "import" && file) {
    console.log(await importWorkbook(db, file));
  } else if (command === "admin") {
    if (!process.stdin.isTTY) throw new Problem("Use an interactive terminal to create the first administrator.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const email = await prompt.question("Administrator email: ");
    const name = await prompt.question("Administrator name: ");
    prompt.close();
    const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const secret = createInterface({ input: process.stdin, output: silent, terminal: true });
    process.stdout.write("Password (at least 14 characters, hidden): ");
    const password = await secret.question("");
    process.stdout.write("\nConfirm password (hidden): ");
    const confirm = await secret.question("");
    secret.close();
    process.stdout.write("\n");
    if (password !== confirm) throw new Problem("Passwords differ.");
    await db.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(518218)");
      if ((await tx.query("SELECT id FROM accounts LIMIT 1")).rows.length)
        throw new Problem("Bootstrap is available only before the first account is created.");
      await addAccount(tx, { email, name, password, role: "admin", department: "" }, null);
    });
    console.log("Administrator created.");
  } else throw new Problem("Use migrate, admin, or import <workbook path>.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
} finally {
  await shutdown();
}
