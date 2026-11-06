# Architecture

How the kiosk is put together, which route is a Server Component and which is a Client Component,
exactly what happens during a cash and an e-wallet payment, what is stored, and where the trust
boundaries are.

Related reading: [`README.md`](../README.md) for setup, [`legacy-spec.md`](./legacy-spec.md) and
[`legacy-payment-flow.md`](./legacy-payment-flow.md) for the behaviour this port reproduces.

---

## 1. Components

```
                        ┌──────────────────────────────────────────────────────┐
                        │                  Browser (kiosk UI)                  │
                        │                                                      │
                        │  Server Component output (HTML/RSC)                  │
                        │  Client Components: touch UI, keypads, QR, socket.io │
                        │  Providers: Toast → Kiosk → Hardware (one socket)    │
                        └───────┬──────────────────────────────────┬───────────┘
                                │ RSC navigation                   │ socket.io
                                │ Server Actions                   │ + short-lived token
                                ▼                                  ▼
   ┌─────────────────────────────────────────────────┐   ┌────────────────────────────────┐
   │              Next.js 16 App Router              │   │       Hardware gateway         │
   │                                                 │   │   src/server/gateway.ts        │
   │  Server Components ── read ──┐                  │   │       npm run dev:gateway      │
   │    app/page.tsx              │                  │   │                                │
   │    app/details               │                  │   │  HardwareGateway               │
   │    app/payment-selection     │                  │   │   ├─ verifies tokens (HMAC)    │
   │    app/payment/{cash,ewallet}│                  │   │   ├─ BillSession accounting    │
   │    app/admin/(protected)/**  │                  │   │   └─ driver (mock | socketio)  │
   │                              │                  │   │                                │
   │  Server Actions ── write ────┤  app/actions/*   │   └───────────────┬────────────────┘
   │  Route Handlers ── JSON ─────┘  app/api/*       │                   │ driver protocol
   │                                                 │                   ▼
   │  src/lib: env · mongodb · auth · services ·     │        ┌──────────────────────────┐
   │           models · hardware · payments          │        │ Locker controller (HTTP) │
   └───────┬──────────────────────────┬──────────────┘        │  door actuation          │
           │ mongoose (pool)          │ HTTPS               └──────────────────────────┘
           ▼                          ▼
   ┌──────────────────┐      ┌────────────────────┐
   │  MongoDB rs0     │      │ Payment gateway    │
   │  whitelabel-keep │      │ (e-wallet / QR)    │
   │                  │      └────────────────────┘
   │  doors           │
   │  transactions ───┼── change stream ──▶ ┌───────────────────────────────┐
   │  sync_queue      │◀── queue rows ──────│ Sync worker                   │
   │  users           │                     │ scripts/sync-worker.ts        │
   │  audit_logs      │                     │ npm run sync                  │
   └──────────────────┘                     └───────────────┬───────────────┘
                                                            │ upsert by transId
                                                            ▼
                                                ┌───────────────────────────┐
                                                │ Online MongoDB cluster    │
                                                └───────────────────────────┘
```

Responsibilities:

| Component | Owns | Never does |
| --- | --- | --- |
| Next.js app (`src/app`, `src/lib`) | Rendering, validation, domain rules, authentication, the booking lifecycle | Talk to the bill acceptor or the locks directly |
| Hardware gateway (`src/server/gateway.ts`) | The device credential, the socket broker, note accounting for the one active session | Persist business data |
| MongoDB (replica set `rs0`) | All state, change streams, the settlement write | — |
| Sync worker (`scripts/sync-worker.ts`) | Forwarding local writes to the online cluster | Change business state |
| Payment gateway | Authoritative e-wallet payment status | Door or booking state |

The gateway is a separate process on purpose: a stalled device or a dead serial port must not block a
page render, and the device credential must not live inside the web request lifecycle. The app and
the gateway share only `HARDWARE_ACCESS_KEY`.

---

## 2. Request and response paths

### 2.1 Cash payment

