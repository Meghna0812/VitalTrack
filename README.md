# VitalTrack

Upload blood test reports (PDF), and VitalTrack extracts the biomarkers with an LLM, converts names and units so results from different labs can be compared, and flags values that are drifting toward abnormal ranges. Personal details are removed before any text is sent to the LLM.

**Stack:** React · Node.js · Express · MySQL · Redis · BullMQ · DeepSeek API · bcrypt · Google Sign-In

```
Browser (React) ──upload──▶ Express API ──save──▶ MySQL
                               │ add job (report id only)
                               ▼
                         Redis (BullMQ queue)
                               │
                               ▼
                         Worker process
          PDF → text → redact PII → leak check → DeepSeek → validate (Zod)
             → normalize names/units → quality checks → MySQL
```

## Run it

Prerequisites: Node 20+, plus MySQL 8 and Redis 7 (via Docker **or** Homebrew).

```bash
# 1. Databases (choose one)
docker compose up -d                                  # option A: Docker
brew install mysql redis && brew services start mysql && brew services start redis   # option B
#    with option B, create the DB user once:
#    mysql -uroot -e "CREATE DATABASE vitaltrack; CREATE USER 'vitaltrack'@'localhost' IDENTIFIED BY 'vitaltrack'; GRANT ALL ON vitaltrack.* TO 'vitaltrack'@'localhost';"

# 2. Backend
cd server
cp .env.example .env          # then put your DeepSeek API key in .env
npm install
npm run db:migrate            # creates/updates tables – run again after pulling new code
npm run dev                   # terminal 1: API on :4000
npm run worker                # terminal 2: background worker

# 3. Frontend
cd ../client
npm install
npm run dev                   # terminal 3: open http://localhost:5173
```

Try it with the files in [samples/](samples/): three fake reports from two labs using different names and units.

## Run everything with Docker

```bash
docker compose up --build     # app + MySQL + Redis, then open http://localhost:4000
```

## Deploy (free: Render + TiDB Cloud)

The repo includes a [Dockerfile](Dockerfile) and a Render Blueprint ([render.yaml](render.yaml)).
Step-by-step instructions are in [GUIDE.md](GUIDE.md), Part 12.

## Tests and evaluation

```bash
cd server
npm test        # unit tests: redaction, normalization, trends, pipeline (no API key needed)
npm run eval    # measures real extraction accuracy against samples/*.truth.json (needs API key)
```

See [GUIDE.md](GUIDE.md) for a step-by-step explanation of how and why everything is built.
