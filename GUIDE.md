# How VitalTrack Is Built: A Beginner's Guide

This guide explains VitalTrack from the ground up: **what** each part does, **why** it's needed, and **why it is built the way it is**. Read it top to bottom once, then use it as a reference while reading the code.

---

## Part 0: What are we building?

Picture a person who gets blood tests every few months, sometimes from different labs. Each lab sends a PDF. Comparing them by hand is hard:

- Lab A writes **"Haemoglobin 14.2 gm/dL"** and Lab B writes **"Hb 138 g/L"**. That's the same test, in different units.
- Fasting glucose goes **86 → 92 → 97**. Every value is "normal" (limit 99), but the numbers are clearly heading toward the limit.

VitalTrack does four things:

1. **Reads** the PDF and pulls out every test result (**extraction**, using an LLM).
2. **Removes personal details** (name, phone, ID numbers) before anything goes to the LLM (**PII redaction**).
3. **Converts** every result to one standard name and unit (**normalization**).
4. **Watches the trend** over time and warns when a value is moving toward abnormal (**trend analysis**).

It also **refuses to silently trust** results it isn't sure about. Those go to a **review queue** where a human confirms them.

### The journey of one uploaded report

```
 1. You pick a PDF in the browser (React)
 2. Browser sends it to the API (Express)                       routes/reports.js
 3. API saves the file, creates a row in MySQL (status: queued)  db/repo.js
 4. API puts a job in the queue (Redis + BullMQ)                 queue.js
 5. API replies immediately: "got it, report #7 is queued"
        ...meanwhile, in a separate process...
 6. Worker picks up the job                                      worker.js
 7. PDF → plain text                                             services/textExtract.js
 8. Remove PII, then double-check nothing leaked                 services/redact.js
 9. Send redacted text to DeepSeek, get JSON back                services/llm.js
10. Validate the JSON shape strictly                             services/schema.js
11. Map names + convert units to canonical ones                  services/normalize.js
12. Quality checks → flag doubtful results for review            services/pipeline.js
13. Save everything in MySQL (status: done / needs_review)       db/repo.js
        ...back in the browser...
14. The page polls every 3 s, sees "needs review", shows results  client/src/components
15. Trends page draws each biomarker over time and flags drift   services/trends.js
```

Keep this list in mind. Every section below is one of these steps.

---

## Part 1: The tools, and why each one is here

| Tool | What it is (plain words) | Why VitalTrack needs it |
|---|---|---|
| **React** | A JavaScript library for building user interfaces out of reusable "components" | The upload page, results table, review form and trend charts all change as data arrives. React re-draws the screen automatically when data changes. |
| **Vite** | A dev server and build tool for frontend code | Runs React during development with instant reloads and bundles it for production. It also has a *proxy* that forwards `/api` calls to our backend. |
| **Node.js** | Lets you run JavaScript outside the browser, on a server | One language (JavaScript) for frontend and backend. Node is also good at "waiting" work (network calls, file I/O), which is most of what we do. |
| **Express** | A small framework for building HTTP APIs on Node | Gives us routing (`POST /api/reports` → this function), JSON parsing and error handling, without writing a raw HTTP server. |
| **MySQL** | A relational database: data lives in tables with columns and types | Reports and results are structured, related data (one report has many results). We need to query it ("all glucose values, oldest first"). That's exactly what SQL is for. |
| **Redis** | An in-memory data store: extremely fast, simple key/value storage | BullMQ stores its queue in Redis. It needs something fast and shared between the API process and the worker process. |
| **BullMQ** | A job-queue library built on Redis | LLM calls are slow and can fail. BullMQ lets the API hand off work and answer instantly, and it handles retries, concurrency limits and rate limits for us. |
| **DeepSeek API** | A large language model you call over HTTP | Lab reports have no standard layout. Writing rules for every lab's format is impossible; an LLM can read "any" layout and return structured JSON. It's also cheap and OpenAI-compatible. |
| **Zod** | A library that checks data against a schema (an expected shape) | LLM output is just text and can be wrong in shape. Zod rejects anything that doesn't exactly match what we expect. |
| **multer** | Express middleware that handles file uploads | Browsers send files as `multipart/form-data`, which Express can't read by itself. multer saves the file to disk and enforces size/type limits. |
| **pdf-parse** | Reads the text layer out of a PDF | The LLM needs text, not a PDF file. |
| **mysql2** | The Node driver that talks to MySQL | Sends queries and supports `?` placeholders that prevent SQL injection. |
| **dotenv** | Loads settings from a `.env` file into `process.env` | Keeps secrets (API key, DB password) out of the code. |

### Why a queue at all? (The most important design decision)

Without a queue, the upload request would have to: read the PDF → call the LLM (10–40 seconds!) → save → *then* respond. Problems:

- The browser sits waiting; it might time out.
- If the LLM API returns a temporary error (rate limit, 503), the whole upload fails.
- If 20 people upload at once, we fire 20 LLM calls at once and hit rate limits.
- If the server restarts mid-way, the work is lost.

With a queue, the API just says *"I wrote it down; I'll do it"* and answers in milliseconds. A separate **worker** does the slow part. BullMQ gives us:

- **Retries with backoff** (`attempts: 3`, waits 5 s, then 10 s), so temporary errors fix themselves.
- **Concurrency** (`concurrency: 2`): at most 2 reports at a time.
- **Rate limiting** (`limiter: 20/minute`): protects the API quota and your bill.
- **Durability**: jobs live in Redis, so a crash doesn't lose them.

This is what "async pipeline" means on the resume.

### Why MySQL *and* Redis? Aren't they both databases?

They do different jobs. **MySQL** is the permanent record (reports, results, history for trends). It's durable and queryable. **Redis** holds short-lived *work to do* (the queue). It's fast but not where you keep medical history. Mixing them up would be like keeping your diary on sticky notes.

---

## Part 2: Building it, step by step

Each step says the **goal**, **why it's needed**, and **how it works**, with a pointer to the code.

### Step 1: Project setup

```
VitalTrack/
├── server/            Node + Express API and the worker
│   ├── src/
│   │   ├── index.js           API entry point
│   │   ├── worker.js          background worker entry point
│   │   ├── config.js          reads .env
│   │   ├── queue.js           BullMQ queue
│   │   ├── db/                schema, connection pool, all SQL
│   │   ├── routes/            HTTP endpoints
│   │   ├── services/          the actual logic (redact, llm, normalize, trends…)
│   │   └── data/biomarkers.js the biomarker catalog
│   ├── test/          unit tests
│   └── eval/          accuracy measurement
├── client/            React app
└── samples/           fake reports + correct answers for testing
```

**Why this layout:** *routes* only deal with HTTP (read request, send response). *services* contain the logic and know nothing about HTTP or databases. *db* contains all SQL. Because the logic is separate, the same `processText()` function is used by the worker, the tests and the evaluation script. That's called **separation of concerns**.

