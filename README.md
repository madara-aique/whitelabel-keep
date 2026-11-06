# Smart Locker

A self-service locker kiosk. A customer picks a free door on the touch screen, chooses how long
they need it, pays with cash at the bill acceptor or with an e-wallet QR, and the kiosk opens the
door. Operators get a password-protected area to see live door state, clear abandoned doors,
re-issue PINs, and read the transaction history.

Everything a deployment might want to change — door rate, currency, accepted banknotes, support
contacts, hardware driver — is environment configuration, not a code change. No customer-specific
branding is baked into the source; the display name is `APP_NAME`, defaulting to **Smart Locker**.

---

## Contents

- [Architecture overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Hardware: mock driver and real controllers](#hardware-mock-driver-and-real-controllers)
- [Payment flows](#payment-flows)
- [Offline → online sync](#offline--online-sync)
- [Testing, type-checking and linting](#testing-type-checking-and-linting)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## Architecture overview

- **Next.js 16 App Router.** Server Components are the default: a page reads MongoDB and renders
  the door grid, the price, or the operator tables on the server. Client Components exist only
  where the customer or the hardware is involved — the touch UI, the socket.io connection to the
  bill acceptor, the PIN keypad, the sign-in form.
- **Server Actions and Route Handlers** are the only way the browser mutates data. Server Actions
  cover form-driven mutations (start a booking, confirm a payment, clear a door); Route Handlers
  cover things that need a URL (minting a hardware token, polling an e-wallet status, health).
- **MongoDB is the single data store.** It runs as a replica set because the kiosk needs change
  streams (the sync worker) and multi-document transactions (a payment commits the transaction and
  the door together).
- **A separate hardware gateway process** (`npm run dev:gateway`) owns the bill acceptor and the
  door locks. It holds the device credential, authenticates browser sockets with short-lived
  tokens, and is the only process that talks to the controller. The Next.js server never touches
  the acceptor directly, so a slow or dead device cannot block a page render.

```
┌──────────────┐   HTML/RSC   ┌───────────────────┐   mongoose   ┌──────────────────┐
│   Browser    │ ───────────▶ │  Next.js 16 app   │ ───────────▶ │ MongoDB (rs0)    │
│  (kiosk UI)  │ ◀─────────── │  RSC + actions    │ ◀─────────── │  replica set     │
└──────┬───────┘              └─────────┬─────────┘              └────────┬─────────┘
       │ socket.io + short-lived token  │ token minted server-side        │ change stream
       ▼                                │                                 ▼
┌──────────────────────┐      ┌─────────┴─────────┐            ┌──────────────────────┐
│ Hardware gateway     │      │ Payment gateway   │            │ Sync worker          │
│ (bill acceptor/locks)│      │ (e-wallet, HTTPS) │            │ npm run sync         │
└──────────┬───────────┘      └───────────────────┘            └──────────┬───────────┘
           │ driver (mock | socketio)                                    │ upsert by transId
           ▼                                                             ▼
   physical controller                                        online MongoDB cluster
```

`docs/architecture.md` has the component detail, the request paths, and the data and security
models.

---

## Prerequisites

- **Node.js 20.9 or newer** (`node --version`), which also brings npm.
- **Docker** with Docker Compose v2 (`docker compose version`) for the local MongoDB replica set.
- A browser. No bill acceptor, no card reader, and no locker hardware are required to run the whole
  flow end to end — see [Hardware](#hardware-mock-driver-and-real-controllers).

---

## Setup

From a clean clone:

```bash
# 1. Environment files. docker compose reads .env; the app reads .env.local.
cp .env.example .env
cp .env.example .env.local

# 2. Generate a real session secret and put it in BOTH files (AUTH_SECRET).
openssl rand -base64 32

# 3. Dependencies.
npm install

# 4. Start MongoDB (single-node replica set rs0) on host port 27019.
npm run db:up

# 5. Wait for the replica set to elect a primary, then confirm.
#    The one-shot `mongodb-init` container prints "PRIMARY elected" when it is ready.
docker compose logs -f mongodb-init

# 6. Create indexes, the administrator account and the doors.
npm run seed

#    No locker controller attached? Create placeholder doors 1..12 so the kiosk is usable:
npm run seed -- --doors=12

# 7. The web app.
npm run dev

# 8. In a second terminal: the hardware gateway.
npm run dev:gateway
```

Then open:

| URL | What it is |
| --- | --- |
| <http://localhost:3000> | The kiosk: door selection and payment |
| <http://localhost:3000/admin/login> | Operator sign-in (uses `ADMIN_EMAIL` / `ADMIN_PASSWORD`) |
| <http://localhost:4000/health> | Hardware gateway health (`driver`, `connected`) |

Useful database commands:

```bash
npm run db:logs     # follow mongod output
npm run db:shell    # mongosh against the whitelabel-keep database
npm run db:down     # stop the containers
npm run db:reset    # delete the volumes and start over (destroys all data)
```

### Seeding details

`npm run seed` is idempotent and safe to re-run:

- it creates the administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` only when that account does
  not exist; the stored value is a bcrypt hash (10 rounds) and the plaintext is never written
  anywhere. Pass `--reset-password` to re-hash the configured password for an existing account.
- it reconciles the MongoDB indexes declared by the `Door`, `Transaction`, `SyncQueue` and `User`
  models.
- it asks the locker controller for its doors (`LOCKER_CONTROLLER_BASE_URL`) and creates a record
  for each one it has not seen before. If the controller is unreachable the script logs a warning
  and continues — it only exits non-zero for a real database failure.
- `--doors=N` (1–200) creates placeholder doors `"1"`..`"N"` with `$setOnInsert`, so re-running
  never disturbs a door that is currently in use. Placeholders are skipped when the controller did
  report doors.

> The seed and sync scripts read configuration from the process environment, exactly like the app.
> Their built-in defaults match `.env.example` and `docker-compose.yml`, so a default checkout works
> without exporting anything. To point them somewhere else, pass it inline:
> `MONGODB_URI='mongodb://…' npm run seed`.

---

## Environment variables

Copy `.env.example` to both `.env` (Docker Compose) and `.env.local` (Next.js). The groups below
mirror that file.

> **Client exposure.** Next.js inlines every `NEXT_PUBLIC_*` variable into the browser bundle, where
> it is readable by anyone. This project therefore defines **no `NEXT_PUBLIC_*` variables at all**:
> the device credential, the database URI, the auth secret and the payment gateway URLs stay in the
> server environment. The only configuration a Client Component is allowed to see is the
> serializable subset assembled by `getKioskConfig()` and passed down as props.

### Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Standard Node environment. |
| `PORT` | `3000` | Port for the Next.js server. |
| `HOSTNAME` | `localhost` | Hostname the app binds to. |

### App identity (all user-visible copy)

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Smart Locker` | Product name shown to customers. |
| `APP_OPERATOR_NAME` | `Locker Operations` | Operator shown on receipts and in the admin area. |
| `APP_LOCALE` | `en-PH` | Locale for date and number formatting. |
| `APP_CURRENCY` | `PHP` | ISO currency code. |
| `APP_CURRENCY_SYMBOL` | `PHP` | Symbol prefixed to amounts. |
| `APP_SUPPORT_EMAIL` | `support@example.com` | Support contact shown on the kiosk. |
| `APP_SUPPORT_PHONE` | `+63 000 000 0000` | Support phone shown on the kiosk. |
| `APP_REFERENCE_PREFIX` | `REF` | Prefix of generated booking references. |
| `APP_TIMEZONE` | `Asia/Manila` | Site time zone for display. |
| `APP_TIMEZONE_OFFSET_MINUTES` | `480` | Fixed offset used for date math. |

### Dockerized MongoDB (read by Docker Compose)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_HOST_PORT` | `27019` | Host port mapped to mongod's 27017. |
| `MONGO_ROOT_USER` | `admin` | Root user created on first boot. |
| `MONGO_ROOT_PASSWORD` | `changeme123` | Root password. Change it for anything but a laptop. |
| `MONGO_DB` | `whitelabel-keep` | Database created on first boot. |
| `MONGO_EXPRESS_PORT` | `8081` | Host port for the optional `tools` profile UI. |

### Database (read by the app, server-side only)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://admin:changeme123@localhost:27019/whitelabel-keep?authSource=admin&replicaSet=rs0&directConnection=true` | Mongoose connection string. Must include `replicaSet=rs0`. |
| `MONGODB_MAX_POOL_SIZE` | `10` | Mongoose connection pool size. |

### Admin authentication

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | — | NextAuth signing secret. Generate with `openssl rand -base64 32`. |
| `AUTH_TRUST_HOST` | `true` | Trust the request host header (needed behind a kiosk proxy). |
| `ADMIN_EMAIL` | `admin@example.com` | Administrator created by `npm run seed`. |
| `ADMIN_PASSWORD` | `ChangeMe123!` | Password hashed by the seed (10 bcrypt rounds). |
| `ADMIN_SCAN_CODE` | `admin-scan-code` | Barcode value the hidden operator shortcut scans. |

### Hardware gateway

| Variable | Default | Purpose |
| --- | --- | --- |
| `HARDWARE_DRIVER` | `mock` | `mock` runs the full flow with no hardware; `socketio` talks to a real controller. |
| `HARDWARE_ENABLED` | `true` | Master switch; when false the gateway refuses every socket. |
| `HARDWARE_SOCKET_PORT` | `4000` | Port the gateway process listens on. |
| `HARDWARE_DEVICE_URL` | *(empty)* | Address of the physical controller, e.g. `http://10.0.0.50:4000`. Required for `socketio`. |
| `HARDWARE_ACCESS_KEY` | `change-me-hardware-access-key` | Shared secret: signs hardware tokens and authenticates to the controller. Server-side only. |
| `HARDWARE_SESSION_TTL_SECONDS` | `300` | Lifetime of a minted hardware token. |
| `HARDWARE_CONNECT_TIMEOUT_MS` | `10000` | Driver connection budget. |

### Locker controller

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOCKER_CONTROLLER_BASE_URL` | `http://localhost:9090` | Base URL of the HTTP controller used for door discovery and actuation. |
| `LOCKER_CONTROLLER_DOORS_PATH` | `/api/doors` | Door discovery path (used by the seed). |
| `LOCKER_CONTROLLER_LOCATION_PATH` | `/api/location` | Site/location path (used by the seed). |
| `LOCKER_CONTROLLER_DOOR_PATH` | `/api/door` | Single-door actuation path. |
| `LOCKER_CONTROLLER_OPEN_ALL_PATH` | `/api/doors/open-all` | Operator "open everything" path. |
| `LOCKER_CONTROLLER_TIMEOUT_MS` | `8000` | Per-request timeout; the kiosk never waits forever. |

### Kiosk behaviour

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOOR_RATE` | `250` | Price of a stay, in whole currency units. |
| `BILL_ACCEPTOR_ENABLED` | `true` | Hide cash payment when no acceptor is fitted. |
| `IDLE_TIMEOUT_SECONDS` | `120` | Inactivity before the kiosk returns to the home screen. |
| `MAX_ALIAS_LENGTH` | `8` | Maximum customer alias length. |
| `PIN_LENGTH` | `6` | Customer PIN length. |
| `ACCEPTED_BILLS` | `[50,100,200]` | JSON array of accepted denominations. |

### Promo pricing

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROMO_ENABLED` | `false` | Enable a promotional rate window. |
| `PROMO_START_DATE` | *(empty)* | Inclusive start, ISO-8601. |
| `PROMO_END_DATE` | *(empty)* | Inclusive end, ISO-8601. |
| `PROMO_RATE` | `0` | Price during the window. |

### Payment gateway (e-wallet / QR)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAYMENT_GATEWAY_ENABLED` | `false` | Offer e-wallet payment on the kiosk. |
| `PAYMENT_GATEWAY_URL` | *(empty)* | Base URL used to create a payment. |
| `PAYMENT_GATEWAY_STATUS_URL` | *(empty)* | Status endpoint (server-side polling). |
| `PAYMENT_GATEWAY_TIMEOUT_MS` | `15000` | Per-request timeout. |

### Offline → online sync

| Variable | Default | Purpose |
| --- | --- | --- |
| `ONLINE_MONGO_URI` | *(empty)* | Online cluster URI. Empty keeps the kiosk fully offline. |
| `ONLINE_MONGO_DB` | *(empty)* | Online database name; empty uses the URI's default. |
| `SYNC_ENABLED` | `false` | Start the worker at all. |
| `SYNC_RETRY_INTERVAL_MS` | `30000` | How often queued rows are forwarded. |
| `SYNC_BATCH_SIZE` | `50` | Rows per forwarding batch. |

`SYNC_ONLINE_COLLECTION` (default `kiosk_sync_transactions`) selects the online collection and can be
set when it needs to differ from the default.

---

## Hardware: mock driver and real controllers

### Running the whole flow with no hardware

`HARDWARE_DRIVER=mock` (the default) is a complete emulator. Nothing needs to be plugged in.

1. Start the infrastructure and the app: `npm run db:up`, `npm run seed -- --doors=12` (placeholder
   doors, because no controller is attached), `npm run dev`.
2. Start the gateway in a second terminal: `npm run dev:gateway`. It logs
   `[gateway] listening on :4000 (driver=mock)`.
3. Confirm it is alive: `curl http://localhost:4000/health` →
   `{"status":"ok","driver":"mock","connected":true}`.
4. On the kiosk, tap a free door, fill in the details screen, and choose **Cash** on the payment
   method screen. The cash screen opens a bill-acceptor session over socket.io; because the driver
   is `mock`, it also shows a developer emulator panel.
5. Feed notes with the emulator. It emits the same `billAcceptor:onInsert` events a real acceptor
   would, so the accounting, booking settlement, door opening and receipt are the real code paths.
   Feeding a note that is not in `ACCEPTED_BILLS` is rejected; feeding one that would overshoot the
   target is held and returned, because the machine never dispenses change.
6. For a scripted run, the same event can be emitted straight to the gateway by a test client:
   connect to `http://localhost:4000` with `auth: { token }` (the token comes from
   `GET /api/hardware/token` on the app) and emit `mock:insertBill` with `{ denomination: 100 }`.
7. To exercise the e-wallet screen without a provider, set `PAYMENT_GATEWAY_ENABLED=false`: the
   payment method screen then offers cash only, and `/payment/ewallet` explains that the method is
   unavailable instead of failing mid-flow.

Door opening in mock mode is equally real from the UI's point of view: the gateway records the
request and acknowledges it, but no lock is energised.

### Switching to a real controller

1. Set the driver and the device address in `.env.local` (and restart the gateway):

   ```bash
   HARDWARE_DRIVER=socketio
   HARDWARE_DEVICE_URL=http://10.0.0.50:4000   # the physical controller, not this app
   HARDWARE_ACCESS_KEY=<the controller's shared secret>
   ```

2. Point the HTTP controller variables at the door controller so the seed can discover doors and
   the operator actions can energise locks:

   ```bash
   LOCKER_CONTROLLER_BASE_URL=http://10.0.0.50:9090
   ```

3. Restart `npm run dev:gateway` and re-run `npm run seed`, which now creates a record for every
   door the controller reports.
4. `curl http://localhost:4000/health` should report `"driver":"socketio"` and `"connected":true`.
   The emulator control disappears from the kiosk because the driver no longer implements note
   injection.

`HARDWARE_ENABLED=false` disables the gateway entirely; the kiosk then falls back to whatever
payment methods remain enabled.

---

## Payment flows

Both flows share the same opening screens. Routes are the real App Router paths.

| Screen | Route | Rendered by |
| --- | --- | --- |
| Door selection | `/` | Server Component (`app/page.tsx` → `DoorGrid`) |
| Locker details | `/details?doorNumber=…` | Server Component shell + `DetailsForm` |
| Payment method | `/payment-selection?transId=…&doorNumber=…` | Server shell + `PaymentMethodPicker` |
| Cash | `/payment/cash?transId=…&doorNumber=…` | Server shell + `CashPayment` |
| E-wallet | `/payment/ewallet?transId=…&doorNumber=…` | Server shell + `EWalletPayment` |
| Operator area | `/admin/login`, then `/admin` | Server Components, session-guarded |

### Cash

1. **Door selection** — the home screen (Server Component) lists free doors. The customer taps one.
2. **Locker details** — `/details` resolves the door on the server and the customer enters an alias
   and a pickup PIN. The form then calls the `startBookingAction` Server Action, which opens a
   transaction in `payment-pending` with a generated reference such as `REF-12-1730000000000`. No
   door is reserved yet, so a customer who walks away never blocks a locker.
3. **Payment method** — `/payment-selection` resolves the booking server-side and offers the methods
   that are enabled (`BILL_ACCEPTOR_ENABLED`, `PAYMENT_GATEWAY_ENABLED`).
4. **Amount** — the price comes from `DOOR_RATE`, or `PROMO_RATE` while a promo window is open. The
   cash screen shows the target and the remaining amount.
5. **Hardware token** — the Client Component calls `GET /api/hardware/token`, which returns a
   short-lived HMAC token. The device credential stays on the server.
6. **Session** — the browser connects to the gateway with that token and emits
   `billAcceptor:startSession` with the target amount and the transaction reference. The gateway
   creates a `BillSession` for it. With the `mock` driver the screen also shows a developer emulator
   for feeding notes.
7. **Notes** — each note the customer feeds is classified by `BillSession`:
   - *accepted* — added to the total, and the running total is pushed back to the browser;
   - *rejected* — the denomination is not in `ACCEPTED_BILLS`, so it is returned;
   - *hold* — the note would overshoot the target; the machine gives no change, so it is returned.
8. **Settlement** — as soon as the remaining amount is zero, the screen calls the
   `settleBookingAction` Server Action. The server re-reads the transaction, records
   `payType: 'CASH'` with the accepted `bills` and the settled amount, and marks the door occupied in
   the same operation. The hardware session is closed.
9. **Door** — the screen opens the door through the gateway (`locker:openDoor`), then shows the
   receipt with the note breakdown. Settlement and opening are each bounded at 20 seconds and each
   successful step is remembered, so **Try again** never re-runs a step that already succeeded.
10. **Pickup** — the customer returns to the kiosk, taps their locker and enters the PIN on
    `/details`; `openOccupiedDoorAction` verifies it against the door record and energises the lock.
    The stay ends with `completeBookingAction`, which releases the door.

### E-wallet

1. Steps 1–4 are identical: a transaction is created in `payment-pending` with the effective rate.
2. **Start payment** — the screen POSTs to `/api/payments`. The server re-reads the booking, reuses
   an in-flight `paymentId` if one exists, otherwise calls the payment gateway
   (`PAYMENT_GATEWAY_URL`) with the amount it decided and `transId` as the idempotency key. The
   payment id, reference and QR payload are stored on the transaction, so a retry cannot produce a
   second charge.
3. **Display** — the QR payload is rendered as a QR code on the e-wallet screen.
4. **Confirmation** — the screen polls `GET /api/payments/{paymentId}` every 3 seconds (up to a
   three-minute timeout). The handler asks the gateway and returns only the mapped status; the
   browser shows a waiting state either way and the decision is always made server-side.
5. **Settlement** — on `paid`, the same settlement path as cash runs: the transaction moves to
   `ready-for-pickup` with `payType: 'EWALLET'` and the gateway reference stored, and the door is
   marked occupied in the same operation.
6. **Door and pickup** — identical to cash: open the door through the gateway, show the reference,
   verify the PIN later, complete the stay.

Because both flows converge on one settlement function, the door cannot be taken without a payment
and a payment cannot be recorded without taking the door.

---

## Offline → online sync

A kiosk must keep working when its uplink is down, and head office must still see every sale.

Every local write to `transactions` is mirrored into the `sync_queue` collection with status
`pending`. The worker:

```bash
SYNC_ENABLED=true
ONLINE_MONGO_URI=mongodb+srv://user:pass@cluster.example.mongodb.net/?retryWrites=true
ONLINE_MONGO_DB=operations
SYNC_ONLINE_COLLECTION=kiosk_sync_transactions   # default
SYNC_RETRY_INTERVAL_MS=30000
SYNC_BATCH_SIZE=50

npm run sync
```

- It watches the local `transactions` collection with a **change stream**
  (`fullDocument: 'updateLookup'`, which is why the replica set is required) and enqueues an insert
  or update for each event.
- Every `SYNC_RETRY_INTERVAL_MS` it takes up to `SYNC_BATCH_SIZE` rows that are `pending` or
  `failed` and upserts them into `${ONLINE_MONGO_DB}.${SYNC_ONLINE_COLLECTION}` by `transId`.
  `_id` and `__v` are stripped first, and upserts make replays harmless.
- Rows that land are marked `synced` with a `syncedAt` timestamp; rows that fail are marked `failed`
  with `lastError` and an incremented `retryCount`, and are retried on the next sweep.
- If the online client has dropped, it reconnects before the next batch.
- `Ctrl+C` (SIGINT/SIGTERM) closes the change stream, the online client and the Mongoose connection.
  A change-stream error is logged and the process exits non-zero so a supervisor restarts it.

With `SYNC_ENABLED=false` or an empty `ONLINE_MONGO_URI` the worker logs that sync is disabled and
exits 0 — which is the correct configuration for a kiosk with no uplink.

---

## Testing, type-checking and linting

```bash
npm test              # vitest run (single pass)
npm run test:watch    # vitest in watch mode
npx vitest run src/lib/utils.test.ts   # a single file
npm run type-check    # tsc --noEmit
npx tsc --noEmit      # the same thing directly
npm run test:e2e      # playwright (browser flows)
```

- The suite covers the server-side modules: `src/lib/utils.test.ts` (helpers and
  `fetchWithTimeout`, including the abort-on-timeout path) and
  `src/lib/hardware/session.test.ts` (`BillSession` accounting).
- Vitest runs in the `node` environment. Files named `*.test.tsx` are matched by
  `environmentMatchGlobs` and run under `jsdom`, so install it once before adding component tests:
  `npm install -D jsdom`. `vitest.setup.ts` loads `@testing-library/jest-dom/vitest` and stubs
  `window.matchMedia`.
- Linting: `npm run lint` wraps `next lint`, which Next.js 16 no longer ships. Until the script is
  repointed, run ESLint directly against a flat config:
  `npx eslint "src/**/*.{ts,tsx}"`.

---

## Project layout

```
src/
  app/
    layout.tsx         Root layout; reads the kiosk config for the client providers
    page.tsx           Kiosk home (door selection, Server Component)
    details/           Alias + PIN screen for the selected locker
    payment-selection/ Payment method chooser
    payment/cash/      Cash payment screen
    payment/ewallet/   E-wallet QR payment screen
    admin/             Operator sign-in and the session-guarded (protected) area
    actions/           Server Actions: booking, door, admin
    api/               Route Handlers: hardware token, payments, doors, transactions, health, auth
  components/
    kiosk/             Door grid, details form, payment screens, success panel, scan listener
    admin/             Operator forms and action buttons
    ui/                Presentational primitives (card, button, keypad, modal, toast…)
  context/             Client providers: kiosk config, hardware socket, toasts
  hooks/               Bill session, idle timeout, countdown, network, scan code
  lib/
    api/               JSON response envelope for Route Handlers
    config/            Kiosk configuration and PIN policy
    hardware/          Drivers, gateway core, bill sessions, short-lived tokens
    models/            Mongoose models: doors, transactions, sync_queue, users, audit_logs
    payments/          Server-side e-wallet gateway client
    schemas/           Zod request schemas
    services/          Domain services (booking, payment, door lifecycle)
    auth.ts            NextAuth credentials provider
    env.ts             The single place server configuration is read
    locker-controller.ts  HTTP client for door actuation
    mongodb.ts         Mongoose connection singleton
    utils.ts           Small shared helpers
  server/gateway.ts    Hardware gateway process entry point
  types/               Shared domain types
scripts/
  seed.ts              Idempotent database seed
  sync-worker.ts       Offline → online sync worker
docs/
  architecture.md      Components, request paths, data and security model
```

---

## Troubleshooting

### MongoDB is not primary yet

Change streams and transactions only work against a primary. A freshly started container spends a
few seconds electing one.

```bash
docker compose ps                      # wait for mongodb to become healthy
docker compose logs -f mongodb-init    # look for "PRIMARY elected"
npm run db:logs                        # raw mongod output
npm run db:shell                       # then: rs.status()
```

If the app reports a server-selection timeout, watch for the primary and try again — no data is
lost. If `rs.status()` says the set was never initiated, re-run `npm run db:reset`. If the initial
boot was interrupted, `docker compose restart mongodb` then `docker compose up -d mongodb-init`
completes the initiation.

### Port 27019 is already in use

Something else — often a native `mongod` — owns the port. Confirm and then either stop it or move
the container:

```bash
lsof -nP -iTCP:27019 -sTCP:LISTEN
```

To move the container, set the same port in **both** files and restart:

```bash
# .env            (read by docker compose)
MONGO_HOST_PORT=27020
# .env.local      (read by the app — keep the port in the URI in step)
MONGODB_URI=mongodb://admin:changeme123@localhost:27020/whitelabel-keep?authSource=admin&replicaSet=rs0&directConnection=true

docker compose up -d
npm run seed
```

### The gateway is not reachable

Symptoms: the cash screen never arms, or the kiosk reports the hardware as disconnected.

1. Is the process running? `npm run dev:gateway` in its own terminal.
2. Is it healthy? `curl http://localhost:4000/health` — expect `status: ok` and `connected: true`.
3. Is the port free or correct? The gateway uses `HARDWARE_SOCKET_PORT` (4000 by default).
   `lsof -nP -iTCP:4000 -sTCP:LISTEN` shows what is bound.
4. Is hardware enabled? `HARDWARE_ENABLED=true`; when it is `false` every socket is rejected.
5. Does the shared secret match? The app signs session tokens with `HARDWARE_ACCESS_KEY` and the
   gateway verifies them, so both processes must have the same value. If the kiosk gets
   "Unauthorized" on connect, the secret differs between terminals or the token expired
   (`HARDWARE_SESSION_TTL_SECONDS`).
6. With `HARDWARE_DRIVER=socketio`, check `HARDWARE_DEVICE_URL` points at the physical controller
   and that the controller is powered and on the same network.
7. Fully restart the browser tab after changing hardware environment variables — the socket
   reconnects with a freshly minted token.

### Reset the database

```bash
npm run db:reset      # docker compose down -v && docker compose up -d
npm run seed          # recreate indexes, the admin account and the doors
npm run seed -- --doors=12   # ...or placeholder doors when no controller is attached
```

`db:reset` removes the Mongo volumes, so every door, transaction, queue row, user and audit entry is
permanently deleted. Never run it against a production deployment.