```
Customer  Browser (client comps)   Next.js server            MongoDB        Gateway        Acceptor
   │            │                        │                     │              │              │
   │ tap door   │  GET /  (RSC: page.tsx)│                     │              │              │
   │───────────▶│───────────────────────▶│ listDoors()         │              │              │
   │            │◀── free doors in HTML ─│────────────────────▶│              │              │
   │            │  navigate /details?doorNumber=…            │              │              │
   │ alias+PIN  │  startBookingAction()  │  (Server Action)    │              │              │
   │───────────▶│───────────────────────▶│ startBooking()      │              │              │
   │            │                        │  Transaction: payment-pending     │              │
   │            │                        │  SyncQueue: insert (pending)      │              │
   │            │                        │────────────────────▶│              │              │
   │            │◀── { ok, transId } ────│                     │              │              │
   │            │  /payment-selection?transId=…              │              │              │
   │ choose cash│  /payment/cash?transId=…  (RSC)           │              │              │
   │───────────▶│───────────────────────▶│ booking must still be payment-pending            │
   │            │◀── <CashPayment> ──────│                     │              │              │
   │            │  GET /api/hardware/token                     │              │              │
   │            │───────────────────────▶│ issueHardwareToken()│              │              │
   │            │◀── short-lived token ──│                     │              │              │
   │            │  socket.io connect(auth:{token})            │              │              │
   │            │──────────────────────────────────────────────────────────▶│ verify HMAC  │
   │            │  billAcceptor:startSession {total,transId,acceptedBills}  │ BillSession  │
   │            │──────────────────────────────────────────────────────────▶│ armed        │
   │ feed 100   │                        │                     │              │◀── note ─────│
   │───────────▶│◀── billAcceptor:onInsert accepted ──────────────────────────│ handleNote   │
   │ feed 200   │                        │                     │              │◀── note ─────│
   │───────────▶│◀── onInsert accepted (remaining = 0) ───────────────────────│ handleNote   │
   │            │  settleBookingAction(transId, CASH, bills)   │              │              │
   │            │───────────────────────▶│ settleBooking()     │              │              │
   │            │                        │  Transaction → ready-for-pickup    │              │
   │            │                        │  Door → occupied                   │              │
   │            │                        │  SyncQueue: update (pending)       │              │
   │            │                        │────────────────────▶│              │              │
   │            │◀── { ok } ─────────────│                     │              │              │
   │            │  locker:openDoor [doorNumber]               │              │              │
   │            │──────────────────────────────────────────────────────────▶│ openDoors()  │
   │            │◀── ack ──────────────────────────────────────────────────────│              │
   │  door opens, receipt shown, kiosk returns home after 8s │              │              │
```

Notes on the failure paths, all of which exist in `src/components/kiosk/cash-payment.tsx`:

- Settlement and door opening are bounded at 20 s each, so the customer is never left on a spinner.
- Each successful step is remembered in a ref, so **Try again** repeats only the step that failed.
- A note that would overshoot is a `hold`: the gateway returns it and the screen explains that the
  exact amount is required. A note outside `ACCEPTED_BILLS` is rejected with the accepted
  denominations listed.
- Cancel ends the hardware session and cancels the unpaid booking; cash already inserted cannot be
  refunded automatically, so the screen says so before the modal confirms.

### 2.2 E-wallet payment

```
Customer  Browser (client comps)   Next.js server            Payment gateway      MongoDB
   │            │                        │                        │                 │
   │ tap door   │  GET /  →  /details  →  startBookingAction      │                 │
   │───────────▶│───────────────────────▶│ Transaction: payment-pending             │
   │            │                        │────────────────────────────────────────▶ │
   │            │  /payment/ewallet?transId=…  (RSC)             │                 │
   │            │───────────────────────▶│ eWalletEnabled? booking still pending?   │
   │            │◀── <EWalletPayment> ───│                        │                 │
   │            │  POST /api/payments {transId, doorNumber, lockerLocation}         │
   │            │───────────────────────▶│ reuse paymentId+QR, else createPayment() │
   │            │                        │  amount = getKioskConfig().effectiveRate │
   │            │                        │  idempotencyKey = transId                │
   │            │                        │───────────────────────▶│                 │
   │            │                        │◀── paymentId, reference, qrPayload ──────│
   │            │                        │  persist paymentId / refNumber on booking│
   │            │                        │────────────────────────────────────────▶ │
   │            │◀── { paymentId, qrPayload, amount, reused } ──│                 │
   │ scan QR    │  render QR (react-qr-code)                   │                 │
   │───────────▶│  GET /api/payments/{paymentId} every 3s       │                 │
   │            │───────────────────────▶│ getPaymentStatus()     │                 │
   │            │                        │───────────────────────▶│                 │
   │            │◀── { status: 'paid' } ─│◀── upstream status ────│                 │
   │            │  settleBookingAction(transId, EWALLET, amount, paymentId, ref)   │
   │            │───────────────────────▶│ Transaction → ready-for-pickup           │
   │            │                        │ Door → occupied, SyncQueue: update       │
   │            │                        │────────────────────────────────────────▶ │
   │            │◀── { ok } ─────────────│                        │                 │
   │            │  locker:openDoor [doorNumber]                 │                 │
   │            │──────────────────────────────────────────────▶ gateway → controller
   │  door opens, reference shown, kiosk returns home after 8s │                 │
```

