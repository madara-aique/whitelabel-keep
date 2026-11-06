# Legacy Spec Sheet — `details/index.js` and `payment/index.js`

Source app: `ek_frontend_cash_v2` — Next.js 13.5.11 Pages Router, plain JS/React 18.2.0, `reactStrictMode: false`, bootstrap 5 + custom `globals.css`, global `_app.js` wrapping every page in `AppProvider` → `WebSocketProvider` → `Layout`.

---

# FILE A — `src/pages/details/index.js`

Route: `/details`. Component name `InputDetails` (default export). 657 lines.

## 1. Purpose

The **"enter your name + choose your PIN"** screen — and, for an already-rented door, the **re-entry / end-transaction** screen. It sits between the locker-selection/door scan step and the payment step.

Two mutually exclusive modes keyed off the `doorStatus` query param:

* `doorStatus == 0` → **New rental.** User types a locker name (alias) and a 6-digit PIN, then `Next` → `/paymentselection` (or, during an active promo window, immediately provisions a free `PROMO` transaction and opens the door).
* `doorStatus == 1` → **Existing/occupied locker.** Alias is shown read-only (comes from `lockerAlias` query param). User enters their 6-digit PIN and picks one of two options: **End transaction** (→ confirmation modal → close out + open door) or **Open Locker** (→ increment `doorOpenCount` + open door).

The page never renders anything before `router.query` is populated (see §9 Quirk 1).

## 2. State

All state is local; there is no `useRef`, `useMemo`, `useReducer`, or global store read other than context.

| # | Variable | Declaration | Type | Initial | How it changes |
|---|---|---|---|---|---|
| 1 | `alias` | `useState(null)` | `string \| null \| undefined` | `null` | `handleAliasChange` → sanitized string (letters only, `""` allowed). Effect #2 sets it to `lockerAlias` (a **query param**, therefore `string \| string[] \| undefined`) whenever `doorStatus == 1`. Bound to the `<input value={alias || ""}>`. |
| 2 | `pin` | `useState([])` | **`string[]` at first, then `string`** — a real type union. | `[]` (empty array) | Only mutated via `setPin` passed to `<Keyboard>`. `Keyboard` calls `setPin(quickpin)` where `quickpin` is a **string** (`[...prev, e].join("")` for append, `.slice(0,-1)` for backspace, `""` for clear). So after the first keypress `pin` is `"1"`, etc. `pin.length` is therefore valid in both shapes; `pin[0..5]` indexes to `undefined` while it is still `[]`. |
| 3 | `disable` | `useState(true)` | `boolean` | `true` | `false` only when the effect #2 validity predicate passes. Set `true` at the start of `handleEnd`, on common-PIN rejection, and when the predicate fails. Controls the **Next** button and both modal buttons. |
| 4 | `disableBack` | `useState(false)` | `boolean` | `false` | Set `true` at the very start of `proceedToNextPage` **and** `handlePromo` (locks the UI while async work runs). Reset to `false` in `closeModal`, and on validation failures (PIN mismatch, common PIN). Controls **Back**, **VIEW**, and both option buttons. |
| 5 | `disabledText` | `useState(false)` | `boolean` | `false` | Set once to `true` by effect #2 when `doorStatus == 1`, making the alias input read-only. |
| 6 | `disableKey` | `useState(false)` | `boolean` | `false` | Passed to `<Keyboard disableKey={disableKey} />` as the prop named `setDisableKey`. In `Keyboard`, the effect `if (setDisableKey === false) clear()` wipes the keyboard buffer. Set `false` on common-PIN rejection and in `closeModal` (both intentionally clear the panel). Never set to `true` in this file. |
| 7 | `password` | `useState(0)` | `number` (0 \| 1) | `0` | Toggled by `tickPassword()`: `0 → 1` sets `view=false`; `1 → 0` sets `view=true`. It is also listed as a dependency of effect #2 even though effect #2 never reads it. |
| 8 | `chosenOption` | `useState(0)` | `number` (0 \| 1 \| 2) | `0` | `selectOption(e)` sets `1` (End transaction) or `2` (Open Locker). `0` = nothing chosen. Gates the Next button in `doorStatus == 1` mode and branches inside `proceedToNextPage`. |
| 9 | `view` | `useState(true)` | `boolean` | `true` | `true` ⇒ every PIN digit `<span>` gets `className="view"` (CSS masks the glyph). `false` ⇒ raw digits visible. Toggled only by `tickPassword`. |
| 10 | `gohome` | `useState(false)` | `boolean` | `false` | `selectOption(1)` sets `true` (and `cont=false`). Drives the selected styling of the "End transaction" card. |
| 11 | `cont` | `useState(false)` | `boolean` | `false` | `selectOption(2)` sets `true` (and `gohome=false`). Drives the selected styling of the "Open Locker" card. |
| 12 | `error` | `useState()` | **`ReactNode \| undefined`** — a mix of plain `string` and JSX `<div className="text-danger">…</div>` | `undefined` | Set as a string (`Set 6-digit PIN for Door # ${doorNumber}` / `"Enter 6-digit PIN"`) by effects #2/#3, and as JSX by the two error branches of `handleEnd`/`proceedToNextPage`. Rendered directly inside `<div className="fs-25 text-dark font-semibold mt-5">{error}</div>`. |
| 13 | `modalVisible` | `useState(false)` | `boolean` | `false` | `true` when a valid PIN is submitted with `chosenOption == 1`. `false` via `closeModal`. Controls the `End your transaction?` modal. |
| 14 | `isSuccessModalVisible` | `useState(false)` | `boolean` | `false` | Set `true` by `handlePromo` only. Controls the full-screen `Door Opening...` loader overlay. Never reset. |

Derived values computed on **every render** (not memoized, not state):

* `router`, and from `router.query`: `doorNumber`, `lockerLocation`, `doorStatus`, `lockerAlias`.
* `promoEndDate = process.env.NEXT_PUBLIC_PROMO_END_DATE` (line 30). A commented-out `promoStartDate` read from `NEXT_PUBLIC_PROMO_START_DATE` sits at lines 27–28.
* `currentDate = new Date()` (line 31) — **re-created on every render**, and captured by `handlePromo`'s closure.
* `loaderStyle = { height: 150, width: 150 }` (used for every Lottie on the page, including the small option-card animations).
* Context: `const { localDatabaseUrl } = useAppContext()` — resolves to `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO` when `isPromoActive()` is true, else `NEXT_PUBLIC_LOCAL_URL_DATABASE`.

## 3. Effects

**Effect #1 (lines 367–371) — mount only, `[]`**
```js
endBillSession().catch(err => console.error("Details mount: endBillSession failed:", err));
```
Purpose (per the in-file comment): tear down any lingering bill-acceptor session left by a previous user, because `cashpayment` calls `endBillSession()` inside an async countdown redirect and the hardware can be left stale. No cleanup function. Runs once on mount; does **not** re-run on query changes.