**`config.js`**: every setting comes from environment variables in one place. Secrets never appear in code, and `.env` is in `.gitignore` so it's never committed.

### Step 2: The database schema ([server/src/db/schema.sql](server/src/db/schema.sql))

Two tables:

- **`reports`**: one row per upload. The important column is **`status`**: `queued → processing → needs_review | done` (or `failed`). The frontend shows this so the user knows what's happening in the background.
- **`results`**: one row per biomarker found. It stores **both**:
  - what the lab printed (`raw_name`, `raw_value`, `raw_unit`), for auditing and review, **and**
  - the normalized version (`biomarker_code`, `value`, `unit`), used for comparisons and trends.

**Why store both?** If our conversion logic ever has a bug, we can re-run it from the raw values. And a reviewer can see exactly what was on the paper.

**Quality-control columns:** `confidence`, `source_text` (the line the value came from), `needs_review`, `review_reasons` (e.g. *"unit 'furlongs' cannot be converted"*), `reviewed`.

**Privacy detail:** we store `redacted_text` (PII removed), not the raw text.

`ON DELETE CASCADE` means deleting a report deletes its results automatically. `INDEX idx_results_biomarker` makes "all values of biomarker X" queries fast.

### Step 3: Connecting to MySQL ([db/pool.js](server/src/db/pool.js), [db/repo.js](server/src/db/repo.js))

- A **connection pool** keeps ~10 connections open and reuses them. Opening a connection per query is slow.
- **All SQL lives in `repo.js`.** Every query uses `?` placeholders: `pool.query('SELECT * FROM reports WHERE id = ?', [id])`. The driver escapes the value. **Never** build SQL by gluing strings together (`"... WHERE id = " + id`); that's how **SQL injection** happens.
- `saveExtraction()` uses a **transaction**: delete old results, insert new ones, update the report, then `commit`. If anything fails in the middle, `rollback` undoes everything. A report is never left half-saved.
- It first deletes existing results for that report. That makes the job **idempotent** (safe to run twice), which matters because BullMQ may retry a job.

### Step 4: The upload API ([routes/reports.js](server/src/routes/reports.js))

`POST /api/reports`:
1. **multer** saves the file to `server/uploads/` and rejects files over 10 MB or that aren't PDF/text. Validate input at the door.
2. Insert a `reports` row (status `queued`).
3. `enqueueReport(id)` adds a job to the queue.
4. Respond **`202 Accepted`**. That HTTP code literally means "received, will be processed later", which is exactly our situation (versus `201 Created` or `200 OK`).

Other endpoints: list reports, get one report with its results, `PATCH /results/:id` (human confirms/corrects a flagged result), `DELETE /results/:id` (discard a junk result), `GET /trends`, `GET /biomarkers`.

**Express 5** automatically catches errors thrown in `async` route handlers and sends them to the error handler in `index.js`. In Express 4 you had to wrap every handler in try/catch.

### Step 5: The queue and the worker ([queue.js](server/src/queue.js), [worker.js](server/src/worker.js))

**Producer** (API): `reportQueue.add('extract', { reportId })`.
**Consumer** (worker): `new Worker(QUEUE_NAME, async (job) => {...})`.

They're **separate processes** (`npm run dev` and `npm run worker`). Why? Heavy work in the worker can't slow down the API, and you can run more workers when there's more load.

Design choices worth explaining in an interview:
- **Only the report ID goes into the job**, never the text or patient data. Redis then never holds PII. The worker loads what it needs from MySQL.
- `jobId: report-${id}` prevents the same report being queued twice.
- **`UnrecoverableError`** (e.g. scanned PDF with no text) tells BullMQ "retrying won't help, stop now". Saves time and API money.
- The `failed` event marks the report `failed` with the error message only after the **last** attempt, so the UI can show what went wrong.

### Step 6: PDF → text ([services/textExtract.js](server/src/services/textExtract.js))

`pdf-parse` reads the text layer of a **digital** PDF (the kind labs email). A **scanned** PDF is just a picture of text with no text layer, so we'd get almost nothing. We detect that (under 50 characters) and fail clearly instead of sending garbage to the LLM. Adding OCR (e.g. Tesseract) is a possible extension.

### Step 7: PII redaction ([services/redact.js](server/src/services/redact.js))

**Goal:** the LLM provider must never receive the patient's identity. It only needs the numbers.

**Why it matters:** sending text to an external API means it leaves your control (logging, retention, breaches). Health data plus identity is very sensitive (HIPAA in the US, DPDP Act in India). **Data minimization** means sending only what's needed.

Three layers:

1. **Labelled fields.** Reports put PII after labels: `Patient Name:`, `UHID:`, `DOB:`, `Ref. By:`, `Mobile:`, `Address:`. A regex finds `label : value` and replaces the value: `Patient Name: [NAME]`. This catches most PII because reports are semi-structured.
2. **Patterns** for PII that appears anywhere: emails, Indian mobile numbers (`[6-9]` + 9 digits), international phones, Aadhaar (`1234 5678 9012`), PAN (`ABCDE1234F`), and honorific + capitalized words (`Mr. Arjun Mehta`).
3. **Fail closed.** `assertNoPII()` re-scans the redacted text. If anything that still looks like an email/phone/Aadhaar/PAN remains, it **throws** and the LLM is never called. When unsure, the safe choice is to *not send*. That's what "redacts PII before **every** LLM call" means: `processText()` always redacts first, and there's no code path that skips it. A test ([test/pipeline.test.js](server/test/pipeline.test.js)) proves the LLM only receives redacted text.

**Trade-off to understand:** the regexes are deliberately **strict**. A loose phone regex like "any 6+ digits" would also wipe out `Platelets 250000`, destroying the data we need. There's a test for exactly that. Redaction is always a balance between removing too little (privacy leak) and too much (lost data).

**Known limitation (be honest about it):** regex can't catch every name in free text. Production systems add NER models (e.g. Microsoft Presidio). The `knownNames` option lets you redact a name you already know, everywhere it appears.

### Step 8: Calling the LLM ([services/llm.js](server/src/services/llm.js))

DeepSeek's API is **OpenAI-compatible**: you `POST` to `/chat/completions` with a list of messages. We use plain `fetch()`, no SDK needed.

The **system prompt** is the instruction manual for the model. Key choices:
- **Exact JSON shape spelled out**, field by field.
- **"Copy values and units exactly. Do NOT convert units."** Unit conversion is math; LLMs are unreliable at math. We let the LLM do what it's good at (reading messy layouts) and do the math ourselves in code, where it's deterministic and testable. This is the most important prompt-design decision.
- **"Never invent a result"**, plus a `confidence` score and the `sourceText` line, so we can check it.
- **`temperature: 0`**: same input → (nearly) same output. We want consistency, not creativity.
- **`response_format: { type: 'json_object' }`**: the API guarantees syntactically valid JSON.