The browser only ever sees a waiting state. Whether a payment succeeded is decided by the server
after it reads the gateway, and `/api/payments/[paymentId]` returns only the mapped status
(`paid` / `pending` / `failed` / `unknown`) — never the raw upstream body. Polling stops on unmount,
on success, on failure, and after a three-minute overall timeout.

Both flows converge on the same `settleBooking()` service function, so a door cannot be marked
occupied without a recorded payment, and a payment cannot be recorded without taking the door.

### 2.3 Route handlers

| Handler | Purpose |
| --- | --- |
| `GET /api/hardware/token` | Mints the short-lived hardware token; `503` when `HARDWARE_ENABLED=false`. |
| `GET /api/health` | Confirms MongoDB is actually reachable (`getDatabaseStatus()`), reports the hardware driver; `503` when unhealthy. |
| `GET /api/doors` | Door list from the service (never the controller), optional `?status=0\|1` filter. |
| `GET /api/doors/[doorNumber]` | One door, `404` when unknown. |
| `GET /api/transactions` | Booking list; `?doorNumber=` narrows to the open booking. `POST` → `405`. |
| `GET /api/transactions/[transId]` | One booking. `PATCH` performs only the `completed` / `canceled` transitions and requires an operator session (`401` otherwise). |
| `POST /api/payments` | Creates or reuses the e-wallet payment and returns the QR payload. `GET` → `405`. |
| `GET /api/payments/[paymentId]` | Polls the payment status. `POST` → `405`. |
| `GET·POST /api/auth/[...nextauth]` | NextAuth handlers (sign-in, callback, session). |

Every handler returns the uniform envelope from `src/lib/api/response.ts`
(`{ success: true, data }` or `{ success: false, error }`), so a client never has to guess a shape.
All of them declare `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`, because they read live
locker and payment state.

### 2.4 Server Actions

| Module | Actions |
| --- | --- |
| `src/app/actions/booking.ts` | `startBookingAction`, `settleBookingAction`, `completeBookingAction`, `cancelBookingAction` |
| `src/app/actions/door.ts` | `openOccupiedDoorAction` (customer PIN), `syncDoorsAction` (reconcile with the controller), `listDoorsAction` |
| `src/app/actions/admin.ts` | `clearDoorAction`, `rebookDoorAction`, `changeDoorPinAction`, `openAllAndClearAction`, `signOutAction` — each begins with `requireSessionUser()` |

Actions never throw across the client boundary; `runAction` in `src/app/actions/_result.ts` converts
validation, domain (`ServiceError`) and unexpected errors into a discriminated result the kiosk can
branch on, including `UNAUTHORIZED` for a signed-out operator. Successful mutations call
`revalidatePath()` for the affected views.

---

## 3. Server Components vs Client Components

Server Components are the default. A component is a Client Component only when it needs state,
effects, hardware sockets, or the touch interaction itself.

