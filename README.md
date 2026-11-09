# Shridevi Genetics Research Dashboard

A private Next.js and PostgreSQL workspace for study intake, institutional evidence, aggregate delivery, programme reviews and stakeholder feedback. PostgreSQL holds the operational data and private, versioned attachments.

## Local setup

Install Node.js 24 and provide a PostgreSQL database. On a Windows shell with PowerShell execution restrictions, use `npm.cmd` in place of `npm`.

1. Run `npm ci`. Copy `.env.example` to `.env.local`. Set `DATABASE_URL` to the database connection string and `APP_ORIGIN` to the exact browser origin, such as `http://localhost:3000`.
2. Run `npm run db:migrate` against the new database. Run `npm run db:admin` in a terminal and enter the first administrator's email, name and hidden password. There is no public registration.
3. Run `npm run dev` and sign in. In **Settings**, set the programme start date, cycle name, reporting alignment, authorized departments, targets and approval roles.
4. Import the internal workbook from its local path. Import applies to the database in `.env.local`.

   ```powershell
   npm run db:import -- "./Shridevi_Genetics_Research_Dashboard.xlsx"
   ```

   The importer reads the **Dashboard** tab and the headers on row 19. It retains the original IDs, planning waves, proposed affiliations, methods, design and outcome, feasibility, next action and estimates converted from lakh to INR. It imports concepts without approvals or assigned access. Existing IDs are skipped, including manually updated studies. Repeating the import returns the existing count.

Use a separate database for demonstrations or test data. `npm test` uses a disposable embedded PostgreSQL instance. It reads the original workbook when available and generates a synthetic fixture in a temporary directory in public checkouts.

## Checks

```text
npm run lint
npm test
npm run build
npm run test:e2e
```

The browser test runs the production build against a disposable native PostgreSQL cluster. Run it under a regular OS account. It defaults to Microsoft Edge and accepts `BROWSER_EXECUTABLE` for a Chromium-compatible executable. Test services bind to loopback. On Windows, the Next.js production build may need to run outside filesystem sandboxing so its compiler can resolve the workspace path.

## Private deployment on Vercel from public GitHub source

1. Push the application source and lockfile to your public repository. The supplied workbook, proposal, local brief, private exports and real environment files are excluded by `.gitignore`. Review staged files before the first push, including any manually copied data.
2. Provision a Shridevi-approved hosted PostgreSQL database. Use encrypted database transport with certificate validation and a pooled runtime URL when the provider supplies one. Set `DATABASE_URL` and the exact HTTPS `APP_ORIGIN` in the Vercel **Production** environment. Select Node.js 24 and let Vercel detect Next.js. Apply migrations from a controlled terminal using the migration connection, then bootstrap the administrator there.
3. Import the workbook using an authorized database connection and keep the workbook out of the repo and Vercel build context. Set up the department and account directory and validate the institution's milestone authority and exception policy before using real records.
4. Configure a separate database and origin for any preview containing test data. Keep production secrets out of Preview. Use Vercel deployment protection where available for a second access layer. The application requires a valid staff account on all operational screens and routes.
5. Set optional `DOCUMENT_LINK_HOSTS` to a comma-separated list of approved HTTPS hostnames for institutional storage links. The host must enforce its own document access. Uploads accept PDF or UTF-8 text up to 3 MB. Larger files can use approved institutional storage links. Document downloads are authorized by study and served with private caching controls.

Vercel setup references [Import a Git repository](https://vercel.com/docs/git) and [Environment variables](https://vercel.com/docs/environment-variables).

## Operations and backup

- Back up PostgreSQL with the provider's encrypted backups and point-in-time recovery or a protected `pg_dump --format=custom` from a controlled terminal. The dump includes versioned document bytes and sensitive operational and account records. Store it in approved private storage. Test `pg_restore` into an isolated database and verify studies, history, frozen reports and downloads.
- Use a migration owner separate from the runtime database role for production. Grant the runtime role only the table and sequence privileges it requires. In particular, grant `SELECT, INSERT` on `events` and `documents`. Keep DDL and `TRUNCATE` privileges with the migration owner. Restrict access to feedback redemption tables and database logs.
- Add a newly authorized account in **Settings** and deliver its initial password through an approved private channel. Revoke access there when staff depart. Institutional SSO, MFA and password recovery require the institute's identity provider and are not wired into this local-password build.
- Keep participant details, clinical records, signed participant consent forms, individual specimen identifiers and genomic results in separately approved systems. Record only project-level evidence references and aggregate counts here. Configure hosting region, backups, retention, incident response and any SSO with Shridevi before use.
- For a later cycle, set a new active cycle name and start date. New concepts use the active cycle. Existing study cycle labels and frozen review targets remain available. Select a cycle in reports to view that portfolio.
- If running migrations on a hosted database, ensure the migration role can create tables, sequences, functions and triggers. If connection pooling runs in statement mode, use a session or transaction-capable endpoint for application transactions.

[Role matrix](docs/role-matrix.md) · [Coordinator guide](docs/coordinator-guide.md) · [Reporting data dictionary](docs/reporting-data-dictionary.md)

Governance reference [ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants](https://ethics.ncdirindia.org/asset/pdf/ICMR_National_Ethical_Guidelines.pdf).