### Step 9: Schema validation ([services/schema.js](server/src/services/schema.js))

Valid JSON ≠ correct JSON. The model might return `"value": "13.5 g/dL"` (a string with a unit), drop `unit`, or say `"confidence": 7`. **Zod** checks the exact shape:

```js
value: number            // must be a finite number ("13.5" is converted, "high" is rejected)
confidence: 0..1
reportDate: "YYYY-MM-DD" or null
```

If validation fails, we **send the errors back to the model** ("`biomarkers.3.value: Expected number`") and let it fix its answer once. If it fails again, the job fails. **Invalid data is never stored.**

### Step 10: Normalization ([data/biomarkers.js](server/src/data/biomarkers.js), [services/normalize.js](server/src/services/normalize.js))

**The catalog** lists 45 biomarkers. For each one:
- a **canonical code** (`HGB`) and **canonical unit** (`g/dL`),
- **aliases**, all the names labs use (`haemoglobin`, `hb`, `hgb`…; `sgpt` = `alt`),
- **accepted units and conversion factors** (`g/L × 0.1 → g/dL`, `mmol/L × 18.016 → mg/dL` for glucose),
- a **default reference range** and a **plausible range** (for catching errors).

**Name normalization:** lowercase, strip punctuation, drop filler words ("serum", "s."), also try with and without parentheses, then look it up in the alias table. So `"S. Creatinine"`, `"Serum Creatinine"` and `"Creatinine"` all become `CREAT`. At startup the code **throws if two biomarkers share an alias**, so ambiguity is caught while developing, not in production.

**Unit normalization:** `unitKey()` collapses spelling variations (`µL`/`uL`, `10³`/`10^3`, `cumm`/`mm3`, `gm/dL`/`g/dL`) to one key, then looks up the conversion factor. Some conversions aren't simple multiplication: HbA1c `mmol/mol → %` uses a formula, so the catalog allows functions too. Indian reports often use **lakhs/cumm** for platelets (2.6 lakhs = 260 ×10³/µL); that's supported.

**The lab's own reference range wins** over the catalog default (converted to canonical units), because ranges differ by lab, method, age and sex.

**The golden rule: never guess.** Unknown name → `biomarker_code = NULL` + review reason. Unknown unit → `value = NULL` + review reason. Fuzzy matching ("close enough") would sometimes map a test to the *wrong* biomarker, and a wrong value that looks right is worse than a missing one.

### Step 11: Quality checks and the review queue ([services/pipeline.js](server/src/services/pipeline.js))

This is "**low-confidence review to prevent silent errors**". A **silent error** is a wrong value that gets stored and shown as if it were correct. For health data, that's the worst failure. Every result goes through these checks:

| Check | Catches |
|---|---|
| Model confidence < 0.8 | Values the model itself was unsure about |
| **Grounding:** is this exact number in the report text? | **Hallucinations**, numbers the model made up |
| Name not in catalog | Unknown or misread test names |
| Unit can't be converted | Unexpected units |
| No unit printed | Assumptions we had to make |
| Outside plausible range | Unit mix-ups (e.g. Hb "140" is g/L mislabelled as g/dL) |
| Same biomarker twice in one report | Mis-mapping |

**Why not just trust the confidence score?** LLM self-reported confidence is poorly calibrated: models are often confidently wrong. So it's one signal among several **deterministic** checks we fully control. That combination is the key idea.

Any failing check → `needs_review = true`, with human-readable reasons. Flagged results are **excluded from trends** until a person confirms, corrects or discards them in the UI (`PATCH /results/:id`). When the last flagged result is resolved, the report becomes `done`.

### Step 12: Trend analysis ([services/trends.js](server/src/services/trends.js), [routes/trends.js](server/src/routes/trends.js))

For each biomarker, take all **trusted** values in date order (all in canonical units thanks to Step 10, so Lab A and Lab B values sit on the same line).

1. **Status:** is the latest value low / normal / high vs. the range?
2. **Slope:** fit a straight line through the points with **least-squares linear regression**. Slope = change per day. Using all points (not just the last two) makes it less sensitive to one noisy value.
3. **Projection:** `latest + slope × 90 days`.
4. **Flag** `approaching_high` / `approaching_low` when the value is normal **but** moving toward a limit **and** either the projection crosses it or it's already within 10% of the range width from it.
5. Changes under 2% of the range width over 90 days count as **stable**, so tiny noise isn't flagged.

Example from the samples: fasting glucose 86 (Jan) → 5.1 mmol/L = 91.9 mg/dL (May, other lab) → 97 (Sep). Every value is normal, but the projection passes 100, so it's flagged **"Rising toward high"**.

*(This is a screening heuristic for a portfolio project, not medical advice. A real product would need clinical input.)*

### Step 13: The frontend ([client/src](client/src))

- **`api.js`**: one place for all `fetch` calls. Components never build URLs.
- **`App.jsx`**: switches between three views with `useState`. Small apps don't need a router library.
- **`Reports.jsx`**: upload input + table. Because processing is asynchronous, it **polls** `GET /reports` every 3 s while any report is queued or processing, and stops when nothing is pending. (A production upgrade would be WebSockets or Server-Sent Events, where the server pushes updates.)
- **`ReportDetail.jsx`**: trusted results table plus the **review panel**: each flagged result shows its reasons and source line, with a dropdown to pick the right test, a value box, a unit dropdown, and Confirm/Discard.
- **`Trends.jsx`**: a card per biomarker with a tiny hand-drawn SVG chart (green band = reference range, line = your values). Flagged trends are sorted to the top.
- **`vite.config.js`** proxies `/api` to `localhost:4000`, so the frontend can call `/api/...` without CORS problems in development.

### Step 14: Tests ([server/test](server/test))

`npm test` runs 21 unit tests with Node's built-in test runner. They need no database, Redis or API key:
- **redact**: PII is removed, lab values survive, platelet counts aren't mistaken for phones, leak check throws.
- **normalize**: aliases map correctly, unknown names aren't guessed, conversions are right, problems produce review reasons.
- **trends**: rising/falling/stable/abnormal cases.
- **pipeline**: uses a **fake LLM** to prove (a) the LLM only sees redacted text and (b) hallucinated values are flagged.

The fake LLM works because `processText()` takes the LLM function as a parameter (**dependency injection**). Tests swap in a fake, production uses the real one.

### Step 15: Measuring accuracy ([server/eval/evaluate.js](server/eval/evaluate.js))

You can't claim "95% accuracy" without measuring it. The eval script:
1. For each report, reads a hand-checked `*.truth.json` (the correct canonical values).
2. Runs the **real** pipeline (real DeepSeek call).
3. Compares: **correct** (within 1%), **missing**, **wrong but flagged** (the review queue caught it, good), **wrong and not flagged** (**silent error**, bad), **extra**.