| Route / file | Kind | Why |
| --- | --- | --- |
| `app/layout.tsx` | **Server** | Reads `getKioskConfig()` once per request and hands the serializable subset to `ToastProvider` → `KioskProvider` → `HardwareProvider`. Nothing brand-, price- or endpoint-specific is baked into the bundle. |
| `app/page.tsx` (`/`) | **Server**, `force-dynamic` | Calls `listDoors()` and renders the grid with data already in the HTML — no client fetch, no flash of an empty kiosk. |
| `components/kiosk/door-grid.tsx` | **Client** | Selection is a touch interaction and must navigate with the tapped locker. |
| `components/kiosk/scan-listener.tsx` | **Client** | Listens for the barcode-scanner shortcut (`ADMIN_SCAN_CODE`) on window key events. |
| `app/details/page.tsx` (`/details`) | **Server**, `force-dynamic` | Resolves the door and any open booking server-side, `redirect('/')` when there is no door, `notFound()` when it is unknown. Query values are treated as hints only: the door record stays authoritative. |
| `components/kiosk/details-form.tsx` | **Client** | Collects alias and PIN and calls `startBookingAction`, `openOccupiedDoorAction` or `completeBookingAction` depending on the live door state. |
| `app/payment-selection/page.tsx` | **Server**, `force-dynamic` | Resolves the booking so a stale `transId` cannot carry the customer into a payment flow with nothing to settle; a booking that belongs to another door redirects home. |
| `components/kiosk/payment-method-picker.tsx` | **Client** | Reads `billAcceptorEnabled` / `eWalletEnabled` from `useKiosk()` and routes to the chosen method. |
| `app/payment/cash/page.tsx` | **Server**, `force-dynamic` | Re-checks that the booking is still `payment-pending` **before** any hardware code can run; otherwise redirects back to `/payment-selection`. |
| `components/kiosk/cash-payment.tsx` | **Client** | Holds the acceptor session, reacts to insert events, shows the emulator controls, and settles the booking. |
| `app/payment/ewallet/page.tsx` | **Server**, `force-dynamic` | Decides whether the QR flow may run at all (`eWalletEnabled`) and resolves the booking before the client talks to the gateway. |
| `components/kiosk/ewallet-payment.tsx` | **Client** | Renders the QR, polls the status handler, stops polling on unmount, and settles the booking. |
| `components/kiosk/payment-success.tsx` | **Client** | Counts down to the automatic return home. |
| `app/admin/login/page.tsx` | **Server** shell + `components/admin/login-form.tsx` (**Client**) | The form needs submission state and error feedback; the page itself has nothing to read. |
| `app/admin/(protected)/**` | **Server**, `force-dynamic` | Dashboard, `clear`, `rebook`, `change-pin` and `forgot-pin` read MongoDB for the signed-in operator. Authorisation lives in `app/admin/(protected)/layout.tsx`, which redirects to `/admin/login` when there is no session — so anything inside the group has a session before its page runs. `forgot-pin` deliberately never renders a PIN. |
| `components/admin/*` | **Client** | Action buttons, the change-PIN form and the sign-out/nav controls need pending and error state. |
| `components/ui/*` | Mixed | Presentational primitives; the interactive ones (button, keypad, modal, toast, pin-display) are client components, the static ones are not. |

Mutation is never a client-side `fetch` to an unprotected endpoint: form mutations go through Server
Actions, which run in the same request/session context, and only the handlers in §2.3 are public.

### Where `useEffect` and `useContext` are used, and why

`src/lib/hardware/client.ts` is the browser-side hardware client: it wraps one socket.io connection
and exposes commands (`startBillSession`, `endBillSession`, `rejectBill`, `feedNote`, `openDoors`)
that resolve to acknowledgements.

**`useContext`** — `src/context/hardware-provider.tsx` owns the single `HardwareClient` and publishes
commands plus a `subscribeToInserts()` fan-out through `HardwareContext`; `useHardware()` throws
outside the provider. Context is the right tool because many nested Client Components (the cash
screen, the success panel, the emulator controls) need the same socket, and prop-drilling a socket
through Server Component boundaries is impossible; it also guarantees exactly one socket per kiosk
tab. `src/context/kiosk-provider.tsx` does the same for the serializable kiosk configuration, so a
client component reads price, currency, PIN length and accepted denominations from `useKiosk()`
instead of from `process.env`. `src/context/toast-provider.tsx` shares transient notifications.

**`useEffect`** — in `hardware-provider.tsx`, one effect creates the client and tears it down on
unmount (clearing subscribers, disconnecting the socket and resetting `connected`/`driver`), which
is what stops a kiosk that is closed mid-payment from leaving the acceptor armed; another path
(`refreshDriver`) queries `billAcceptorStatus` after each connection so the UI knows whether it is
talking to the `mock` emulator. In `src/hooks/use-bill-session.ts`, one effect registers the single
insert subscription and removes it on cleanup, and a second effect abandons a live session when the
screen goes away. In `src/hooks/use-idle-timeout.ts`, an effect owns the ticking interval and the
passive `pointerdown` / `touchstart` / `wheel` / `keydown` listeners that restart the clock, and
removes all of them on cleanup — the kiosk must return home on its own after `IDLE_TIMEOUT_SECONDS`.
`src/hooks/use-countdown.ts` drives the success-screen countdown, `use-network.ts` mirrors
`navigator.onLine` for the "this kiosk looks offline" warning, and `use-scan-code.ts` feeds the
scanner listener. `cash-payment.tsx` and `ewallet-payment.tsx` also use effects to keep refs
pointing at the latest completion routine so the gateway subscription never has to be rebuilt
mid-session.