**Effect #2 (lines 373–397) — deps `[alias, pin, password, chosenOption]`**
```
if (alias != null) {
  if (doorStatus == 0) {
    if (pin.length == 6 && alias.length > 1) setDisable(false);
    else { setDisable(true); setError(`Set 6-digit PIN for Door # ${doorNumber}`); }
  } else if (doorStatus == 1) {
    if (pin.length == 6 && chosenOption != 0) setDisable(false);
    else { setDisable(true); setError(`Enter 6-digit PIN`); }
  }
} else {
  setError(`Set 6-digit PIN for Door # ${doorNumber}`);
}
if (doorStatus == 1) { setAlias(lockerAlias); setDisabledText(true); }
```
* `doorStatus` is a **string** from the query, compared with `==` (loose) so `"0" == 0` and `"1" == 1` hold.
* The `setAlias(lockerAlias)` at the end re-runs the effect (alias is a dep). If `lockerAlias` is `undefined`, `alias` becomes `undefined`, which then fails the `alias != null` guard on the next pass and forces the "Set 6-digit PIN…" error text even in occupied mode.
* `password` is a dependency but is never read in the body — it exists only to force re-evaluation when the VIEW toggle is pressed.
* No cleanup.

**Effect #3 (lines 399–405) — mount only, `[]`**
```
if (doorStatus === 0) setError(`Set 6-digit PIN for Door # ${doorNumber}`);
else if (doorStatus === 1) setError(`Enter 6-digit PIN`);
```
Strict `===` here. Because effects run in declaration order, on mount this runs **after** effect #2 and therefore overwrites whatever effect #2 just set. It also captures `doorStatus` from the first render, which in this app is `undefined` on the initial client render for a static page (no `getServerSideProps`), so it typically sets nothing (see §9 Quirk 1).

There are **no** `setInterval`/`setTimeout`/`requestAnimationFrame`/event-listener registrations on this page.

## 4. Data & APIs

### Context

* `useAppContext()` → `{ localDatabaseUrl }`; switches between the promo and normal local json-server databases (`src/context/app.js`).

### HTTP — json-server "local database" (`LocalDatabase` collection of doors)

1. **GET** `` `${localDatabaseUrl}?alias=${alias}&mpin=${pin}&doorNumber=${doorNumber}` `` — used three times with identical URL shape: in `handleEnd`, and in both `chosenOption` branches of `proceedToNextPage`.
   * Success contract used: `res.data` is an **array**; `res.data.length == 1` means "PIN matches this locker and alias". Fields read off `res.data[0]`: `refNumber`, `lockerLocation`, `doorSize`, `doorStatus`, `paymentStatus`, `payType`, `amount`, `doorOpenCount`, `mpin`, `timeIn`, `alias`, `doorNumber`, `billsCounter`.
   * `console.log('res', res.data[0])` on every call in `handleEnd`.
2. **PATCH** `` `${localDatabaseUrl}/${doorNumber}` `` — the door record reset. Two distinct bodies:

   *Reset after ending a transaction* (`handleEnd`):
   ```js
   { transID: "", lockerLocation, doorSize: "L", doorStatus: 0, paymentStatus: "",
     payType: res.data[0].payType, amount: "", doorOpenCount: "", mpin: "",
     timeIn: "", timeOut: "", alias: "", id: doorNumber, doorNumber,
     refNumber: "", transStatus: "Completed" }
   ```
   Note `lockerLocation` here comes from the **router query**, not from the server record. Returns are ignored; no `.catch`.

   *`openCount` increment* (`chosenOption == 2`): `{ doorOpenCount: Number(res.data[0].doorOpenCount) + 1 }`.

   *Promo provisioning* (`handlePromo`) — the full `reqBody` (see §7).

### HTTP — local json-server auxiliary collections (write-behind / fallback queues)

3. **POST** `` `${process.env.NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS}` `` (`handleEnd`) with:
   `{ transID, lockerLocation, doorSize, doorStatus, paymentStatus, payType, amount, doorOpenCount, mpin, timeIn, timeOut: new Date().toISOString(), alias, id: refNumber, doorNumber, refNumber, transStatus: "Completed", billsCounter }` — every field from `res.data[0]` except `timeOut`/`transStatus`/`id` (id is set to `refNumber`). No `.catch`; the following PATCH is nested inside its `.then` and is not awaited.
4. **POST** `` `${process.env.NEXT_PUBLIC_LOCAL_URL_FOR_PATCHING}` `` — **only in the `.catch` of the online PATCH** (#5). Body: `{ id: res.data[0].refNumber, lockerLocation, qpin: res.data[0].mpin, timeOut: new Date().toISOString(), doorNumber, transStatus: "Completed", refNum: refNumber, refNumber }`. This is the offline fallback queue for a failed remote patch.

### HTTP — Pandora backend (online API)

5. **PATCH** `` `${process.env.NEXT_PUBLIC_API_URL_PATCH}` `` (`handleEnd`) — body `{ lockerLocation, qpin: res.data[0].mpin, timeOut: new Date().toISOString(), doorNumber, transStatus: "Completed", refNum: res.data[0].refNumber, refNumber: res.data[0].refNumber }`.
6. **POST** `` `process.env.NEXT_PUBLIC_API_URL_POST` `` (`handlePromo`) — body is the promo `reqBody` spread plus `refNum: \`PROMO-${doorNumber}-${localTimeIn}\`` and `promoEndDate`. Because `refNum` and `promoEndDate` are appended after the spread, the **local** record gets the `timeIn`-based `refNum` and the **remote** record gets the `localTimeIn`-based one (see §7).

### HTTP — locker controller hardware

7. **GET** `` `${process.env.NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN}/${doorNumber}/open` `` — fire-and-forget, no `.then`/`.catch`, called after (a) a successful end-of-transaction, (b) a successful `Open Locker`, (c) a promo provision.

### Next.js API routes (MongoDB via Mongoose)

8. **GET** `` `/api/transactions?doorNumber=${doorNumber}` `` → `{ success: boolean, data?: { transID, ... } }`. On `result.success && result.data?.transID`, the page then issues:
9. **PATCH** `` `/api/transactions/${result.data.transID}` `` with `Content-Type: application/json`, body `{ bookingStatus: "completed", timeOut: new Date().toISOString() }`.
   * `.catch(err => console.error("MongoDB complete failed:", err))` on the PATCH, `.catch(err => console.error("MongoDB lookup failed:", err))` on the lookup. **No UI feedback on failure.**
   * The route (`src/pages/api/transactions.js` / `[transID].js`) requires `MONGODB_URI`, model `Transaction`; GET finds `{ doorNumber, bookingStatus: { $nin: ["completed","canceled","cleared"] } }` sorted by `createdAt: -1`, 404 when absent; PATCH respects an explicit `bookingStatus` and otherwise defaults to `"ready-for-pickup"`.

### Sockets / hardware