```bash
cd server && npm run eval -- /path/to/folder/with/reports-and-truth-files
```

The number that matters most is **silent errors**. A system with 93% accuracy and zero silent errors is safer than one with 97% and several silent errors.

---

## Part 3: How each resume bullet maps to the code

| Resume claim | Where it lives |
|---|---|
| LLM pipeline extracting **35+ biomarkers** | `data/biomarkers.js` (45 entries), `services/llm.js`, `services/pipeline.js` |
| **Schema validation** | `services/schema.js` (Zod) + retry-with-errors in `llm.js` |
| **Low-confidence review** to prevent silent errors | quality checks in `pipeline.js`, review endpoints in `routes/reports.js`, review panel in `ReportDetail.jsx` |
| **95% accuracy across 50 reports** | **you must measure this** with `eval/evaluate.js` (see Part 5) |
| **Trend analysis** flagging drift toward abnormal | `services/trends.js` |
| **Normalizing test names and units** across labs | `services/normalize.js` |
| **Privacy-first async pipeline** | `queue.js`, `worker.js` (BullMQ), only IDs in Redis |
| **Redacts PII before every LLM call** | `services/redact.js`, called first in `processText()`, fail-closed check, test in `pipeline.test.js` |

---

## Part 4: Interview questions you should be ready for

**Why use an LLM instead of regex/templates?**
Every lab has a different layout, and new labs keep appearing. Templates break constantly. An LLM generalizes across layouts. But I don't trust it blindly: it only reads the values, my code does all conversions, and every value is validated and grounded against the source text.

**How do you know the LLM didn't hallucinate a value?**
The grounding check: the extracted number must literally appear in the report text, or the result is flagged. Plus Zod validation, plausibility ranges and confidence thresholds.

**Why not let the LLM convert units?**
LLMs are unreliable at arithmetic, and conversions must be exact and testable. A lookup table in code is deterministic and covered by unit tests.

**Why BullMQ/Redis instead of just `await`-ing in the request?**
LLM calls take 10–40 s and can fail. A queue gives instant responses, automatic retries with exponential backoff, concurrency and rate limiting, and jobs survive restarts.

**What if the worker crashes mid-job?**
BullMQ notices the job "stalled" and retries it. `saveExtraction` is a transaction and deletes old results first, so re-running is safe (idempotent).

**What PII could still slip through?**
A name in free text without a label or honorific. Mitigations: label rules, honorific pattern, known-name redaction, a fail-closed leak check. Next step: an NER model like Presidio. Also, the original PDF is still on our disk, so production would need encryption at rest and a retention policy.

**How is the 95% calculated?**
(Answer with your real methodology: number of reports, number of biomarker values, what "correct" means (within 1% after normalization), how ground truth was made.)

**Why MySQL rather than MongoDB?**
The data is relational (reports → results), I need joins and ordered queries for trends, and fixed columns with types catch bad data.

**How would you scale it?**
Run more worker processes (they share the Redis queue), store files in S3 instead of local disk, add auth and per-user data, and push status with WebSockets instead of polling.

---

## Part 5: About the numbers on your resume

"95% accuracy across 50 reports" is a specific, checkable claim, and interviewers often ask how it was measured. Make it true before you rely on it:

1. Collect real reports (your family's, friends' with permission, or public sample reports from lab websites). Aim for a mix of labs and formats.
2. For each, write the `*.truth.json` by hand (the eval script's header comment shows the format).
3. Run `npm run eval -- /path/to/folder`.
4. Put **the number you actually get** on your resume. If it's 91% over 30 reports, write that. A real number you can explain beats a round number you can't.

Also run the three included samples first (`npm run eval`) to check your setup.

---

## Part 6: Ideas to extend it

- OCR for scanned PDFs (Tesseract.js)
- Login accounts (people are tracked separately now, but anyone with the app open can see everyone)
- Encrypt uploaded files at rest; delete originals after extraction
- WebSocket/SSE status updates instead of polling
- Sex/age-specific reference ranges
- Docker images for the API and worker

---

## Part 7: Version 2: people, descriptions, dates and the new design

These changes were added after the first version. Each one says **what changed**, **where**, and **why it's built that way**.

### 7.1 Reports belong to a person

**What:** the first time you open the app it asks *"Who are these blood reports for?"*. Every upload belongs to the selected person. The Reports and Trends pages only show that person's data, and a dropdown in the top bar switches between people.

**Why:** trends only make sense for **one** body. If Mom's glucose and yours were mixed into one line, the slope would be meaningless.

**How:**
- **Database:** a new `patients` table, and `reports.patient_id` points to it. That's a **one-to-many relationship**: one person has many reports, and each report has many results. The **foreign key** (`FOREIGN KEY ... REFERENCES patients(id)`) makes MySQL refuse a report for a person who doesn't exist. `ON DELETE CASCADE` cleans up their reports if a person is deleted.
- **API** ([routes/patients.js](server/src/routes/patients.js)): `GET /api/patients`, `POST /api/patients`. Upload now sends a `patientId` form field next to the file. `GET /api/reports?patientId=3` and `GET /api/trends?patientId=3` filter with `WHERE r.patient_id = ?` in [db/repo.js](server/src/db/repo.js).
- **Frontend** ([App.jsx](client/src/App.jsx), [AddPerson.jsx](client/src/components/AddPerson.jsx)): the selected person is remembered in `localStorage`, wrapped in `try/catch` because browsers can block storage. `key={patient.id}` on the pages makes React throw away the old screen when you switch person, so the previous person's data never flashes on screen.

**Bonus privacy win:** now that we know whose report it is, the worker passes that person's name to the redactor (`knownNames` in [worker.js](server/src/worker.js)). The name is removed **wherever it appears** in the text, not only next to a "Name:" label. The worker reads the name from MySQL using the report ID, so the name still never goes into Redis. Name parts shorter than 3 letters are skipped, because redacting "Al" everywhere would also wipe ordinary words.

### 7.2 Database migrations

**What:** `npm run db:migrate` ([db/migrate.js](server/src/db/migrate.js)) replaces `db:init`.

**Why:** your database already had tables **with data**. `CREATE TABLE IF NOT EXISTS` skips existing tables, so editing `schema.sql` would never add the new columns, and deleting the database would lose your reports. A **migration** is a small numbered script that changes an *existing* database one step at a time. That's how real teams change a schema without losing data.

**How:**
1. `schema.sql` = the original tables (version 1).
2. [migrations/002_patients_and_descriptions.sql](server/src/db/migrations/002_patients_and_descriptions.sql) adds `patients`, `patient_id` and `description`.
3. A `schema_migrations` table records which files have run, so running the command twice is safe.
4. **Existing data:** reports uploaded before this change had no person, so the migration creates one called *"My reports"* and assigns them. Only then does it make `patient_id` `NOT NULL`. Order matters: you can't require a column before every row has a value.

Future schema changes go in `003_...sql`, `004_...sql`. Never edit a migration that has already run.

### 7.3 Descriptions on reports

**What:** each report row has **"+ Add description"**. Click it, type ("Annual check-up", "After starting vitamin D"), and press Enter or click away to save. Escape cancels. Click the text again to edit it.

**How:** a `description VARCHAR(500)` column, and `PATCH /api/reports/:id` in [routes/reports.js](server/src/routes/reports.js), which trims the text, limits its length and turns empty text into `NULL`. In [Reports.jsx](client/src/components/Reports.jsx) the `Description` component switches between showing the text and an input. Saving on **blur** (losing focus) is a common inline-edit pattern: no separate Save button needed. The detail page uses the description as its title when one exists.

### 7.4 Dates like "21 Dec 2026"

**What:** all dates show as `21 Dec 2026` ([format.js](client/src/format.js)). Reports are sorted by the date printed on the report (the sample date), newest first. If the report had no date, the upload date is shown and labelled "Uploaded".

**How:** `Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })` is the browser's built-in date formatter, so no library is needed.

**A classic bug, avoided:** `new Date('2026-12-21')` is read as **UTC midnight**. In time zones behind UTC that's still the 20th, so the page would show the wrong day. `parseDate()` builds the date from its parts (`new Date(2026, 11, 21)`), which uses local time.

### 7.5 Delete a report

A trash button deletes a report, its results, **and the uploaded PDF on disk**. The PDF contains personal data, so leaving it behind would break the privacy promise.

### 7.6 The new design

**Goal:** calm, friendly health-app cards (like Apple Health), with the key number large, a plain-language status, and a mini chart.

- **Design tokens** ([styles.css](client/src/styles.css)): colours, corner radius and shadow are CSS variables in `:root`. Changing `--accent` restyles the whole app.
- **Metric cards** ([Trends.jsx](client/src/components/Trends.jsx)): icon + name, the latest date, a **big value + unit**, a status in plain words ("In range", "Rising toward high", "Above range") coloured green/amber/red, the normal range, and a mini chart of the last 7 results with month labels.
- **Categories** ([categories.js](client/src/categories.js)): biomarkers are grouped by body system (blood count, sugar, lipids, kidney, liver…). Each system has its own colour, icon and chart style, so the page doesn't look monotonous. This is purely visual, so it lives in the frontend, not the backend catalog.
- **Mini charts** ([MiniCharts.jsx](client/src/components/MiniCharts.jsx)): hand-written SVG. `MiniLine` draws a line with a gradient fill, plus dashed lines at the range limits. `MiniBars` draws rounded bars on grey tracks. Both share one `scale()` function that maps values to pixels, and out-of-range points turn red. For charts this small, a charting library would add far more code than it saves.
- **Icons** ([Icon.jsx](client/src/components/Icon.jsx)): inline SVG paths with `fill="currentColor"`, so an icon takes the colour of its parent.
- **Summary and filters:** tiles show "N need attention / N in range". Chips filter by *Needs attention* or by body system. Cards needing attention are sorted first (done by the API).
- **Upload zone:** drag and drop, or click; several files can be dropped at once.
- **Mobile:** a `@media (max-width: 640px)` block stacks the layout for phones.

---

## Part 8: Version 3: blue theme, person picker and time periods

### 8.1 Light-blue theme with a red heart
**What:** the warm orange look is now light blue, and the VitalTrack logo is a red heart on a white tile with a gentle heartbeat animation.

**How:** only the **design tokens** at the top of [styles.css](client/src/styles.css) changed (`--bg`, `--accent`, `--border`, `--shadow`, plus new `--heart` tokens). Every component uses these variables, so the whole app changed colour without editing any component. That's the payoff of defining colours once.

**Why red + blue:** they sit on opposite sides of the colour wheel (complementary), so the small red heart stands out against the calm blue without clashing. A faint pink glow at the top of the background echoes the heart. The animation is switched off for people who set "reduce motion" in their OS (`prefers-reduced-motion`), an accessibility courtesy.

### 8.2 A friendlier person picker
**What:** instead of a plain dropdown, the top-right shows an avatar with initials, "Viewing" + the name, and a chevron. The menu shows each person with a coloured avatar, their number of reports, a ✓ on the current one, and an "Add a person" action at the bottom.

**How** ([PersonPicker.jsx](client/src/components/PersonPicker.jsx)):
- A native `<select>` can't show avatars or an action button, and looks different in every browser, so this is a custom dropdown: a button plus a menu shown when `open` is true.
- **Closing behaviour users expect:** a `mousedown` listener on the whole document closes the menu when you click outside it (`ref.contains(e.target)` checks whether the click was inside), and **Escape** closes it too. Both listeners are removed in the `useEffect` cleanup so they don't pile up.
- Report counts refresh every time the menu opens (`onOpen={loadPatients}`).
- Avatar colour comes from `id % colours.length`, so each person keeps the same colour.
- `aria-haspopup`, `aria-expanded`, `role="listbox"/"option"` tell screen readers what the widget is.

### 8.3 Time periods on Trends: last 3 months, last 6 months, all time
**What:** a segmented control at the top of Trends. **All time** is the default, and the exact dates covered always show under the title, e.g. 📅 *12 Jan 2026 – 21 Sep 2026*. For a period, it shows *10 Aug 2026 – 10 Nov 2026* (period start → today).

**How:**
- The frontend computes the start date (`monthsAgo(3)` → `toISODate()` in [format.js](client/src/format.js)) and calls `GET /api/trends?patientId=1&from=2026-08-10`.
- The backend ([routes/trends.js](server/src/routes/trends.js)) validates `from` and adds `AND date >= ?` to the SQL in `getTrustedSeries()` ([db/repo.js](server/src/db/repo.js)). The `(? IS NULL OR date >= ?)` trick lets the same query serve "all time" (`from = NULL`).
- **Why filter on the server, not just hide old points in the browser?** The slope, projection and "rising toward high" flag are calculated from the points. "Last 3 months" should answer *"what's the recent direction?"*, so the analysis must be recalculated on only those points. Hiding points in the UI would show recent dots with an all-time verdict.
- **Race condition handled:** if you click 3M then quickly All time, the slower first response could arrive last and overwrite the newer one. The `cancelled` flag in the `useEffect` cleanup ignores outdated responses. While loading, the old cards fade (`.is-loading`) instead of the page flashing blank.
- An empty period shows "No results in this period" with a **Show all time** button.
- `toISODate()` builds the date from local parts. `toISOString()` converts to UTC and can shift the day (same bug family as 7.4).

### 8.4 Clickable "Need attention" tiles
**What:** clicking **Need attention** shows only those biomarkers; clicking **In range & steady** shows only the healthy ones. Clicking the active tile again shows all. An active tile gets a coloured border.

**How:** the tiles are real `<button>`s (keyboard-accessible, unlike clickable `<div>`s) that set the same `filter` state the category chips use. `toggleFilter` switches back to `'all'` when the active tile is clicked again.

### 8.5 Capital letters everywhere
All UI labels now start with a capital letter. Messages that come from the backend (review reasons like *"no unit printed; assumed g/dL"*, and errors) are written lower-case in the code because they're also used in logs and tests, so the UI passes them through `sentence()` in [format.js](client/src/format.js) to capitalize the first letter at display time. That keeps a display concern in the display layer. Personal-data counts now read *"Name ×1, ID number ×1"* instead of *"1 × name"*, and confidence shows as *"AI confidence 60%"*.

---

## Part 9: Version 4: deeper blue, new logo, removing people

- **Deeper blue theme:** the tokens in [styles.css](client/src/styles.css) got richer values (`--bg`, `--accent`, `--border`, the background glows), plus a new `--brand` dark blue used for the logo tile, the "VitalTrack" wordmark and the active tab. Again, no component changed, only the variables.
- **Logo:** a 46px dark-blue gradient tile with a coral-red heart. A plain red would look muddy on navy, so `--heart` is a brighter coral red that keeps strong contrast. Only the heart beats (`.logo svg`), not the whole tile. Movement on a big block is distracting; a small beating heart is a friendly detail.
- **Removing a person:** hover a person in the picker and a trash icon appears. After a confirmation, `DELETE /api/patients/:id` ([routes/patients.js](server/src/routes/patients.js)) deletes the person; MySQL's `ON DELETE CASCADE` removes their reports and results, and the route also deletes their uploaded PDFs from disk. If nobody is left, the app automatically shows the "Add a person" screen, because the page simply renders that screen whenever there's no current person. The old "My reports" placeholder person created by migration 002 was removed this way.
  - Nested buttons aren't valid HTML, so each menu row is a `<div>` holding two sibling buttons (choose, remove).
- **Attention cards:** every card that needs attention (approaching a limit *or* out of range) gets the palest shade of the "Need attention" yellow (`#fffbf0`). The status text stays amber or red, so you still see how serious each one is.
- **Privacy note:** the report page now simply says *"🔒 Your personal identification is removed before AI processing."*

---

## Part 10: Version 5: sliding toggle and severity colours

- **Reports / Trends toggle** ([App.jsx](client/src/App.jsx), `.toggle` in [styles.css](client/src/styles.css)): the two tabs became one pill-shaped switch. The container is a 2-column grid; a single absolutely-positioned `.toggle-pill` sits behind the buttons and slides with `transform: translateX(100%)` when Trends is active. `transform` is animated by the GPU, so the slide is smooth (animating `left` would trigger layout work on every frame). The buttons sit above the pill (`z-index: 1`) and turn white when active. `role="tablist"`/`aria-selected` keep it accessible, and the slide is disabled for users who prefer reduced motion.
- **Attention card colours:** a gentle traffic-light scheme everyone already understands:
  - *Approaching a limit:* white card with an **amber strip** on the left ("keep an eye on it").
  - *Out of range:* **red strip** plus a very pale rose background ("look at this").
  - *Fine:* plain white card with a green status pill.
  Colour is never the only signal: the status pill (with a coloured dot) also says it in words, which matters for colour-blind users. The strip is an `inset box-shadow`, so it follows the card's rounded corners without extra HTML.
- **Reports list:** the small "Sample date"/"Uploaded" caption under each date was removed. The date alone is clearer.

---

## Part 11: Authentication (accounts, sign-in, private data)

### What the user sees
- Opening the app shows a **sign-in page**: *Sign in* / *Create account* (username + password), plus **Sign in with Google** when it's configured.
- After signing in: the same app, but showing **only that account's** people, reports and trends. The avatar in the top-right opens a menu with **Your profile** and **Sign out**.
- **Profile page:** change your name, see how many people/reports you have, **sign out on all devices**, and **delete the account** (type "DELETE" to confirm).
- A new account automatically gets one person named after the user, so they can upload straight away. The **first** account ever created also takes over people that existed before accounts were added, so no old data is lost.

### The ownership chain
```
users ──< patients (people) ──< reports ──< results
                ▲
     sessions ──┘ (which browser is signed in as which user)
```
Migration [003_users_and_sessions.sql](server/src/db/migrations/003_users_and_sessions.sql) adds `users`, `sessions`, and `patients.user_id`. Every row can now be traced back to one account.

### 1. Passwords: never stored, only hashed ([services/auth.js](server/src/services/auth.js))
- **bcrypt** turns a password into a one-way hash: you can check a password against it, but you can't turn it back into the password.
- It's **deliberately slow** (cost 12 ≈ 0.25 s). One login doesn't notice; an attacker who steals the database and tries billions of guesses is slowed to a crawl.
- Each hash includes a random **salt**, so two people with the same password get different hashes. A test proves this.
- Rules: 8–72 characters, with at least one letter and one number. The sign-up form shows a live checklist. (72 is bcrypt's input limit.)
- **No user enumeration:** "no such user" and "wrong password" give the *same* message, and for unknown users we still run a dummy bcrypt check (`burnTime`) so the response *takes the same time*. Otherwise attackers could discover which usernames exist.

### 2. Sessions: a random token in an httpOnly cookie
After a successful login, `startSession()`:
1. Creates 32 random bytes (256 bits, impossible to guess).
2. Stores **only the SHA-256 hash** in `sessions`, so even a database leak doesn't give anyone a usable token.
3. Sends the token to the browser as a cookie with:
   - `httpOnly`: page JavaScript can't read it, so an XSS bug can't steal it.
   - `sameSite: 'lax'`: the browser doesn't send it on cross-site form posts. That blocks **CSRF** (another site making your browser upload or delete on your behalf).
   - `secure` in production: HTTPS only.

**Why not JWT?** A JWT stays valid until it expires; you can't really "sign out" or "sign out everywhere". With database sessions, signing out deletes the row and the session is dead immediately. The trade-off is one small DB lookup per request, which is fine at this scale.

### 3. Protecting every route ([index.js](server/src/index.js))
```js
app.use('/api', auth);          // public: sign in / sign up / config
app.use('/api', requireAuth);   // ← everything below needs a valid session
app.use('/api', patients); app.use('/api', reports); app.use('/api', trends);
```
`requireAuth` reads the cookie, finds the session, and puts the user on `req.user`, or answers **401**. Putting it in **one line** before all data routes means a new route can't accidentally be left open.

### 4. Authorization: "is this *yours*?" ([db/repo.js](server/src/db/repo.js))
Being signed in isn't enough. Without more checks, user B could change `patientId=5` in a URL and read user A's reports. That bug is called **IDOR** (Insecure Direct Object Reference) and it's one of the most common real-world API vulnerabilities.

So every lookup goes through a `...ForUser` function (`getPatientForUser`, `getReportForUser`, `getResultForUser`) that adds `AND p.user_id = ?` to the SQL. Another user's row simply isn't found, and the API answers **404, not 403**, so it doesn't even reveal that the row exists. This was tested with two temporary users: Bob got 404 for Alice's reports, trends and delete.

### 5. Sign in with Google
1. The page loads Google's script and shows **Google's official button** (we never see the Google password).
2. The user picks an account; Google gives the page an **ID token**, a JWT signed by Google.
3. The page sends it to `POST /api/auth/google`.
4. The backend **verifies** it with `google-auth-library`: Google's signature, expiry, and that the `audience` is **our** client ID (so a token issued for some other app can't be replayed here).
5. Users are matched by Google's permanent ID (`sub`), not by email, because emails can change.

Password accounts and Google accounts are kept separate (no automatic linking by email). Auto-linking can let an attacker pre-create an account with someone else's email, a known attack called *account pre-hijacking*.

**Setup (optional):**
1. Go to https://console.cloud.google.com → **APIs & Services → OAuth consent screen**, choose **External**, fill in the app name and your email, and add yourself as a test user.
2. Go to **Credentials → Create credentials → OAuth client ID** → **Web application**. Under **Authorized JavaScript origins**, add `http://localhost:5173`.
3. Copy the client ID into `server/.env`: `GOOGLE_CLIENT_ID=1234...apps.googleusercontent.com`, then restart the API.

The frontend asks `GET /api/auth/config` whether Google is configured, so the client ID lives in one place and the button only appears when it works.

### 6. Rate limiting with Redis
Sign-in, sign-up and Google routes allow **20 attempts per IP per 15 minutes** (`authRateLimit`). The counter is a Redis key with an expiry (`INCR` + `EXPIRE`). Redis was already running for the queue, it's shared by every API process, and it survives restarts. If Redis is down, requests are allowed rather than locking everyone out (a deliberate *fail-open* choice for availability).

### 7. Frontend flow ([App.jsx](client/src/App.jsx))
- On load, `GET /api/auth/me`: `401` → show [AuthScreen](client/src/components/AuthScreen.jsx), otherwise show the app.
- [api.js](client/src/api.js) has a single **401 handler**: if a session expires mid-use, any request that gets 401 sends the user back to sign-in. There's no per-component error handling for that.
- `<Workspace key={user.id}>`: if a different user signs in, React rebuilds everything from scratch, so no previous user's data can linger on screen. The remembered "selected person" is also stored **per user**.

### 8. Other hardening done at the same time
- Unexpected server errors now return a generic *"Something went wrong"* instead of raw SQL errors or stack traces.
- **Deleting a person or the whole account also deletes the uploaded PDFs** from disk, not just the database rows.

### Interview questions you can now answer
- *How are passwords stored?* bcrypt, cost 12, salted; never plain text; same error and timing for unknown users.
- *Sessions or JWT, and why?* DB sessions with hashed tokens in httpOnly SameSite cookies, because they're revocable (sign-out-everywhere).
- *How do you stop user A reading user B's data?* Every query is scoped by `user_id`, returns 404 for others' rows, and is tested with two users.
- *How do you verify Google sign-in?* The backend verifies the ID token's signature, expiry and audience; users are keyed by `sub`, with no email auto-linking.
- *How do you prevent brute force?* A Redis-backed rate limit per IP, plus bcrypt's slowness.

---

## Part 12: Docker and free deployment

### Why Docker?
"It works on my machine" happens because every computer has different versions of Node, libraries and settings. A **Docker image** packages the app *together with* the exact Linux, Node version and dependencies it needs. The same image runs identically on your Mac, a teammate's PC and the hosting provider.

- **Image** = the packaged app (like a frozen snapshot). Built from the [Dockerfile](Dockerfile).
- **Container** = a running copy of an image.
- **docker compose** = starts several containers together (app + MySQL + Redis) from [docker-compose.yml](docker-compose.yml).

### The Dockerfile, explained
It's a **multi-stage build**:
1. **client-build:** installs the React dependencies and runs `npm run build`, producing static HTML/JS/CSS files.
2. **server-deps:** installs only the server's *production* dependencies (`npm ci --omit=dev`).
3. **Final image:** copies the server code, its `node_modules`, and the built React files (into `server/public`). No compilers, no dev tools, no frontend source, so it's smaller and has less to attack.

Details worth knowing:
- `COPY package.json ...` then `RUN npm ci` **before** copying the code: Docker caches each step, so editing code doesn't reinstall every package.
- `npm ci` (not `npm install`) installs exactly what's in `package-lock.json`, so builds are reproducible.
- `USER node`: the app doesn't run as root, which limits the damage if it's ever compromised.
- [.dockerignore](.dockerignore) keeps `node_modules`, `.env` and uploads out of the image. **Secrets are never baked into an image**; they're passed as environment variables when it runs.
- `CMD ["npm", "start"]` → `node src/db/migrate.js && node src/index.js`: the database schema is brought up to date on every start, so a new deploy never runs against old tables.

### Code changes that make it deployable
| Change | Where | Why |
|---|---|---|
| API serves the React app | [index.js](server/src/index.js) | One address for site and API, so cookies just work and no CORS is needed. Unknown non-API URLs return `index.html` so page refreshes work. |
| `MYSQL_URL` / `REDIS_URL` / `MYSQL_SSL` | [config.js](server/src/config.js) | Hosting providers give one connection URL; cloud databases require encrypted (TLS) connections. |
| `RUN_WORKER=true` | [index.js](server/src/index.js) | On the free plan a separate background worker costs extra, so the worker runs inside the web process. Locally you can still run it separately. |
| Uploaded PDFs deleted after processing | [worker.js](server/src/worker.js) | Free hosts have **no permanent disk**, and it's more private: only the PII-free text and results are kept. `KEEP_UPLOADS=true` turns this off. |
| Re-queue unfinished reports on startup | [worker.js](server/src/worker.js) | Free Redis can lose its data on restart. MySQL is the **source of truth**, so on start the worker re-adds every `queued`/`processing` report. The `jobId` stops duplicates. |
| A missing file becomes a clear error | [worker.js](server/src/worker.js) | If a restart wiped a not-yet-processed upload, the report says *"Please upload it again"* instead of retrying forever. |
| `trust proxy` | [index.js](server/src/index.js) | Hosts put a proxy in front of the app; this makes `req.ip` the real visitor's IP, so rate limiting works per person, not per proxy. |
| `SIGTERM` handling | [worker.js](server/src/worker.js) | When a host redeploys, it sends SIGTERM. The worker finishes its current job before exiting. |
| One change per `ALTER TABLE` | migrations | Works on MySQL and on MySQL-compatible clouds like TiDB. |
| Generic 500 messages | [index.js](server/src/index.js) | Never show SQL errors or stack traces to visitors. |

### Run the production setup on your computer (optional)
1. Install **Docker Desktop**: https://www.docker.com/products/docker-desktop/
2. Stop the `npm run dev` / `npm run worker` terminals and your Homebrew MySQL (`brew services stop mysql`), because they use the same ports.
3. Run:
   ```bash
   docker compose up --build
   ```
4. Open **http://localhost:4000**. It's a fresh, empty database inside Docker; your Homebrew data isn't touched.
5. Stop with Ctrl+C, then `docker compose down`. Your Docker database survives in the `mysql-data` volume.

### Where to host for free (checked November 2026; free tiers change, so double-check)
- **Heroku:** no longer free; cheapest is about $5/month.
- **Render (chosen):** free Docker web service with 512 MB RAM. It **sleeps after 15 minutes without visitors**, and the first visit after that takes about a minute to wake. There's a free Key Value (Redis) of 25 MB that's wiped on restart, and no permanent disk. The code changes above are designed around these limits.
- **TiDB Cloud Starter (chosen for MySQL):** MySQL-compatible, free up to 5 GiB. Aiven's free MySQL has been retired.
- **Paid but simplest:** Railway (about $5/month) has real MySQL and Redis built in, uses the same Docker image, and just needs the `MYSQL_URL` and `REDIS_URL` variables.

### Step-by-step: deploy to Render + TiDB

**A. Put the code on GitHub** (Render deploys from a Git repository)
1. Create an **empty** repository at https://github.com/new, named `vitaltrack`. Don't add a README.
2. In the VitalTrack folder:
   ```bash
   git init
   git add .
   git status            # CHECK: server/.env must NOT be listed (it holds your API keys)
   git commit -m "VitalTrack"
   git branch -M main
   git remote add origin https://github.com/<your-username>/vitaltrack.git
   git push -u origin main
   ```

**B. Create the database (TiDB Cloud)**
1. Sign up at https://tidbcloud.com and create a **Starter** cluster (free). Pick an AWS region close to Render's region (for example Oregon/us-west or Frankfurt).
2. Open the cluster → **Connect**. Choose **General** / **Node.js** and click **Generate password**. Copy the host, port (4000), user and password.
3. In the cluster's **SQL Editor**, run: `CREATE DATABASE vitaltrack;`
4. Build your connection URL:
   ```
   mysql://USER:PASSWORD@HOST:4000/vitaltrack
   ```
   The TiDB user usually looks like `abc123.root`. If the password contains special characters like `@` or `/`, generate a new password without them.

**C. Deploy on Render**
1. Sign up at https://render.com **with your GitHub account**.
2. Click **New → Blueprint**, select the `vitaltrack` repository. Render reads [render.yaml](render.yaml) and plans a web service plus a Key Value instance.
3. Render asks for the secret values:
   - `MYSQL_URL`: the URL from step B4
   - `DEEPSEEK_API_KEY`: your DeepSeek key
   - `GOOGLE_CLIENT_ID`: the same Google client ID as in `server/.env`
4. Click **Apply**. The first build takes a few minutes. When the logs show `Database is up to date` and `API listening`, open the URL Render gives you (like `https://vitaltrack-xxxx.onrender.com`).

**D. Allow Google sign-in on the new address**
In Google Cloud → **Clients** → your client → **Authorized JavaScript origins**, add your Render URL (`https://vitaltrack-xxxx.onrender.com`, no slash at the end) and save. It can take a few minutes to apply.

**E. Updating later**
`git add . && git commit -m "..." && git push`. Render rebuilds and redeploys automatically, and migrations run on start.

### Things to know (and to say honestly in interviews)
- **Cold starts:** the free service sleeps; the first visit after 15 idle minutes takes about a minute. Queued jobs resume when it wakes.
- **Your local data stays local.** The deployed app starts with an empty database. (It could be copied over with `mysqldump`, but test data usually isn't worth moving.)
- **TiDB is MySQL-*compatible*, not MySQL.** The schema avoids the known differences, but test it after the first deploy. If anything misbehaves, a real MySQL host (Railway, or Aiven's paid tier) works without code changes; just change `MYSQL_URL`.
- **Scaling story:** for real traffic, run the worker as its own service (`RUN_WORKER=false` on the web service, plus a second service with `npm run worker`), store uploads in S3/R2 instead of local disk, and use a persistent Redis.

---

## Part 13: Making it work on phones (responsive design)

**Responsive** means one website that adapts its layout to the screen size, instead of a separate mobile site. It's done with CSS **media queries**: rules that only apply under certain conditions. All phone rules live in one block at the **end** of [styles.css](client/src/styles.css). Rules later in a file win when two rules conflict, so the desktop design stays untouched.

| Media query | Applies to | What it fixes |
|---|---|---|
| `@media (max-width: 640px)` | Phones | The layout changes described below |
| `@media (max-width: 380px)` | Very small phones (iPhone SE) | Slightly smaller text and charts |
| `@media (hover: none)` | Touch screens | Things that only appeared on mouse hover (the remove-person trash icon) are always visible, because fingers can't hover |
| `@media (pointer: coarse)` | Touch screens | Bigger tap targets (about 44px, the common guideline for fingers) |

**What changes on a phone:**
- **Top bar:** logo + avatar on the first row, then a full-width Reports/Trends toggle, then the person picker. The trick is `display: contents` on the wrapper, which makes the wrapper "disappear" for layout so its children can be reordered with `order`.
- **Report list:** each row uses `grid-template-areas` ("date actions" / "main main" / "meta meta") so nothing gets squeezed.
- **Results table → cards:** a 5-column table can't fit 360px. On phones the `<thead>` is hidden, each `<tr>` becomes a small card, and each cell shows its column name from a `data-label` attribute via CSS `content: attr(data-label)`. No JavaScript is needed.
- **Filter chips:** one horizontally swipeable row instead of four wrapped lines.
- **Text boxes are 16px:** iPhone Safari automatically zooms into any input with a smaller font, which feels broken. 16px prevents it.
- **Google button:** Google's button needs a fixed pixel width, so it's now measured from the card's actual width.

**How it was checked:** with screenshots at 390px (iPhone 14) and 360px (small Android/iPhone SE), using headless Chrome, plus an automatic check that no page scrolls sideways. The screenshots caught two bugs that reading the code didn't: a CSS rule that accidentally moved the sign-in toggle to the bottom (fixed by scoping it to `.topbar .toggle`), and a number and its unit pushed apart in the results cards.

**Dates:** month names are now written out in [format.js](client/src/format.js). Browsers' built-in formatter recently changed "Sep" to "Sept", which broke the "21 Sep 2026" format.