Deliberately **not** in React state: the amount owed, the accepted denominations, and whether a
payment succeeded. Those are server-side facts; the client only displays what the gateway or a
Server Action last told it.

---

## 4. Data model

One MongoDB database (`whitelabel-keep` by default) holds five collections. Object references are
business identifiers (`doorNumber`, `transId`), not `ObjectId`s, so a document is meaningful in
isolation and survives the offline → online copy.

### `doors` — live state of each physical door

| Field | Notes |
| --- | --- |
| `doorNumber` | **Unique**, trimmed. The business key. |
| `lockerLocation` | Site/location label, e.g. `1000`. |
| `doorSize` | `S` \| `M` \| `L`, default `L`. |
| `doorStatus` | `0` free, `1` occupied. |
| `alias` | Customer-chosen label (≤ 8 chars by default). |
| `payType` | `''` \| `CASH` \| `EWALLET` \| `PROMO`. |
| `mpin` | Customer PIN. **`select: false`** so it cannot leak into a list response. |
| `currentTransactionId` | The `transId` holding the door. |
| `amount`, `openCount`, `timeIn`, `timeOut`, `isActive` | Stay accounting and utilisation. |

Indexes: `{ doorStatus: 1, lockerLocation: 1 }` (the home screen's "free doors here" query) and
`{ currentTransactionId: 1 }`. Timestamps are enabled.

### `transactions` — one booking and its payment lifecycle

| Field | Notes |
| --- | --- |
| `transId` | **Unique**. Business reference, e.g. `REF-12-1730000000000`. |
| `doorNumber`, `lockerLocation`, `doorSize`, `alias` | Frozen copy of the door context at booking time. |
| `qpin` | Customer PIN. **`select: false`**. |
| `payType`, `paymentMethod` | `CASH`/`EWALLET`/`PROMO` and the lower-case method. |
| `amount` | Settled amount. |
| `bookingStatus` | `payment-pending` → `ready-for-pickup` → `completed`, or `canceled` / `cleared`. |
| `transStatus` | Legacy-compatible free text (`Active`, `Completed`, `Cleared`). |
| `timeIn`, `timeOut` | Stay window. |
| `bills` | `[{ denomination, count }]` cash breakdown. |
| `refNumber`, `paymentId` | Gateway reference and payment id; the payment handler reuses an in-flight `paymentId` so a retry cannot create a second charge. |
| `idempotencyKey` | Guards against a retried request creating a second booking. |
| `posted`, `postedAt` | Export/posting marker for downstream accounting. |

Indexes: `{ bookingStatus: 1, createdAt: -1 }` (operator lists), `{ doorNumber: 1, bookingStatus: 1 }`
(is this door open?), `{ posted: 1, createdAt: 1 }` (posting sweep) and a **sparse**
`{ idempotencyKey: 1 }`. Timestamps are enabled.

### `sync_queue` — write-ahead log for the offline → online sync

| Field | Notes |
| --- | --- |
| `changeType` | `insert` \| `update` \| `delete` \| `replace`. |
| `sourceCollection` | Always `transactions` today. |
| `documentId` | The document's `_id`, for traceability. |
| `document` | The full post-image (`Mixed`). `_id` / `__v` are stripped before forwarding. |
| `status` | `pending` \| `synced` \| `failed`. |
| `retryCount`, `lastError`, `syncedAt` | Retry bookkeeping. |

Indexes: `{ status: 1, createdAt: 1 }` (the worker's batch query) and a 30-day **TTL** on
`createdAt`, so the log cannot grow without bound on a kiosk that has been offline for months.

### `users` — operator accounts

`email` (**unique**, lower-cased), `name`, `passwordHash` (**`select: false`**), `role`
(`admin` \| `operator`), `isActive`, `lastLoginAt`.

### `audit_logs` — append-only record of privileged actions

`action`, `actorId`, `actorEmail`, `targetType` (`door` \| `transaction` \| `user` \| `system`),
`targetId`, `metadata`, `succeeded`, `errorMessage`. Indexes: `{ createdAt: -1 }` and
`{ targetType: 1, targetId: 1, createdAt: -1 }`. PIN changes record the *fact* of the change only —
never the PIN itself.

---

## 5. Security model

### Where the device credential lives

`HARDWARE_ACCESS_KEY` exists only in the server environment of the **gateway process**. It is used
for two things:

1. authenticating the gateway to a physical controller (the `socketio` driver), and
2. signing the short-lived tokens a browser must present to connect.

The browser never receives it. The project defines no `NEXT_PUBLIC_*` variables, so Next.js has
nothing to inline into the client bundle; the only browser-visible configuration is the serializable
subset produced by `getKioskConfig()` on the server. The legacy application shipped the hardware key
as `NEXT_PUBLIC_HARDWARE_ACCESS_KEY`, which let anyone who loaded the kiosk page command the locks —
that is the specific mistake this design removes. The same reasoning moved e-wallet payments out of
the browser: `src/lib/payments/gateway.ts` is server-only, and the amount charged comes from
`getKioskConfig().effectiveRate`, never from the request body.

### Why hardware tokens are short-lived

The browser authenticates to the gateway with an HMAC-SHA256 token minted by
`GET /api/hardware/token` (`src/lib/hardware/token.ts`):

```
base64url({ iat, exp, sid, scope: 'kiosk' }) + '.' + HMAC_SHA256(key, payload)
```

- **Bounded exposure.** `exp` is `HARDWARE_SESSION_TTL_SECONDS` (300 by default) after issue, so a
  token scraped out of a kiosk browser is useless minutes later. A long-lived browser credential
  would stay valid until someone rotated it.
- **Signed, not stored.** The gateway verifies the signature with `timingSafeEqual`, then the expiry
  and `scope`, so it needs no session table and no database round-trip on connect.
- **Just enough authority.** The scope is `kiosk`: it allows starting a note-intake session and
  opening doors. It cannot read data, mutate records, or reach the online cluster.
- **Bound to a session id.** `sid` makes a token identifiable in gateway logs, so a suspicious kiosk
  can be traced without logging the token itself.
- **Fails closed.** An unverifiable, expired or malformed token is rejected at the socket handshake
  (`io.use`), before any command handler exists. With `HARDWARE_ENABLED=false` the token endpoint
  answers `503` and every socket is refused.

### How admin routes are protected

Operator authentication is NextAuth v5 with a Credentials provider (`src/lib/auth.ts`):

- **Password storage.** `npm run seed` stores a bcrypt hash (10 rounds) and never the plaintext.
  `passwordHash` is `select: false`, so it is absent from ordinary queries; the sign-in path asks for
  it explicitly with `.select('+passwordHash')`.
- **Verification.** Submitted credentials are parsed with Zod, the user is looked up with
  `isActive: true`, and the password is compared with `bcrypt.compare`. Any failure returns `null`,
  which NextAuth turns into a generic sign-in error — the response does not reveal whether the email
  exists.
- **Session.** Sessions are JWTs (no adapter tables), `maxAge` 12 hours, signed with `AUTH_SECRET`.
  Role and user id are copied into the token and surfaced on the session.
- **Enforcement is server-side, at three layers.** `app/admin/(protected)/layout.tsx` redirects an
  unauthenticated visitor to `/admin/login` before any protected page runs; every operator Server
  Action begins with `requireSessionUser()`; and `PATCH /api/transactions/[transId]` returns `401`
  rather than trusting the caller. Because the checks live in the server layer, a forgotten client
  guard cannot expose the operator area.
- **Secret hygiene.** `AUTH_SECRET`, `MONGODB_URI`, `HARDWARE_ACCESS_KEY` and the payment gateway
  URLs live in the server environment only. `validateServerEnv()` warns at boot when the secret is
  missing or still the placeholder, when `socketio` is selected without an access key, and when the
  payment gateway is enabled without a URL.
- **Reduced blast radius elsewhere.** Mongoose runs with `bufferCommands: false` and short timeouts,
  so a dead database fails fast instead of hanging a kiosk; `mongoose` and `mongodb` are listed in
  `serverExternalPackages` so they cannot be pulled into a client bundle; the app sends
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin` on every response; and
  `/api/payments/[paymentId]` returns a mapped status instead of proxying the gateway body.

### Trust summary

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Customer / browser | Choosing a door, entering an alias and PIN, feeding notes | Amounts, prices, whether a payment succeeded, the device credential |
| Hardware gateway | Note accounting, door actuation, token verification | Business state, persistence |
| Payment gateway | Payment authorisation | Door or booking state |
| Operator session | Door clearing, rebooking, PIN change, reporting | Direct database access; every privileged action is audited |
| Sync worker | Forwarding documents to the online cluster | Business decisions |