* `endBillSession()` from `@/utils/hardwareClient` — Socket.IO client (`hardware-controller-sdk/client`) targeting `${window.location.protocol}//${window.location.hostname}:${NEXT_PUBLIC_HARDWARE_SOCKET_PORT || window.location.port}` with token `NEXT_PUBLIC_HARDWARE_ACCESS_KEY`. Called once on mount (effect #1).
* No WebSocket/`useWebSocket` usage on this page.

### Mongo/Mongoose

No direct driver usage in the component; all persistence goes through the two Next API routes above.

## 5. Rendering

Root: a `<>` fragment containing, in order:

**(a) Promo success overlay** — rendered when `isSuccessModalVisible` is true, else the empty string `""`:
```
<div className="end-modal-bg ">                       // note trailing space
  <div className="end-modal fade-in-top"
       style={{ width:"55%", height:"25%", borderRadius:"10px",
                position:"absolute", top:"20%", left:"5%", padding:120 }}>
    <div className="d-flex row flex-column justify-content-center w-150">
      <Player src={loader} loop autoplay style={loaderStyle} speed={1} />
      <div className="text-center fs-40">Door Opening...</div>
    </div>
  </div>
</div>
```

**(b) End-transaction confirmation modal** — when `modalVisible`, else `""`:
```
<div className="end-modal-bg">
  <div className="end-modal fade-in-top">
    <div className="d-flex flex-column">
      <div className="align-self-center"><Image src={qubee} /></div>   // no alt prop
      <div className="text-center font-bold fs-60 pt-5">End your transaction?</div>
      <div className="text-center font-regular fs-31 p-cancel">
        Please make sure that you have retrieved all items before leaving the park.
      </div>
      <div className="text-center pt-5 p-cancel-btn font-regular">
        <button className="bg-white p-5 border border-success fs-31 text-success m-2"
                onClick={closeModal} disabled={disable}>Cancel</button>
        <button className="btn-gradients p-5 fs-31 text-light border-0 m-2"
                onClick={handleEnd} disabled={disable}>Confirm</button>
      </div>
    </div>
  </div>
</div>
```

**(c) Main card** `<div className="bg-light text-dark rounded mt-5 container p-5 py-2 pb-5">`:

1. Empty spacer: `<div className="p-3 fs-31 base-color font-semibold text-center"></div>`.
2. **Alias block** — an IIFE returning JSX per `doorStatus`:
   * `doorStatus == 0`:
     * Label row `<div className="fs-25 text-dark font-semibold d-flex justify-content-between align-items-center">` → text `Enter your name` then `<small className="text-danger fs-18">*Maximum of 8 characters</small>`.
     * `<div className="mt-4"><input type="text" disabled={disabledText}
        className="p-3 rounded border-dark col-md-12 fs-31 font-semibold opacity-75 text-uppercase"
        placeholder="Tap to enter name" onChange={handleAliasChange} maxLength={8} value={alias || ""} /></div>`
   * `doorStatus == 1`: label `<div className="fs-25 text-dark font-semibold d-flex justify-content-between align-items-center">Locker name</div>` and the same `<input>` markup but **without** `placeholder` and `maxLength`, still `disabled={disabledText}`.
   * any other value: nothing.
3. **Error line**: `<div className="fs-25 text-dark font-semibold mt-5">{error}</div>`.
4. **PIN row**: `<div className="mt-4 d-flex justify-content-between align-items-center">` containing exactly **six** identical boxes
   `className="border border-dark p-4 rounded pin fs-31 text-center font-semibold pin-text d-flex align-items-center justify-content-center"` each wrapping `<span className={view ? "view" : ""}>{pin[0]}</span>` … `{pin[5]}`, then a seventh cell:
   `<button disabled={disableBack} className="p-4 rounded pin border-0 pin-text btn-gradients text-light fs-21 font-semibold" onClick={() => tickPassword()}>VIEW</button>`.
5. `<Keyboard setPin={setPin} disableKey={disableKey} />`.
6. **Option cards** — IIFE: nothing for `doorStatus == 0`; for `doorStatus == 1`:
   `<div className="d-flex justify-content-between align-items-center col-md-12 mt-5">` with two `col-md-6` halves.
   * Left: `<button disabled={disableBack}` `className={gohome ? "btn-gradients rounded border-0 d-flex justify-content-between align-items-center gohome" : "bg-light rounded d-flex justify-content-between align-items-center gohome"}` `onClick={() => selectOption(1)}`; inside: `<div className="col-md-4"><Player src={goHome} loop autoplay style={loaderStyle} /></div>` and `<div className="col-md-8 fs-21 font-semibold p-4 ">` containing `<span className={gohome ? "text-light font-bold" : "base-color font-bold"}> End transaction </span>` and `<div className={gohome ? "text-light" : "text-dark"}><small className="fs-16">Please ensure to retrieve all items before leaving the park.</small></div>`.
   * Right: same structure with `cont`, `onClick={() => selectOption(2)}`, `Player src={continueUsingLocker}`, `<span>` text `Open Locker`, and `<small>Enjoy your whole-day access with the locker.</small>` (this one has **no** `fs-16` class).
7. **Footer** `<div className="text-center mt-5">`:
   * `<button className="bg-light p-5 border border-success fs-31 text-success m-2" disabled={disableBack} onClick={() => handleBack()}>Back</button>`
   * `<button className="btn-gradients p-5 fs-31 text-light border-0 m-2" onClick={() => proceedToNextPage()} disabled={disable}>Next</button>`

**Exact user-visible strings** on this page: `Door Opening...`, `End your transaction?`, `Please make sure that you have retrieved all items before leaving the park.`, `Cancel`, `Confirm`, `Enter your name`, `*Maximum of 8 characters`, `Tap to enter name` (placeholder), `Locker name`, `VIEW`, ` End transaction `, `Please ensure to retrieve all items before leaving the park.`, `Open Locker`, `Enjoy your whole-day access with the locker.`, `Back`, `Next`, `Pin does not match the locker name you have entered.`, `Cannot set common pin`, `Set 6-digit PIN for Door # ${doorNumber}`, `Enter 6-digit PIN`.

## 6. User interactions

| Handler | Trigger | Behaviour |
|---|---|---|
| `handleAliasChange(e)` | `onChange` of the alias input | `e.target.value.replace(/[^a-zA-Z]/g, "")` → `setAlias`. Digits, spaces, punctuation and accents are stripped live. Max 8 chars enforced by `maxLength`. |
| `tickPassword()` | `VIEW` button (line 548) | `password 0 → 1`, `view=false` (reveal digits); `password 1 → 0`, `view=true` (mask). |
| `handleClick(val.keyID)` / `backSpace()` / `clear()` | inside `Keyboard` | Append digit (0–9) to the string buffer; backspace removes last char; "Clear all" empties it. `Keyboard` pushes the buffer up via `setPin` on every change, and self-disables the digit keys once `quickpin.length === 6`. |
| `selectOption(1)` | "End transaction" card | `gohome=true`, `cont=false`, `chosenOption=1`. |
| `selectOption(2)` | "Open Locker" card | `gohome=false`, `cont=true`, `chosenOption=2`. |
| `proceedToNextPage()` | `Next` button | See §7. |
| `handleBack()` | `Back` button | `router.push("/")` (plain string form, no query). |
| `closeModal()` | modal `Cancel` | `setModalVisible(false)`, `setDisable(false)`, `setDisableBack(false)`, `setDisableKey(false)` (the last one clears the keyboard buffer). |
| `handleEnd()` | modal `Confirm` | See §7. |

**Keyboard shortcuts: none.** There are no `window`/`document` keydown listeners, no scan-gun hook (`use-scan-detection` is a project dep but unused here), no focus management.

Disabled-state matrix: `Next` ← `disable`; `Back`, `VIEW`, both option cards ← `disableBack`; modal `Cancel`/`Confirm` ← `disable`; alias input ← `disabledText`; digit keys ← `Keyboard`'s internal `disableKeys` (after 6 digits).

## 7. Business rules

**Validation / gating (effect #2)**
* New rental: `pin.length == 6 && alias.length > 1` → Next enabled. Note `alias.length > 1` means a **single-character** name is rejected.
* Occupied: `pin.length == 6 && chosenOption != 0` → Next enabled.
* When `alias == null`, the error text is always `Set 6-digit PIN for Door # ${doorNumber}` (note the `${doorNumber}` may render as `undefined` before the router is ready).

**Common-PIN blocklist** (`proceedToNextPage`, `doorStatus == 0` path) — exact literal list:
`"123456"`, `"654321"`, `"111111"`, `"222222"`, `"333333"`, `"444444"`, `"555555"`, `"666666"`, `"777777"`, `"888888"`, `"999999"`, `"000000"`, `"567890"`, `"098765"`.
On match: error `Cannot set common pin`, then `setDisable(true)`, `setDisableKey(false)` (clears the keyboard), `setDisableBack(false)`. **The input is deliberately left enabled so the user can retype.** Because `pin` is compared with `===` to string literals, the check only works once `Keyboard` has produced a string.

**`proceedToNextPage()` control flow**
```
setDisableBack(true)
if (doorStatus == 0):
    if pin in COMMON_PINS            -> error UI, disable Next, clear keyboard, unlock Back
    else if isPromoActive()          -> handlePromo()
    else                             -> router.push({pathname:"/paymentselection",
                                         query:{doorNumber, lockerLocation, pin, alias}},
                                       "/paymentselection", undefined, {shallow:true})
else if (doorStatus == 1):
    try
      if chosenOption == 2:  GET pin-check
            length==1 -> PATCH {doorOpenCount: Number(current)+1}
                      -> router.push home -> GET door/open
            else      -> setError("PIN does not match …"), setDisableBack(false)
            .catch(err => console.log(err))     // Back stays locked on network error
      else if chosenOption == 1: GET pin-check
            length==1 -> setModalVisible(true)
            else      -> setError("PIN does not match …"), setDisableBack(false)
            // no .catch -> unhandled rejection if the GET fails
      // chosenOption == 0 -> nothing happens; Next/Back remain locked
    catch (error) { console.log(error) }
```
`isPromoActive()` (`src/utils/isPromoActive.js`): compares ISO strings — `now >= (NEXT_PUBLIC_PROMO_START_DATE || "1970-01-01T00:00:00.000Z")` **and** `now <= (NEXT_PUBLIC_PROMO_END_DATE || "1970-01-01T00:00:00.000Z")`. With unset env vars the window is the epoch and the function returns `false`.

**`handleEnd()` — end-of-transaction (doorStatus == 1, option 1, modal Confirm)**
1. `d = new Date(); dateNow = d.toISOString()` (**`dateNow` is dead — never used**) and `setDisable(true)`.
2. GET the local record. If `res.data.length != 1` → `setError(<div className="text-danger">PIN does not match the locker name you have entered.</div>)`, `setDisable(false)`, `setDisableBack(false)`; done.
3. On match, in parallel (none of these are awaited):
   * POST to `NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS` (archive record) → then PATCH the door record back to empty/`doorStatus: 0` with `transStatus: "Completed"`.
   * PATCH the online `NEXT_PUBLIC_API_URL_PATCH`, falling back to POST `NEXT_PUBLIC_LOCAL_URL_FOR_PATCHING` on failure.
   * Mongo: look up the active transaction by `doorNumber`, then PATCH it to `bookingStatus: "completed"` with `timeOut`.
   * `router.push({pathname:"/"}, "/", undefined, {shallow:true})` — the 4th argument is ignored by `next/router` (`push(url, as, options)`), so **`shallow` never applies**; the `as` argument is the literal `"/"`.
   * `axios.get(… /${doorNumber}/open)` — actual door open.
4. Outer `.catch(err => console.log(err))` — on a network failure **nothing happens in the UI** except `disable` stays `true` and `disableBack` stays `true`: the page is effectively frozen (recoverable only by remounting).

**`handlePromo()` — free promo rental (`doorStatus == 0`)**
* Immediately `setDisableBack(true)` and `setIsSuccessModalVisible(true)` (the "Door Opening..." overlay).
* `timeIn = currentDate.toISOString()` where `currentDate` was created during the render that produced the click — i.e. closure-captured, not fresh.
* `localTimeIn = new Date(currentDate.getTime() + 8 * 60 * 60 * 1000).toISOString()` — a hardcoded **+8 h** offset (PH time) used only for the remote `refNum`.
* `refNum = \`PROMO-${doorNumber}-${timeIn}\``.
* `reqBody` (exact keys): `lockerLocation`, `doorSize: "L"`, `doorStatus: 1`, `paymentStatus: "paid"`, `payType: "PROMO"`, `amount: process.env.NEXT_PUBLIC_DOOR_RATE`, `doorOpenCount: "1"`, `mpin: pin`, `timeIn`, `timeOut: ""`, `alias`, `id: doorNumber`, `doorNumber`, `transStatus: "Active"`, `transID: refNum`, `refNumber: refNum`, `refNum: refNum`.
* Writes: PATCH local door (`localDatabaseUrl`), POST remote `NEXT_PUBLIC_API_URL_POST` with the spread plus `refNum: \`PROMO-${doorNumber}-${localTimeIn}\`` and `promoEndDate`, then GET door/open; on its `.then` push to `/`.
* `catch (postError) { console.error(postError) }` — since none of the axios calls are awaited, only synchronous throws are caught. On failure the success overlay **stays on screen forever** and `disableBack` stays `true` — there is no timeout, no retry, no manual escape.
* Note: the promo path **skips `proceedToNextPage`'s common-PIN check order** — it runs *after* the blocklist, so the blocklist still applies.

**Amount/tax/fee:** no computation at all on this page. The only amount value is the raw `NEXT_PUBLIC_DOOR_RATE` env string written into `amount`. There is no tax, no fee, no proration, no change/cash math here.

**Timers / retries:** none on this page. The only time-based behaviour is the "Door Opening..." overlay (indefinite) and the +8 h local-time trick.

**Edge cases / known rough edges**
* `pin` starts as `[]`; `pin === "…"` comparisons and `pin[0]` render as `undefined` until the first keypress.
* `alias` is restricted to `a–z/A–Z` but stored as typed (case preserved; CSS `text-uppercase` is the only uppercasing), while `mpin`/`alias` are sent raw in the query string without `encodeURIComponent`.
* Two effects can fight over `error` on mount (see §3).
* Query-derived `doorStatus` is a string; every comparison is loose (`==`) except in effect #3.
* `alert`/`confirm` browser dialogs are not used anywhere.

## 8. External dependencies

| Import | Purpose |
|---|---|
| `useState, useEffect` from `react` | Local state + the three effects. |
| `useRouter` from `next/router` | Reads `query.doorNumber / lockerLocation / doorStatus / lockerAlias`; performs pushes. |
| `Keyboard` from `@/components/layout/keyboard` | On-screen numeric PIN pad; props `{ setPin, disableKey }`. It imports `KeyboardLayout` from `@/utils/keyboard` (16-cell map: digits 1–9, `bckspc`, `clr`, `0`, two blank cells and an unused `nxt` cell rendered as an invisible `pe-none opacity-0` placeholder) and `backspace`/`next` SVGs. It clears its buffer whenever the `setDisableKey` prop is `false`. |
| `dynamic` from `next/dynamic` | Lazy-loads the Lottie `Player` client-side with `{ ssr: false }`. |
| `@lottiefiles/react-lottie-player` (`Player`, dynamic) | Renders `goHomeLottie.json`, `lockDoorLottie.json`, `loader.json`. |
| `@/assets/lottie/goHomeLottie.json` | Animation inside the "End transaction" card. |
| `@/assets/lottie/lockDoorLottie.json` | Animation inside the "Open Locker" card. |
| `@/assets/lottie/loader.json` | Spinner in the "Door Opening..." overlay. |
| `axios` | All local-database and Pandora HTTP calls (GET/PATCH/POST). |
| `@/assets/img/qubee-def.svg` | Qubee mascot in the confirmation modal (rendered via `next/image` **without `alt`**). |
| `Image` from `next/image` | SVG rendering. |
| `@/utils/isPromoActive` | `isPromoActive()` — promo-window predicate from env dates. |
| `@/context/app` | `useAppContext()` → `localDatabaseUrl` (promo vs normal local DB URL). |
| `@/utils/hardwareClient` | `endBillSession()` — Socket.IO teardown of the bill acceptor on mount. |

**Env vars referenced by this file:** `NEXT_PUBLIC_PROMO_END_DATE`, `NEXT_PUBLIC_PROMO_START_DATE` (indirectly, via `isPromoActive`), `NEXT_PUBLIC_LOCAL_URL_DATABASE` / `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO` (via context), `NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS`, `NEXT_PUBLIC_API_URL_PATCH`, `NEXT_PUBLIC_LOCAL_URL_FOR_PATCHING`, `NEXT_PUBLIC_API_URL_POST`, `NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN`, `NEXT_PUBLIC_DOOR_RATE`, plus `NEXT_PUBLIC_HARDWARE_SOCKET_PORT` / `NEXT_PUBLIC_HARDWARE_ACCESS_KEY` via `hardwareClient`.

## 9. Legacy → modern notes (App Router + TypeScript)

**Must stay client (`"use client"`)**
* `useRouter`/`router.query` → `useSearchParams()` (requires a `<Suspense>` boundary in App Router) or, better, read `searchParams` in a Server Component and pass typed props down.
* `dynamic(..., { ssr: false })` and every `Player` instance, `next/image`, the `Keyboard` pad and all handlers are client-only.
* `endBillSession()` touches `window.location`, `process.env.NEXT_PUBLIC_*` and a Socket.IO connection → client-only; wrap in a small `useEffect` in a client component and keep the singleton SDK module.
* `new Date()`/`toISOString()` in the render body is a hydration hazard in the App Router (server vs client clock) — move `currentDate` into the click handler or a ref.

**Could become server-side**
* The Mongo work is already a route handler: port `src/pages/api/transactions.js` → `app/api/transactions/route.ts` (`GET`, `POST`) and `src/pages/api/transactions/[transID].js` → `app/api/transactions/[transID]/route.ts` (`PATCH`). These are good candidates to convert to **Server Actions** (`completeTransaction(doorNumber)`), which removes the two-fetch lookup+PATCH dance and gives a single typed call plus `revalidatePath`.
* The locker-controller `/open` call and the Pandora POST/PATCH are machine-to-machine side effects with no secrets in the client bundle only by accident (they use `NEXT_PUBLIC_*` URLs). Moving them behind route handlers/Server Actions lets you drop the `NEXT_PUBLIC_` prefix, add timeouts/retries, and make the local json-server "write-behind queue" (`FOR_PATCHING`, `LOCKER_DETAILS`) a server-side concern instead of a browser concern.
* Recommended split: `app/details/page.tsx` (Server Component: parse/validate `searchParams`, redirect when `doorStatus` is missing) → `<DetailsForm doorNumber lockerLocation doorStatus lockerAlias localDatabaseUrl isPromoActive />` client component. Note `localDatabaseUrl` is currently derived from `isPromoActive()` **at provider render time**; on the server that value must be derived per-request from the same env dates.

**Types to introduce while porting**
* `type Pin = string` (kill the `string[]` initial value — the `useState([])`→string transition is the single biggest typing hazard; `useState<string>("")` preserves all behaviour because `pin.length` and `pin[i]` work identically).
* `type DoorStatus = 0 | 1` with a `Number(searchParams.get("doorStatus"))` parse once; never compare a query string to a number again.
* `type ChosenOption = 0 | 1 | 2`; `type DetailsError = React.ReactNode`.
* Replace the `error` string-or-JSX union with `{ kind: "pin-length" | "pin-mismatch" | "common-pin"; doorNumber?: string }` and render `<p className="text-danger">…</p>` in one place.
* `NEXT_PUBLIC_DOOR_RATE` is a string; type the rate as `string` if it must stay verbatim in payloads, or parse to `number` deliberately.
* `next/image` in TS requires `alt` — the modal `<Image src={qubee} />` needs `alt=""`.

**Behavioural bugs to decide on before porting (do not silently "fix", confirm with product)**
1. `router.push(obj, "/", undefined, { shallow: true })` — `shallow` is a no-op. In App Router use `router.push("/")` (or `redirect()`), and decide whether the intent was a soft navigation.
2. `disable`/`disableBack` are never reset after a failed `handleEnd`, freezing the screen.
3. `chosenOption == 0` + Next is impossible (Next stays disabled), but `proceedToNextPage` still has a silent no-op branch — dead code to remove.
4. Effect #3 clobbers effect #2's error message on mount.
5. `setAlias(lockerAlias)` in effect #2 can overwrite the alias with `undefined`.
6. No request timeouts or retry/backoff on any of the ~7 network calls; only the online PATCH has an offline fallback.
7. `NEXT_PUBLIC_DOOR_RATE` is written into `amount` as a string while the local DB sometimes holds numbers (`ready-for-pickup` flows elsewhere write the same env string).
8. Accessibility: no `alt` on the mascot, no `aria-live` on `{error}`, `<button>`-as-card markup for the two options, no label/`id` association on the alias input.

---

# FILE B — `src/pages/payment/index.js`

Route: `/payment`. Component name `PaymentPage` (default export). 506 lines. Reached from `/paymentselection` (which creates the Mongo transaction first and passes `transID`).

## 1. Purpose

**E-wallet (Narwhal Pay) QR payment screen.** It asks the Pandora backend to create a payment, renders the returned EMV QR, waits for the payment to be confirmed either by a WebSocket `payment-notification` push or by polling the payment-status endpoint, then marks the locker as `Active`/`paid`, records the transaction to Mongo, **physically opens the door**, and shows a 6-second "Payment Successful" countdown before redirecting home.

Rendered as three progressive phases inside one card: **QR phase → "Processing Payment" phase → "Payment Successful" countdown phase**. A warning banner about the cashier receipt is always visible.

## 2. State

| # | Variable | Declaration | Type | Initial | How it changes |
|---|---|---|---|---|---|
| 1 | `qr` | `useState("")` | **`ReactNode`** (a `""`, a `<Player/>` element, or a `<QRCode/>` element) | `""` | `getPrice` initially sets a `bounceLoader` `<Player/>`, then `generateQR(response.data.qrEmv)` replaces it with the QR. Rendered inside `<div className=" col-md-6 mx-auto">{qr}</div>`. |
| 2 | `qrLoading` | `useState("")` | `ReactNode` | `""` | Set to a `bounceLoader` `<Player/>` inside `getPrice`. **Never rendered** — dead state. |
| 3 | `qrText` | `useState("")` | `string` | `""` | `"Generating QR Code, please wait..."` → `"Processing transaction..."` → `"Payment Completed, your transaction is being processed. Kindly wait for the door to open."`; or `"Network Error, Please contact support"` on offline/error. Rendered at `fs-25 font-semibold m-3 text-center`. |
| 4 | `dataInterval` | `useState(null)` | `null` | `null` | **Never assigned.** `clearInterval(dataInterval)` is called in `getPrice`, in `postTransaction`'s success handler and in `handleBack`, all of which are no-ops. Intended (per the surrounding comment `// Make the API call and set dataInterval only once`) to hold a polling interval. Dead state. |
| 5 | `disableBack` | `useState(false)` | `boolean` | `false` | Set `true` in `postTransaction`. Disables the single **Back** button. Never reset → after a payment failure the user is stuck. |
| 6 | `transID` | `useState(null)` | `string \| null` | `null` | `setTransID(response.data.transNumber)` in `getPrice`; sent as `transID` in the local-DB PATCH. |
| 7 | `paymentId` | `useState(null)` | `string \| null` | `null` | `setPaymentId(response.data.paymentId)`. Used in: the status-poll URL, the socket message body, `postTransaction(paymentId)` as `paymentId`/`refNumber`, and the field `paymentId` in the local PATCH. |
| 8 | `display` | `useState("")` | `string` (CSS class) | `""` | Set to `"d-none"` in `postTransaction` → hides the payment-channel logos image. |
| 9 | `textProgress` | `useState(false)` | **`boolean \| ReactNode`** (false, then a JSX element, then `true`) | `false` | `postTransaction` sets it to a "Processing Payment" + spinner `<div>` (truthy), then the PATCH `.then` sets it to `true`. Acts as a boolean phase switch; its JSX value is never used. |
| 10 | `prog` | `useState("")` | `string` | `""` | `setProg("complete")` on PATCH success ⇒ root className becomes `… complete-cont` (otherwise `-cont`). |
| 11 | `timerText` | `useState(6)` | `number` | `6` | Countdown decremented every 1000 ms from 6 → 0; rendered as the big number over the spinner. |
| 12 | `currentProcess` | `useState(false)` | `boolean` | `false` | Set `true` by a `setInterval(…, 1500)` started after the door-open response. Switches the progress branch from "Processing Payment" to the success/countdown view. |

Derived on every render (not memoized): `d = new Date()`, `dateNow = d.toISOString()` (lines 41–42) — **recomputed on every render**, so the `dateNow` closed over by `postTransaction` is whatever render created that closure, not the click-time value. This value is sent as `timeIn` to the local DB, Mongo and the Pandora API.

Query params: `doorNumber`, `lockerLocation`, `pin`, `alias`, and `mongoTransID = router.query.transID`. Context: `const { localDatabaseUrl } = useAppContext()`.

Hooks/computed: `isOnline = useNetwork()` (true if `navigator.onLine` **and** a `HEAD https://www.google.com` with `mode: "no-cors"` resolves); `sockets = useWebSocket()` (returns the whole `{ payments: WebSocket }` map because no route argument is passed); `targetRoute = "payments"`; `socket = sockets[targetRoute]`; `console.log(socket)` on every render.

Styles: `loaderStyle = { height: 70, width: 70 }`, `qubeSpinnerStyle = { height: 72.59, width: 72.59 }`.

## 3. Effects

**Effect #1 — `useEffect(() => { getPrice(); }, [])`**
* Mount only. Creates the payment + QR. **No cleanup**, so the `setTimeout(handleBack, 3000)` timers created on the offline/error paths survive unmount, and there is no abort on unmount.
* In React 18 StrictMode this would double-invoke and create **two** payment records; the project currently sets `reactStrictMode: false` — keep that in mind when porting (an App Router migration that enables StrictMode changes behaviour).

**Effect #2 — `useEffect(…, [socket, paymentId])`**
```
if (socket) {
  if (socket.readyState === WebSocket.OPEN) reconnectWebSocket();
  else socket.addEventListener("open", reconnectWebSocket);
}
return () => {
  if (socket) {
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
  }
};
```
* Purpose: register the payment listeners and send the `{endpoint:"payment", paymentId}` subscription once the socket is open.
* Defects worth preserving/deciding on: it **adds** `"open" → reconnectWebSocket` but **removes** `"open" → onOpen`; it never removes `"close" → onClose`; and because `reconnectWebSocket` registers `onMessage` itself, every re-run of the effect (each `paymentId` change, plus the socket's own reconnect) stacks duplicate `message` listeners on the same long-lived socket from `WebSocketProvider` — a `payment-notification` can therefore fire `postTransaction` **more than once**.
* `WebSocket.OPEN` is a browser global ⇒ client-only.
* Cleanup exists but is asymmetric/incorrect.

**Effect #3 — `useEffect(…, [isOnline, paymentId])`**
```
let interval;
if (!isOnline && paymentId) interval = setInterval(() => checkPaymentStatus(), 5000);
return () => clearInterval(interval);
```
* Fallback polling every **5000 ms**, but gated on `!isOnline` (i.e. only while the device believes it is **offline**). Every poll calls `axios.get(NEXT_PUBLIC_API_PAYMENT_STATUS + paymentId)`.
* Cleanup is correct for this interval.
* Note the logical inversion: the network guard in `getPrice` refuses to run offline, and this poller runs only offline; the two guards use two different notions of "online" (`useNetwork`'s Google-HEAD check vs. fetch success).

**Timers created outside effects (not covered by any cleanup)**
* `getPrice`: `setTimeout(() => handleBack(), 3000)` on both the offline path and the `catch` path.
* `postTransaction` → door-open `.then`: `processInterval = setInterval(() => setCurrentProcess(true), 1500)` and `countdownInterval = setInterval(() => { timer -= 1; setTimerText(timer); if (timer === 0) { clearInterval(countdownInterval); clearInterval(processInterval); router.push("/"); } }, 1000)`. The arrow function passed to `.then` **returns** a cleanup that `Promise.then` discards, so those intervals cannot be cleared on unmount; they self-clear only at `timer === 0`.

## 4. Data & APIs

### Payment gateway (Pandora backend)

1. **POST** `` `${process.env.NEXT_PUBLIC_API_PAYMENT_STATUS}` `` (raw `fetch`)
   ```js
   { method: "POST",
     headers: { accept: "application/json", "content-type": "application/json" },
     body: JSON.stringify({
       amount: process.env.NEXT_PUBLIC_DOOR_RATE,       // string, e.g. "250"
       location: lockerLocation || "1000",              // fallback location "1000"
       quantity: 1,
       name: name(),                                    // "UAT TEST - [JCASTLE] Payment" if DOOR_RATE === "10", else "[JCASTLE] Payment"
       description: `[JCASTLE]PAYMENT[${lockerLocation}]|Door# [${doorNumber}]`
     }) }
   ```
   Response fields consumed: `response.data.qrEmv` (string → QR value), `response.data.transNumber` (→ `transID` state), `response.data.paymentId` (→ `paymentId` state).
2. **GET** `` `${process.env.NEXT_PUBLIC_API_PAYMENT_STATUS} + paymentId` `` via axios (string concatenation, no separator) → `response.data.data.status`; only `"paid"` is acted on. Any other value logs `"Payment is still pending or failed"`. Errors log `"Error fetching payment status:"`.

### WebSocket (native, from `WebSocketProvider`)

* Context (`src/context/Websocket.js`) opens one native `WebSocket(`${process.env.NEXT_PUBLIC_API_PAYMENT_WEBSOCKET}/payments`)` per route in `["payments"]` on provider mount, and on `close` schedules a reconnect after **5000 ms** by re-running `createSocket`. (No app-level heartbeat/auth.)
* This page's socket events:
  * **Emitted:** `socket.send(JSON.stringify({ endpoint: "payment", paymentId }))` — sent every time `reconnectWebSocket()` runs (i.e. on open and on each effect re-run/reconnect).
  * **Listened:** `open` (logs `"WebSocket opened:"`), `error` (logs `"WebSocket error:"`), `close` (logs `"WebSocket closed:"` then calls `reconnectWebSocket()`), `message` (JSON-parsed; `switch (data.type)`: `case "payment-notification"` → `postTransaction(paymentId)`; `default:` logs `"Unhandled message type:"`). Non-JSON payloads are swallowed silently by design.
  * Also, before the socket is open, `socket.addEventListener("open", reconnectWebSocket)` from effect #2.
* No `socket.io-client` usage in this file (that library is used by the hardware SDK).

### json-server local database (door record)

3. **PATCH** `` `${localDatabaseUrl}/${currentDoor}` `` via axios — the authoritative "locker is now rented" write:
   ```js
   { paymentId: paymentId, lockerLocation: currentLocation, doorSize: "L",
     doorStatus: 1, paymentStatus: "paid", payType: "NARWHAL",
     amount: process.env.NEXT_PUBLIC_DOOR_RATE, doorOpenCount: "1",
     mpin: currentPin, timeIn: dateNow, timeOut: "", alias: currentAlias,
     id: currentDoor, doorNumber: currentDoor, refNumber: paymentId,
     transStatus: "Active", transID: transID }
   ```
   * Destructured fresh from `router.query` at call time (comment: *"Read fresh values from router.query to avoid closure issues with first-render const capture"*).
   * `.then(...)` chains the rest of the flow. **There is no `.catch`** — a failure leaves the UI on "Processing Payment" with `disableBack === true` forever.

### Pandora backend (transaction record)

4. **POST** `` `process.env.NEXT_PUBLIC_API_URL_POST` `` (axios) with `reqBody`:
   `{ refNum: paymentId, lockerLocation: currentLocation, payType: "NARWHAL", amount: NEXT_PUBLIC_DOOR_RATE, timeIn: dateNow, doorNumber: currentDoor, refNumber: paymentId, qpin: currentPin, transStatus: "Active", billsCounter: [0, 0, 0] }`
   * `.catch` → **POST** `` `${process.env.NEXT_PUBLIC_LOCAL_URL_FOR_POSTING}` `` with `{ id: paymentId, reqBody }` (offline write-behind queue).

### Locker controller

5. **GET** `` `${process.env.NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN}/${currentDoor}/open` `` (axios) — physically opens the door; its `.then` starts the two intervals described above. No `.catch`.

### Next.js API routes (MongoDB)

6. **PATCH** `` `/api/transactions/${mongoTransID}` `` — twice in this file:
   * immediately after the payment is created (attach the Narwhal references): body `{ refNumber: response.data.transNumber, refNum: response.data.transNumber }`, `.catch(err => console.error("MongoDB refNum update failed:", err))`;
   * after the local door PATCH succeeds: body `{ payType: "NARWHAL", amount: NEXT_PUBLIC_DOOR_RATE, timeIn: dateNow ? dateNow : new Date().toISOString(), bookingStatus: "ready-for-pickup", refNumber: paymentId, refNum: paymentId }`, `.catch(err => console.error("MongoDB txn update failed:", err))`.
   * Both are guarded by `if (mongoTransID)` and are fire-and-forget: no UI state depends on them.
   * The route defaults `bookingStatus` to `"ready-for-pickup"` when the body omits it, and whitelists only `payType, amount, timeIn, refNumber, billsCounter, bookingStatus` from the body.

### Mongo/Mongoose

No direct driver usage in the component; only the two Next API routes above. Route handlers live in `src/pages/api/transactions.js` (GET/POST) and `src/pages/api/transactions/[transID].js` (PATCH).

## 5. Rendering

Root:
```jsx
<div className={`bg-light text-dark rounded mt-5 container p-5 py-2 pb-5 ${prog}-cont`}>
```
(`prog` is `""` or `"complete"`, so the class is `-cont` or `complete-cont`.)

**Always-visible banner** (above every phase):
```
<div className="d-flex justify-content-center">
  <div className="alert-warning alert-warning-border p-4 m-4  fs-25 text-left font-semibold ">
    <div className="align-self-center">Reminder: Get your Receipt at the Cashier</div>
  </div>
</div>
```
(Note the double space in `p-4 m-4  fs-25`, and the trailing space in `font-semibold `.)

**Phase switch: `textProgress ? (currentProcess ? SUCCESS : PROCESSING) : QR`**

**SUCCESS** (`textProgress` truthy and `currentProcess` true):
```
<div className="">
  <div className="fs-21 pt-56 text-center pb-43 font-regular d-flex align-items-center fade-in">
    <Player src={qubeSpinner} loop autoplay style={qubeSpinnerStyle} speed={6} />
    <div className="fs-31 font-bold position-absolute p-4-5">{timerText}</div>
    <div className="p-3">You will be redirected to the homepage after the countdown.</div>
  </div>
  <div className="d-flex flex-column align-items-center scale-in-center">
    <div className="pt-100"><Image src={checkmark} alt="Payment success checkmark" /></div>
    <div className="fs-64 font-semibold text-center">Payment Successful</div>
    <div className="fs-36 font-regular text-center">Enjoy your hassle-free time at JCastle!</div>
  </div>
  <div className="mx-auto pt-150 fade-in-bottom">
    <button className="text-white bg-light p-5 border-0 fs-31 font-regular text-success m-2 next"
            onClick={() => handleBackHome()}>Back to Home</button>
  </div>
</div>
```

**PROCESSING** (`textProgress` truthy, `currentProcess` still false):
```
<div className="d-flex flex-column align-items-center text-progress fade-out">
  <div className="fs-48 font-regular text-center">Processing Payment</div>
  <div className="pt-40"><Player src={bounceLoader} loop autoplay style={loaderStyle} /></div>
</div>
```
(An identical "Processing Payment" block is also what `postTransaction` injects into `textProgress`, but that value is discarded because `textProgress` is only tested for truthiness.)

**QR phase** (`textProgress === false`):
```
<>
  <div className=" p-3 fs-31 base-color font-semibold text-center">
    Scan this QR Code directly using your E-Wallet{" "}
  </div>
  <div>
    <div className=" col-md-6 mx-auto">{qr}</div>
    <div className="align-items-center d-flex flex-column mt-3">
      {" "}<Image src={NarwhalPay} alt="NarwhalPay payment method" />
    </div>
    <div className=" fs-31 font-semibold text-center mt-5 ">
      <div className="col-md-4 mx-auto p-5 rounded text-light btn-gradients">PHP 200</div>
    </div>
    <div className="mt-5">
      <div className="fs-25 font-semibold m-3 text-center">{qrText}</div>
    </div>
    <div className={`${display} col-md-12 mx-auto`}>
      <Image src={PaymentChannel} alt="" className="col-md-12" />
    </div>
  </div>
  <div className=" text-center mt-5">
    <button className="bg-light p-5 border border-success fs-31 text-success m-2 w-100 font-regular"
            onClick={() => handleBack()} disabled={disableBack}>Back</button>
  </div>
</>
```
The **`PHP 200`** price is a **hardcoded string literal**, not derived from `NEXT_PUBLIC_DOOR_RATE` (which is `250` in `.env.example` and `"10"` in `.env`). The QR itself is `<QRCode value={e} size={200} style={{ height:"auto", maxWidth:"100%", width:"100%", margin:"0 auto", marginTop:"1.5rem" }} viewBox={"0 0 100% 100%"} />` from `react-qr-code`.

**Exact user-visible strings:** `Reminder: Get your Receipt at the Cashier`, `Scan this QR Code directly using your E-Wallet`, `PHP 200`, `Generating QR Code, please wait...`, `Processing transaction...`, `Processing Payment`, `Payment Completed, your transaction is being processed. Kindly wait for the door to open.`, `Network Error, Please contact support`, `You will be redirected to the homepage after the countdown.`, `Payment Successful`, `Enjoy your hassle-free time at JCastle!`, `Back to Home`, `Back`. Alt texts: `"Payment success checkmark"`, `"NarwhalPay payment method"`, `""` (PaymentChannel).

The page itself adds no header/title; `Layout` (from `_app.js`) supplies the shell and an env-driven `UAT MODE`/`BILL ACCEPTOR UAT MODE` footer badge.

## 6. User interactions

| Handler | Trigger | Behaviour |
|---|---|---|
| `getPrice()` | mount (effect #1) | Offline guard → `setQrText("Network Error, Please contact support")` + `setTimeout(handleBack, 3000)`. Otherwise clears the (null) interval, shows the spinner + `"Generating QR Code, please wait..."`, POSTs to the gateway, renders the QR, stores `transID`/`paymentId`, sets `"Processing transaction..."`, and PATCHes the Mongo ref numbers. The `catch` shows the same network error and auto-navigates back after 3000 ms (the retry/`isOnline` alternatives are commented out). |
| `reconnectWebSocket()` | socket `open`, and `onClose` | Registers `onOpen/onError/onClose/onMessage` and sends `{endpoint:"payment", paymentId}`. |
| `onMessage(event)` | socket `message` | `JSON.parse` → `data.type === "payment-notification"` ⇒ `postTransaction(paymentId)`; other types logged; parse errors swallowed. |
| `onOpen/onError/onClose` | socket events | Log only; `onClose` also calls `reconnectWebSocket()` (in addition to the provider's own 5 s reconnect). |
| `postTransaction(paymentId)` | socket notification, or the 5 s offline poller via `checkPaymentStatus` | Full "activate locker" flow (see §7). |
| `checkPaymentStatus()` | 5 s interval while `!isOnline && paymentId` | GET status; `"paid"` ⇒ `postTransaction(paymentId)`. |
| `generateQR(e)` | called with `response.data.qrEmv` | Replaces `qr` with a `react-qr-code` element. |
| `handleBack()` | `Back` button | `router.push({ pathname: "/paymentselection", query: { doorNumber, lockerLocation, pin, alias, transID: mongoTransID } })` and `clearInterval(dataInterval)`. Note it forwards the **Mongo** `transID` (so `paymentselection` can reuse it), not the gateway `transID`, and passes no `as` argument. |
| `handleBackHome()` | `Back to Home` button (success phase) | `router.push({pathname:"/"}, "/", undefined, {shallow:true})` — again a no-op 4th argument. |
| — | countdown reaching 0 | `router.push` to `/` after clearing both intervals. |

**Keyboard shortcuts: none.** No `keydown` listeners, no focus traps, no scan-gun input. The only "hardware" is the QR display itself (the customer scans with their phone).

## 7. Business rules

**Offline handling**
* `useNetwork()` returns `true` only when `navigator.onLine` **and** a no-cors `HEAD https://www.google.com` succeeds; it listens to `window` `online`/`offline`.
* `getPrice` refuses to run when `!isOnline` → message + 3 s auto-back.
* `getPrice`'s `catch` unconditionally shows the same error and auto-backs (the `if (!isOnline)` gate around it is commented out).
* Fallback status polling runs **only** when `!isOnline`, every 5000 ms.

**Payment confirmation – two independent paths**
1. WebSocket `data.type === "payment-notification"` (push).
2. `checkPaymentStatus()` → `response.data.data.status === "paid"`.
Both call `postTransaction(paymentId)`, and **neither is idempotency-guarded**: there is no "already processing" flag, so a duplicate notification or a race between the poller and the socket re-runs the whole flow (a second door-open call, a second local PATCH, a second Pandora POST, and two countdown interval pairs).

**`postTransaction(paymentId)` sequence**
1. Read fresh `doorNumber/lockerLocation/pin/alias` from `router.query`.
2. `setQrText("Processing transaction...")`, `setDisplay("d-none")`, `setTextProgress(<Processing Payment subtree>)`, `setDisableBack(true)`, `console.log(d)`.
3. `axios.patch(localDatabaseUrl/${currentDoor}, { … doorStatus: 1, paymentStatus: "paid", payType: "NARWHAL", amount: NEXT_PUBLIC_DOOR_RATE, doorOpenCount: "1", mpin: pin, timeIn: dateNow, timeOut: "", alias, refNumber: paymentId, transStatus: "Active", transID })`.
4. `.then`: `setProg("complete")`; `setQrText("Payment Completed, your transaction is being processed. Kindly wait for the door to open.")`; `setTextProgress(true)`; `clearInterval(dataInterval)`.
5. `if (mongoTransID)` → PATCH Mongo with `bookingStatus: "ready-for-pickup"` and the payment/PIN details.
6. GET `…/${currentDoor}/open` (door open). Its `.then` sets `timer = 6`, starts a 1500 ms interval setting `currentProcess = true`, and a 1000 ms countdown from 6 that renders `timerText` and, at `0`, clears both intervals and pushes to `/`.
7. POST the Pandora transaction with `billsCounter: [0, 0, 0]`; on failure POST the same payload to the local `FOR_POSTING` queue as `{ id: paymentId, reqBody }`.
8. Outer `try/catch` only logs (`console.error(postError)`); the axios PATCH has **no** `.catch`, so a rejected door PATCH leaves the user on "Processing Payment" with Back disabled indefinitely.

**Amount/tax/fee computation:** none. `amount` is always the raw `NEXT_PUBLIC_DOOR_RATE` env string; `quantity` is hardcoded `1`; the displayed price `PHP 200` is hardcoded and can therefore disagree with the charged amount; currency is PHP throughout. No discounts, no change, no receipt math.

**Promo logic:** none on this page (promo is handled entirely in `details`; `localDatabaseUrl` may still point at the promo database via the context if the promo window is active).

**Timers:** `setTimeout 3000` (network-error auto-back, uncleared), `setInterval 5000` (offline status poll, cleaned up), `setInterval 1500` (reveal success UI, uncleaned), `setInterval 1000` (6 s countdown → redirect, uncleaned but self-terminating).

**Retries:** the provider reconnects the WebSocket 5 s after close (TODO comment in `Websocket.js` calls off further reconnection logic); `onClose` here triggers an extra immediate `reconnectWebSocket()`. No HTTP retries; only the `FOR_POSTING` write-behind fallback.

**Edge cases / known defects to decide on**
* Duplicate `payment-notification` / poller+push race ⇒ double execution of the whole completion flow.
* Listener accumulation in effect #2 (`onMessage` re-registered on every `paymentId` change and on every socket reconnect).
* `dateNow` is re-derived every render, so `timeIn` is not the click time; under fast re-renders (countdown updates!) the value written by `postTransaction` is the render-time value at the moment the closure ran. Note the countdown state updates re-render this component ~1×/s while `postTransaction` is in flight, so the `dateNow` referenced later in the same closure is frozen at closure creation — but the *Pandora* POST and Mongo PATCH inside the same closure all share that first captured value. Still, the `dateNow` used by anything triggered later (e.g. a second `postTransaction` from a duplicate notification) will differ.
* No idempotency key sent to the gateway; `description` uses the raw query values, and if `lockerLocation` is missing the POST falls back to `"1000"` while the description string embeds `undefined`.
* `NEXT_PUBLIC_DOOR_RATE === "10"` is the UAT switch that renames the payment to `"UAT TEST - [JCASTLE] Payment"`.
* No error UI for any failure except the initial `getPrice` network error; a Mongo failure is invisible to the user.
* Accessibility: countdown has no `aria-live`; the QR is an SVG with no text alternative; no `alt` on the payment-channel image (`alt=""` intentional/decorative); the `PHP 200` price is not associated with the amount env.

## 8. External dependencies

| Import | Purpose |
|---|---|
| `@/assets/img/paymentChannels.svg` | E-wallet logo strip shown under the QR (`<Image alt="" className="col-md-12">`), hidden once `display === "d-none"`. |
| `@/assets/img/narwhalPay.svg` | "NarwhalPay payment method" logo. |
| `@/assets/img/success-mark.svg` | Checkmark on the success phase (`alt="Payment success checkmark"`). |
| `@/assets/lottie/loader.json` (`bounceLoader`) | Spinner for `qr`, `qrLoading` and the "Processing Payment" state. |
| `@/assets/lottie/qubeSpinner.json` (`qubeSpinner`) | Ring spinner behind the countdown number (`speed={6}`). |
| `@/context/Websocket` | `useWebSocket()` → the `{ payments: WebSocket }` map; provider creates/reconnects the native socket. |
| `next/dynamic` + `@lottiefiles/react-lottie-player` | Client-only lazy `Player` (`{ ssr: false }`). |
| `axios` | Status polling, local-door PATCH, Pandora POST, door open. |
| `next/image` | All three SVGs. |
| `next/router` (`useRouter`) | Query params + `router.push` to `/paymentselection` and `/`. |
| `react` (`useEffect`, `useState`) | State and lifecycle. |
| `react-qr-code` (`QRCode`) | Renders the EMV QR from `response.data.qrEmv`. |
| `@/hooks/useNetwork` | `isOnline` boolean + `online`/`offline` listeners. |
| `@/context/app` | `useAppContext()` → `localDatabaseUrl`. |

**Env vars referenced by this file:** `NEXT_PUBLIC_API_PAYMENT_STATUS`, `NEXT_PUBLIC_DOOR_RATE`, `NEXT_PUBLIC_API_URL_POST`, `NEXT_PUBLIC_LOCAL_URL_FOR_POSTING`, `NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN`, `NEXT_PUBLIC_API_PAYMENT_WEBSOCKET` (via the provider), `NEXT_PUBLIC_LOCAL_URL_DATABASE` / `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO` (via context), `NEXT_PUBLIC_API_URL` (logged by the provider), plus `NEXT_PUBLIC_PROMO_START_DATE` / `NEXT_PUBLIC_PROMO_END_DATE` indirectly through `isPromoActive()`.

## 9. Legacy → modern notes (App Router + TypeScript)

**Client-only**
* `QRCode`, `Player` (Lottie), `next/image`, `useNetwork` (`navigator.onLine`, `window` listeners, cross-origin `HEAD`), the native `WebSocket`, all `setInterval`/`setTimeout`, and `router.push` ⇒ the interactive part must be a client component.
* `window.__DSH`-style globals are absent, but `WebSocket.OPEN` and `window.location` are used: never render this on the server.
* `useSearchParams()` requires a `<Suspense>` boundary; alternatively make `app/payment/page.tsx` a Server Component that reads `searchParams` (`doorNumber`, `lockerLocation`, `pin`, `alias`, `transID`) and passes them as typed props, with a `<Suspense fallback>`-wrapped client component. Server-side you can also validate/redirect when required params are missing (today the page silently renders with `undefined` values and posts `undefined` into payloads).

**Server-side candidates**
* `/api/transactions` and `/api/transactions/[transID]` → `app/api/transactions/route.ts` + `app/api/transactions/[transID]/route.ts`; keep as route handlers, since the flow is client-driven and the socket/poller must call them from the browser. A `completePayment()` **Server Action** could absorb the trio "local-door PATCH + Mongo PATCH + Pandora POST" (and the `FOR_POSTING` write-behind queue) so the browser makes one call, with real error propagation, timeouts and idempotency keys.
* The gateway POST (`NEXT_PUBLIC_API_PAYMENT_STATUS`) exposes the payment endpoint and the QR payload to the client bundle. Moving it into a route handler (`app/api/payments/route.ts`) would hide the URL, allow an idempotency key per door session, and let you validate `amount` server-side instead of trusting the client's `NEXT_PUBLIC_DOOR_RATE`.
* Door-open is a physical side effect — a route handler (`POST /api/doors/[doorNumber]/open`) gives you auth, retries and logging; today it is an unauthenticated GET issued from the browser with no `.catch`.
* The WebSocket can stay client-side, but the App Router alternative is a Server-Sent-Events route handler (`/api/payments/stream?paymentId=…`) fed by the backend, which removes the provider's reconnect TODO and the duplicate-listener bugs.
* `PHP 200` should come from the same server-provided price used for the charge, ideally returned by the payment-creation endpoint.

**Types to introduce**
* Replace the five phase booleans/JSX (`textProgress`, `currentProcess`, `prog`, `display`, `qr`, `qrLoading`) with a **discriminated union**: `type Phase = {k:"creating"} | {k:"awaiting-qr", qr:string} | {k:"processing"} | {k:"complete", secondsLeft:number} | {k:"error", message:string} | {k:"offline"}`. All the JSX-in-state disappears; `qr` becomes the EMV **string** and only the render converts it to `<QRCode value={…} />`.
* `transID: string | null`, `paymentId: string | null` → a single `payment: {transNumber:string; paymentId:string; qrEmv:string} | null`.
* `dataInterval` should be a `useRef<ReturnType<typeof setInterval> | null>` (or be deleted — it is always `null` today).
* `useNetwork` should return `"online" | "offline" | "unknown"` rather than a boolean computed from a `no-cors` HEAD, which also fails behind captive portals/CSP.
* Gateway response shape should be typed and validated once (`response.data.qrEmv/transNumber/paymentId`, status `response.data.data.status`).

**Behavioural fixes to confirm before implementing**
1. Add an idempotency guard (`useRef` "completion started") around `postTransaction` — otherwise port the race faithfully.
2. Fix effect #2's listener add/remove mismatch and use a single `message` handler with `AbortController`/`removeEventListener` symmetry.
3. Decide whether the 5 s poller should run while **online** (it currently runs only offline, which is when the GET will fail).
4. Clear the 1 s/1.5 s intervals and the 3 s `setTimeout` on unmount; move them into refs.
5. Decide the real price source: `NEXT_PUBLIC_DOOR_RATE` (charged) vs. the hardcoded `PHP 200` (displayed).
6. `router.push(obj, "/", undefined, {shallow:true})` — 4th arg is ignored; use `router.push("/")` in App Router.
7. Surface HTTP failures: today a failed PATCH permanently disables Back with no message.
8. Remove `console.log(socket)` / `console.log(d)` and the `qrLoading` dead state.

---

# Appendix — cross-cutting contracts shared by both files

* **`AppProvider`** (`src/context/app.js`): computes `localDatabaseUrl = isPromoActive() ? NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO : NEXT_PUBLIC_LOCAL_URL_DATABASE` **once per provider render** (no state, no memoization, no per-request evaluation). In App Router this becomes a per-request server value or an explicit prop.
* **`WebSocketProvider`** (`src/context/Websocket.js`): one native `WebSocket(`${NEXT_PUBLIC_API_PAYMENT_WEBSOCKET}/payments`)`; `close` ⇒ 5 s reconnect (TODO: "Implement reconnection logic here"); provider cleanup closes all sockets. `useWebSocket(route)` throws if the route is unknown — the payment page calls it with no argument, so it never throws and returns the map.
* **`Keyboard`** (`src/components/layout/keyboard/index.js`): 16-cell grid from `src/utils/keyboard.js`; internal `quickpin` (string), `disableNext` (unused externally), `disableKeys` (true at exactly 6 digits), `keyTexts` (declared, never used). Calls `setPin(quickpin)` on every change and `clear()` whenever its `setDisableKey` prop becomes `false`. Keys: `1..9`, `bckspc`, `clr` ("Clear all"), `0`, three blanks, and an `nxt` cell rendered as an invisible disabled placeholder.
* **Mongo API routes**: `GET /api/transactions?doorNumber=` (active txn = `bookingStatus ∉ {completed, canceled, cleared}`, newest first), `POST /api/transactions` (creates `TXN-${doorNumber}-${Date.now()}` with `bookingStatus: "payment-pending"`), `PATCH /api/transactions/[transID]` (whitelist `payType, amount, timeIn, refNumber, billsCounter, bookingStatus`; defaults to `ready-for-pickup`). Statuses observed across the two pages: `payment-pending`, `ready-for-pickup`, `completed`, `canceled`, `cleared`.
* **Feature flags / mode switches**: `NEXT_PUBLIC_BILL_ACCEPTOR`, `NEXT_PUBLIC_DOOR_RATE === "10"` (UAT switch: renames the payment and flips `Layout` into `BILL ACCEPTOR UAT MODE`/`UAT MODE`), `NEXT_PUBLIC_USE_MONGO`, `NEXT_PUBLIC_PROMO_START_DATE`/`NEXT_PUBLIC_PROMO_END_DATE`.
* **Flow position**: `/` → (door selection) → `/details` → `/paymentselection` (creates the Mongo txn, chooses `payment` or `cashpayment`) → `/payment` (this e-wallet QR page) → door opens → `/`.
