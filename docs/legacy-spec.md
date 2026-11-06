# Technical Specification — `ek_frontend_cash_v2` (legacy kiosk front end, Next.js 13 Pages Router)

Scope: the 13 requested files, read in full, plus the minimum supporting evidence needed to make every statement verifiable
(`_app.js`, `next.config.js`, `server.js`, `jsconfig.json`, `package.json`, `lib/db.js`, `models/Door.js`,
`models/Transaction.js`, `utils/isPromoActive.js`, `context/app.js`, `context/Websocket.js`, `pages/home/index.js`,
`pages/cashpayment/index.js`, `pages/details/index.js`, `pages/payment/index.js`, `pages/paymentselection/index.js`,
`node_modules/hardware-controller-sdk/build/{client,core}`, and all `.env*` files).

---

## 0. Repository / runtime baseline

| Item | Value |
| --- | --- |
| Framework | `next` `^13.5.8`, **Pages Router** (`src/pages`), plain JavaScript, no TypeScript |
| React | `react` `18.2.0`, `react-dom` `18.2.0` |
| Custom server | `server.js` — `next` + `http` + `socket.io` `^4.8.1` + `hardware-controller-sdk` server SDK |
| Scripts | `dev`/`start` = `node server.js`; `uat-bill`/`uat-online`/`prod-bill`/`prod-online` = `cross-env NODE_ENV=… node loadEnv.js .env.<x> && node server.js`; `db` = `json-server --watch LocalDatabase.json --port 3001` |
| Path alias | `jsconfig.json` → `"@/*": ["./src/*"]` |
| Next config | `reactStrictMode: false` (strict mode deliberately off — matters for double-effect assumptions) |
| Global CSS entry | `src/pages/_app.js` imports `@/styles/globals.css` **and** `bootstrap/dist/css/bootstrap.min.css` |
| Provider tree | `_app.js`: `AppProvider` → `WebSocketProvider` → `Layout` → `Component` |
| Page index | `src/pages/index.js` re-exports `./home` (`HomePage`) |
| Mongo | local `mongodb://…@localhost:27018/jcastle_kiosk?authSource=admin&replicaSet=rs0&directConnection=true` (DB `jcastle_kiosk`) |
| Local queue DB | `json-server` on `http://localhost:3001` (collections `LocalDatabase`, `PromoLocalDatabase`, `LockerDetails`, `ForPosting`, `ForPatching`, `ForPostingPayments`) |
| Locker controller | HTTP `http://localhost:9090/api/lockercontroller/*` |
| Bill acceptor HTTP (legacy) | `http://localhost:5000/send-command` (`NEXT_PUBLIC_LOCKER_CONTROLLER_BILL_ACCEPTOR`) |
| Hardware SDK transport | **socket.io** on the same host, port `NEXT_PUBLIC_HARDWARE_SOCKET_PORT` or `window.location.port` (i.e. 3000 by default) |

### 0.1 Env vars referenced by the files in scope (exact names)

```
NEXT_PUBLIC_BILL_ACCEPTOR              # "true" | "false"
NEXT_PUBLIC_API_URL                    # "pandora-2-0-uat.onrender.com/"
NEXT_PUBLIC_API_URL_POST               # https://…/api/post/ek
NEXT_PUBLIC_API_URL_PATCH              # https://…/api/patch/ek
NEXT_PUBLIC_API_PAYMENT_STATUS         # https://…/api/payment
NEXT_PUBLIC_API_PAYMENT_WEBSOCKET      # wss://…/websocket
NEXT_PUBLIC_DOOR_RATE                  # "10" (UAT) / "250" (prod); default fallback "200" in cashpayment
NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS  # …/api/lockercontroller/lockerdetails  → { location }
NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN# …/api/lockercontroller/door           → GET {id}/open
NEXT_PUBLIC_LOCKER_CONTROLLER_DOORS    # …/api/lockercontroller/doors
NEXT_PUBLIC_LOCKER_CONTROLLER_BILL_ACCEPTOR # …/send-command
NEXT_PUBLIC_LOCAL_URL                  # json-server root — used ONLY by the cron in api/getDoors.js
NEXT_PUBLIC_LOCAL_API_URL              # http://localhost:3001/
NEXT_PUBLIC_LOCAL_URL_DATABASE         # ${LOCAL_API_URL}LocalDatabase
NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO   # ${LOCAL_API_URL}PromoLocalDatabase
NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS
NEXT_PUBLIC_LOCAL_URL_FOR_POSTING
NEXT_PUBLIC_LOCAL_URL_FOR_PATCHING
NEXT_PUBLIC_LOCAL_URL_FOR_POSTING_PAYMENTS
NEXT_PUBLIC_PROMO_START_DATE
NEXT_PUBLIC_PROMO_END_DATE
NEXT_PUBLIC_HARDWARE_SOCKET_PORT       # default 3000
NEXT_PUBLIC_HARDWARE_ACCESS_KEY        # client-side socket auth token
HARDWARE_ACCESS_KEY                    # server-side socket auth token (server.js)
MONGODB_URI
```

**Env gaps found (real defects, not hypothetical):**
* `.env` (the live file, produced by `loadEnv.js` merging) contains **no `NEXT_PUBLIC_LOCAL_URL`** → the `api/getDoors.js`
  cron `PUT`s to the literal string `undefined`.
* `.env`, `.env.uat.*`, `.env.prod.*` contain **no `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO`** (only `.env.aguila` and
  `.env.example` do) → `context/app.js` returns `undefined` for `localDatabaseUrl` whenever `isPromoActive()` is true.
* `.env`, `.env.uat.*`, `.env.prod.*` contain **no `NEXT_PUBLIC_HARDWARE_SOCKET_PORT`** → `hardwareClient.getServerUrl()`
  falls back to `window.location.port` in the browser (fine) and `'3000'` during SSR (unused, but present).

### 0.2 Promo window helper (`src/utils/isPromoActive.js`)

```js
export const isPromoActive = () => {
  const currentDate = new Date();
  const promoStartDate = process.env.NEXT_PUBLIC_PROMO_START_DATE || "1970-01-01T00:00:00.000Z";
  const promoEndDate   = process.env.NEXT_PUBLIC_PROMO_END_DATE   || "1970-01-01T00:00:00.000Z";
  const currentDateISO    = currentDate.toISOString();
  const promoStartDateISO = new Date(promoStartDate).toISOString();
  const promoEndDateISO   = new Date(promoEndDate).toISOString();
  return currentDateISO >= promoStartDateISO && currentDateISO <= promoEndDateISO;
};
```

String comparison of ISO-8601 UTC strings (lexicographic == chronological). With no env set, both bounds are
the epoch, so it returns `false` for any real "now" → **normal mode**. Called on nearly every render of `DoorList`
(no memoisation) and once per `AppProvider` render.

---

## 1. `src/components/layout/index.js` — `Layout`

### 1.1 Purpose

The single global chrome for the kiosk: full-screen Lottie background, 3-slide info carousel, page slot, fixed
contact/privacy footer, a privacy-policy modal, and an environment "mode" banner. Mounted **once** in
`src/pages/_app.js` and therefore wraps every route; it is the only consumer of `components/layout/head.js`.

### 1.2 Props / exported API

```js
const Layout = ({ children }) => { … }
export default Layout;
```

| Prop | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `children` | `ReactNode` | yes (in practice always supplied by `_app.js`) | none | Rendered inside `.children > .col-md-12.container.pt-5`, after `<SlickHeader />`. |

No other exports; no context consumption.

### 1.3 State, refs, effects

| Hook | Initial | Notes |
| --- | --- | --- |
| `useState(false)` → `modalVisible` | `false` | Controls the Privacy Policy modal only. |
| `useState("")` → `mode` | `""` | Banner text; written only by the effect. |
| `useState("")` → `pay` | `""` | Banner amount; written only by the effect. |

No `useRef`, no `useMemo`, no timers, **no cleanup function**.

```js
useEffect(() => {
  if (
    (process.env.NEXT_PUBLIC_BILL_ACCEPTOR === "true" &&
      process.env.NEXT_PUBLIC_API_URL === "pandora-2-0-uat.onrender.com/") ||
    process.env.NEXT_PUBLIC_DOOR_RATE === "10"
  ) {
    setMode("BILL ACCEPTOR UAT MODE");
    setPay(process.env.NEXT_PUBLIC_DOOR_RATE);
  } else if (
    process.env.NEXT_PUBLIC_API_URL === "pandora-2-0-uat.onrender.com/" ||
    process.env.NEXT_PUBLIC_DOOR_RATE === "10"
  ) {
    setMode("UAT MODE");
    setPay(process.env.NEXT_PUBLIC_DOOR_RATE);
  } else {
    setMode("");
    setPay("");
  }
}, []);
```

Dependency array: `[]` (mount only). With the shipped `.env` (`BILL_ACCEPTOR=true`, `API_URL=pandora-2-0-uat.onrender.com/`,
`DOOR_RATE="10"`) the **first** branch always wins → rendered banner `BILL ACCEPTOR UAT MODE 10`.
Note the operator-precedence bug: because `|| DOOR_RATE === "10"` is outside the `&&` group, **any** deployment with
`DOOR_RATE="10"` is labelled "BILL ACCEPTOR UAT MODE" regardless of `NEXT_PUBLIC_BILL_ACCEPTOR`.

### 1.4 Data & APIs

None. No `fetch`, no `axios`, no socket, no SDK call. The only external inputs are the three `process.env` reads above.

### 1.5 Rendering — JSX structure, regions, exact strings

```
<>
  {modalVisible ? <Privacy modal> : ""}          // region 1 — modal
  <div className="position-absolute"><Player src={Background} loop autoplay /></div>   // region 2 — Lottie bg
  <div className="text-danger top-0 font-bold position-absolute p-3 ">{mode} {""} {pay}</div> // region 3 — mode banner
  <div className="children position-relative" style={{height:"100vh", overflowY:"auto"}}>      // region 4 — scroll shell
    <div className="col-md-12 container pt-5">
      <SlickHeader />
      {children}
    </div>
  </div>
  <div className="fixed-bottom quicksand"> … </div>  // region 5 — footer
</>
```

**Region 1 — Privacy modal** (rendered only when `modalVisible === true`)
* Backdrop `<div className="footer-modal-bg" onClick={() => closeModal()}>` (click-outside-to-close; note the inner
  modal does **not** stop propagation, so any click inside also closes it).
* Panel `<div className="footer-modal fade-in-top">`; close control is an empty
  `<button className="btn-modal-p" onClick={() => closeModal()}></button>` (the ✕ glyph comes from
  `background-image: url("../assets/img/x.svg")` in `globals.css`; the imported `x` symbol at the top of the file is
  **unused dead code**).
* Heading: `Privacy Policy` (`text-left font-bold fs-48 pb-4`).
* Body sections (exact headings): `1. INFORMATION WE COLLECT`, `a. Mobile Number:`, `b. Contact Information`,
  `c. Parcel Information`, `d. Usage Data`, `2. USE OF INFORMATION`, `a. Locker Bookings`, `b. Parcel Collection`,
  `c. Communication`, `d. Improvements and Analytics`, `3. DISCLOSURE OF INFORMATION`, `a. Service Providers`,
  `b. Legal Compliance`, `4. DATA SECURITY`, `5. DATA RETENTION`, `6. CHILDREN'S PRIVACY`,
  `7. CHANGES TO THE PRIVACY POLICY`, `8. CONTACT US`.
  Contact sentence: `If you have any questions, concerns, or requests regarding this Privacy Policy or the privacy practices at QUBE Smart Technology, please contact us at support@qubesmart360.com or +639177010419 / +639176320343.`
  Body copy opens with `At QUBE Smart Technology, we are committed to protecting your privacy…`. `d. Usage Data`
  duplicates the `c. Parcel Information` sentence verbatim (copy/paste defect). The privacy text names the vendor as
  "QUBE Smart Technology" while the rest of the UI brands "QUBE 24/7" / "JCastle".

**Region 2** — `<Player src={Background} loop autoplay />` where `Background = @/assets/lottie/ekBG.json`.
`Player` is loaded with `next/dynamic(..., { ssr: false })` because Lottie needs `document`.

**Region 3** — mode banner; exact rendered text is `${mode} ${pay}` (with an empty-string child between them), e.g.
`BILL ACCEPTOR UAT MODE 10`. Classes `text-danger top-0 font-bold position-absolute p-3`.

**Region 4** — scroll container; `height: 100vh; overflowY: "auto"`; inner `div.col-md-12.container.pt-5`.

**Region 5 — footer** (`.fixed-bottom.quicksand` → `.footer-main.container.p-0` → `.footer-contents.py-1.px-2.container.h-100.align-content-center.w-100` → `.row.justify-content-center.h-100.align-items-center`):
| Column | Content |
| --- | --- |
| `col-md-3 d-flex justify-content-end text-left border-right border-primary` | `<Image src={FB} />` (`@/assets/img/fblogo.svg`, no `alt`) + text `QUBE 24/7` |
| `col-md-1 d-flex justify-content-center` | divider `<div className="bd"></div>` |
| `col-md-4 d-flex justify-content-between text-left` | `<Image src={Phone} />` (`@/assets/img/phonelogo.svg`, no `alt`) + two lines: `(02) 7934 7590` and `0913123123123 / 1231231321` (placeholder numbers that differ from the support numbers on the header carousel) |
| `col-md-1 d-flex justify-content-center` | divider `<div className="bd"></div>` |
| `col-md-3 border-left border-primary d-flex justify-content-start text-left border-left border-primary` | `QUBE ` + `<a className="link" onClick={() => openModal()}>Terms of Use</a>`, then `<a className="link" onClick={() => openModal()}>& Privacy Policy</a>` |

Both footer links are `<a>` **without href** — they are mouse-only click targets (an accessibility and
touch-target problem on a kiosk) and both open the same modal (Terms of Use text does not exist).

### 1.6 Interactions & business rules

* `openModal()` → `setModalVisible(true)`; `closeModal()` → `setModalVisible(false)`. Nothing else is stateful.
* No keyboard/scan handling, no navigation (`next/router` is not imported), no timers, no countdown.
* Banner content is a deploy-time environment classification, not user data.

### 1.7 Hardware integration

None directly. `Layout` never imports `hardwareClient`, never opens a socket, never touches the locker controller.
Its only hardware-adjacent role is the env-driven banner described above.

### 1.8 Imports

| Import | Kind | Purpose |
| --- | --- | --- |
| `dynamic` from `next/dynamic` | external | ssr-disabled Lottie `Player`. |
| `@lottiefiles/react-lottie-player` (lazy `.then(mod => mod.Player)`) | external | Background animation renderer. |
| `Background` from `@/assets/lottie/ekBG.json` | internal asset | Lottie JSON payload. |
| `SlickHeader` from `@/components/layout/head` | internal component | Carousel region. |
| `FB` from `@/assets/img/fblogo.svg` | internal asset | Footer Facebook mark. |
| `Phone` from `@/assets/img/phonelogo.svg` | internal asset | Footer phone mark. |
| `Image` from `next/image` | external | Renders the two SVG marks. |
| `{ useEffect, useState }` from `react` | external | Mode state + modal state. |
| `x` from `@/assets/img/x.svg` | internal asset | **Unused** (dead import). |

### 1.9 Legacy → modern notes

* **Must stay client-side:** `modalVisible` toggling, `onClick` handlers, the Lottie `Player` (already `ssr:false`),
  Bootstrap grid markup.
* **Can be server-rendered:** the whole footer, the mode banner (env values can be read on the server and passed as
  props — this also removes the need for `NEXT_PUBLIC_*` exposure), and the entire privacy-policy text (it is static;
  it is currently shipped as ~160 lines of JSX in the client bundle). A modern version would keep a server
  `Layout` shell with exactly two Client Components: `<LottieBackground/>` and `<PrivacyModal trigger/>`, with the
  policy body imported from MDX/JSON.
* The modal should be `<dialog>` + `showModal()` (focus trap, Esc, inert backdrop) instead of a div with
  click-outside-close; `<a onClick>` should become `<button>` or a real `next/link` route.

---

## 2. `src/components/layout/head.js` — `Head` (rendered as `SlickHeader`)

### 2.1 Purpose

A 3-slide `react-slick` carousel at the top of every page, used to advertise "Going home", the privacy/terms
agreement, and support contact details. Used **only** by `components/layout/index.js` (line 236:
`<SlickHeader />`).

### 2.2 Props / exported API

```js
const Head = () => { … }
export default Head;
```

**No props.** Takes nothing, reads nothing (no context, no env, no state).

### 2.3 State & effects

None. The only locally declared binding is `var settings = {…}` (an object literal re-created on every render — a
`useMemo` candidate, harmless here since the component never re-renders).

```js
var settings = {
  dots: true,
  infinite: true,
  speed: 1000,
  slidesToShow: 1,
  slidesToScroll: 1,
  autoplay: true,
  autoplaySpeed: 10000,
  draggable: false,
};
```

### 2.4 Data & APIs

None — purely static copy. No `fetch`/`axios`/socket/SDK.

### 2.5 Rendering — exact strings

```
<div className="panel panel-default bg-light text-auto rounded p-4 px-5">
  <Slider {...settings}>
```

| # | Title (`base-color font-semibold fs-25 col-md-6`) | Body (`slick-content font-medium fs-21 text-center`) |
| --- | --- | --- |
| 1 | `Using locker to play or go home?` | `Enjoy unlimited access to open and store loose items inside the locker. Click ` + `<string> "Going home"</string>` + ` when you're about to leave JCastle.` |
| 2 | `Privacy Policy` | `By using this smart locker, you agree to QUBE's ` `<strong>Terms of Use</strong>` ` and ` `<strong>Privacy Policy</strong>` |
| 3 | `QUBE 24/7 Support` | `For concerns and inquiries, contact our customer support at ` `<strong> 09176320343 / 09171292877 </strong>` ` or ` `<strong>support@qubesmart360.com</strong>` |

Slide 1 contains the literal JSX element **`<string>`** (`Click <string> "Going home"</string>`), which is not an HTML
element — React emits an unknown `<string>` tag around the text and the leading space inside the quotes is preserved.
It was presumably meant to be `<strong>`.
Slide 3 support numbers (`09176320343 / 09171292877`) differ from the footer numbers in `Layout`
(`0913123123123 / 1231231321`), and the privacy modal contact is `+639177010419 / +639176320343`. Three different
support-number sets exist in the same shell.

### 2.6 Interactions & business rules

* Autoplay every `10000 ms`; transition `speed: 1000 ms`; `infinite: true`; `draggable: false` (kiosk-safe: users
  cannot swipe); dots enabled.
* `globals.css` hides the arrows: `.slick-arrow { pointer-events: none; display: none; }` and moves the dots to the
  top right: `ul.slick-dots { top: 0; text-align: right; }`, with the active dot as a `#50ba84`→`#15abd0` gradient.
* Relative `next/image` and `Player` rules apply.

### 2.7 Hardware integration

None.

### 2.8 Imports

| Import | Kind | Purpose |
| --- | --- | --- |
| `Slider` from `react-slick` | external | The carousel. |
| `slick-carousel/slick/slick.css` | external CSS | Base slider styles — **imported inside a component** (legacy global-CSS pattern; illegal in App Router, and a duplicate-import hazard if `Head` is ever rendered twice). |
| `slick-carousel/slick/slick-theme.css` | external CSS | Theme (dots/arrow defaults). |

### 2.9 Legacy → modern notes

* **Client-only:** Slick manipulates the DOM, needs layout measurement, and autoplays — cannot be a Server Component.
* Static text itself is server-renderable; a modern approach is a CSS-only `scroll-snap` carousel (zero JS) or a
  `use client` component with `useEffect`-driven index and `prefers-reduced-motion` support. Move the two CSS imports
  into the global stylesheet / `layout.tsx`.
* Marketing copy ("Going home", JCastle) is deployment-specific and should be content, not hard-coded JSX.

---

## 3. `src/components/layout/door/index.js` — `DoorList`

### 3.1 Purpose

The home screen's locker grid **and** the offline outbox drainer. It (a) reconciles the locker-controller door list
into the local `json-server` database, (b) renders selectable door tiles with occupied/vacant styling, (c) flushes
three local queues (`ForPosting`, `ForPatching`, `ForPostingPayments`) to the remote API when not in promo mode, and
(d) purges stale same-day booking records. Used by `src/pages/home/index.js` only.

### 3.2 Props / exported API

```js
const DoorList = ({ setLockerLocation, setDoorNumber, setLockerAlias, setDoorStatus }) => { … }
export default DoorList;
```

| Prop | Type | Default | Purpose at call site (`pages/home/index.js`) |
| --- | --- | --- | --- |
| `setLockerLocation` | `(value: string) => void` | none (undefined if omitted) | `setLockerLocation` state setter |
| `setDoorNumber` | `(value: string) => void` | none | `setDoorNumber` state setter |
| `setLockerAlias` | `(value: string) => void` | none | `setLockerAlias` state setter |
| `setDoorStatus` | `(value: number) => void` | none | `setDoorStatus` state setter |

All four are called together by `selectDoor`. Because Home's effect (`useEffect(…, [doorNumber, lockerLocation, doorStatus, lockerAlias])`)
fires as soon as `doorNumber != null && lockerLocation != null`, the four setters are effectively a
"navigate to `/details`" trigger.

### 3.3 State, refs, effects

| Hook | Initial | Notes |
| --- | --- | --- |
| `useState(false)` → `dataFetched` | `false` | One-shot latch used inside the loop of `fetchDataAndPost` to avoid re-listing on every door. |
| `useState([])` → `doorLists` | `[]` | Raw `json-server` collection; rendered with `Object.values(doorLists)`. |
| `useState(false)` → `isRefreshPageModalVisible` | `false` | "Promo expired" blocker modal. |
| `useAppContext()` → `{ localDatabaseUrl }` | — | `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO` when `isPromoActive()`, else `NEXT_PUBLIC_LOCAL_URL_DATABASE`. |

No `useRef`, no `useMemo`, **no effect cleanup** anywhere in the component.

Three mount-only effects, in source order:

```js
useEffect(() => { fetchPrevData(); }, []);                       // (A) day-rollover purge
useEffect(() => {                                                // (B) offline outbox drain
  if (!isPromoActive()) { postingPendingPayments(); postingPending(); patchingPending(); }
}, []);
useEffect(() => { fetchDataAndPost(); }, []);                    // (C) list reconcile + seed
```

(A) `fetchPrevData()` — `GET ${NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS}`; if `response.data.length > 0`, for each
`locker`: **if `locker.id === '' || undefined || null` → `return`** (this aborts the *whole* function, not just that
iteration — a `continue` bug); else if `new Date().getDate() !== new Date(locker.timeIn).getDate()` →
`axios.delete(`${NEXT_PUBLIC_LOCAL_URL_LOCKER_DETAILS}/${locker.id}`)`. Deletes are fire-and-forget (not awaited).
Any throw → `return null`.

(B) Promo gate is evaluated **once at mount** only; no interval, no retry, no visibility/online listener, so a kiosk
left running overnight never drains the queues again until reload.

(C) `fetchDataAndPost()` — see 3.4.

### 3.4 Data & APIs

`fetchDoors()`
```js
const response = await axios.get(localDatabaseUrl);   // GET http://localhost:3001/LocalDatabase
setDoorLists(response.data);
```
Failure → `return null` (silent; grid stays empty).

`checkDuplicateById(id)` — `GET ${localDatabaseUrl}/${id}` (e.g. `/LocalDatabase/A12`); returns `response.data`, or
`null` on error. Note json-server returns `404` → axios throws → `null`, so "not found" and "network down" are
indistinguishable (a network outage makes every door look absent, and the next step then re-seeds all of them).

`postDataToDatabase(dataToPost)` — `POST ${localDatabaseUrl}`; on success `console.log('lkjasdflkjsdf')` (debug
leftover) then `fetchDoors()`; on error `console.error(postError)`.

`fetchDataAndPost()`
```js
fetchDoors();                                        // not awaited
const response = await axios.get("/api/getDoors");   // same-origin Next API route → proxies the locker controller
const doors = response.data.data.doors;              // object keyed by door number
const payType = isPromoActive() ? "PROMO" : "";
for (const val of Object.keys(doors)) {
  const existingData = await checkDuplicateById(val);
  if (!existingData) {
    const lockerLocationResponse = await axios.get(`${process.env.NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS}`);
    const lockerLocation = lockerLocationResponse.data.location;
    const dataToPost = { … };                        // seed record, see below
    postDataToDatabase(dataToPost);                  // not awaited
  } else if (!dataFetched) {
    fetchDoors();
    setDataFetched(true);
  }
}
```
Errors → `console.error(err)`.

Exact seed record written for every door missing locally (note `transID` appears **twice** in the object literal —
the second (`""`) wins; `payType` is `"PROMO"` during a promo window, otherwise `""`):

```js
{
  transID: "",
  lockerLocation: lockerLocation,   // from NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS → .location
  doorSize: "L",
  doorStatus: 0,
  paymentStatus: "",
  payType,
  amount: "",
  doorOpenCount: "",
  mpin: "",
  timeIn: "",
  timeOut: "",
  alias: "",
  id: val,
  doorNumber: val,
  refNumber: "",
  transStatus: "",
  refNum: "",
  transID: "",          // duplicate key
  transNumber: "",
  billsCounter: [0, 0, 0],
}
```

`postingPendingPayments()` — `GET ${NEXT_PUBLIC_LOCAL_URL_FOR_POSTING_PAYMENTS}`; per record:
* `payments.posted === true` → `DELETE ${…ForPostingPayments}/${payments.id}` (fire-and-forget).
* else → `POST ${NEXT_PUBLIC_API_PAYMENT_STATUS}` with body
  `{ amount, location, name, description, payType, billsCounter }` → `.then(res => { const transId = res.data.data.transNumber; … })`:
  1. `PATCH ${localDatabaseUrl}/${payments.doorNumber}` `{ refNum: transId, refNumber: transId }`
  2. `PATCH ${…ForPostingPayments}/${payments.id}` `{ posted: true }`
  3. `GET ${NEXT_PUBLIC_LOCAL_URL_FOR_POSTING}?lockerID=${payments.lockerID}` → `.then(response =>
     PATCH ${…ForPosting}/${response.data[0].id}` `{ transNumber, refNum, transID, refNumber }`)` — indexes
     `response.data[0]` with no length guard (throws `TypeError` inside a `.then`, i.e. an unhandled rejection, if empty).
* `.catch` deliberately swallows the error; in-code comment: *"Silently suppress — refNum doesn't exist in external API
  for locally-generated references (e.g. cash payments). Record stays in local queue for retry."*

`postingPending()` — `GET ${NEXT_PUBLIC_LOCAL_URL_FOR_POSTING}`; per `locker`:
* falsy `locker.transNumber` → **`return null`** (aborts the whole loop, leaving later records unprocessed).
* `locker.posted === true` → `DELETE ${…ForPosting}/${locker.id}`.
* else `await fetch(process.env.NEXT_PUBLIC_API_URL_POST, { method: "POST", headers: { "Content-Type":
  "application/json", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", Pragma: "no-cache" },
  body: JSON.stringify(locker) })` — the **whole** local record is posted verbatim (including `lockerID`, `id`,
  `qpin`, `billsCounter`). If `postResponse.ok` → `PATCH ${…ForPosting}/${locker.id}` `{ posted: true }`. Non-OK
  responses are ignored (no else branch).

`patchingPending()` — `GET ${NEXT_PUBLIC_LOCAL_URL_FOR_PATCHING}`; per `locker`:
* `locker.patched === true` → `DELETE ${…ForPatching}/${locker.id}`.
* else `PATCH ${NEXT_PUBLIC_API_URL_PATCH}` with exactly
  `{ lockerLocation, qpin: locker.mpin, timeOut, doorNumber, transStatus, refNum: locker.refNumber, refNumber: locker.refNumber }`
  → `.then(() => PATCH ${…ForPatching}/${locker.id}` `{ patched: true })`; `.catch` silent, same comment about
  locally-generated refNumbers.

**Transport/API summary (client-side):** `axios` for json-server (`localhost:3001`), same-origin `axios.get("/api/getDoors")`,
`axios.get(NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS)` (`localhost:9090`), `fetch`+`axios` for the three remote endpoints.
No sockets, no hardware SDK calls.

### 3.5 Rendering

```
<>
  {isRefreshPageModalVisible ? <promo-expired modal> : ""}
  <div className="door_list">
    {Object.values(doorLists).map((val, index) => {
      const doorStatusClass = val.doorStatus === 1 ? "btn-gradients text-light" : "bg-light text-dark";
      return (
        <div key={index} className="door-list">
          <div className={`border rounded font-semibold fs-31 d-flex flex-column justify-content-center align-items-center m-1 doors  ${doorStatusClass}`}
               onClick={() => selectDoor(val.doorNumber, val.lockerLocation, val.doorStatus, val.alias, val.payType)}>
            <div className="col-md-12 text-center">{val.lockerLocation}{val.doorNumber}</div>
            {(() => { if (val.doorStatus == 1) return (<div className="col-md-12 text-center fs-25 font-black text-uppercase">{val.alias}</div>); })()}
          </div>
        </div>
      );
    })}
  </div>
</>
```

* Tile label is the concatenation of locker location and door number with no separator (e.g. `A12`), driven by
  `lockerLocation` + `doorNumber` from the DB record.
* Occupied tile (`doorStatus === 1`, loose `===` for the class, loose `==` for the alias) gets the brand gradient and
  shows the **alias** in uppercase; `doorStatus === 0` gets `bg-light text-dark`. `payType` is not visually
  distinguished in the UI (promo doors look identical to paid doors).
* `key={index}` (index keys — reordering/re-fetching re-mounts tiles).
* Tile size comes from `globals.css`: `.door-list .doors { width: 10rem; height: 10rem; }` (the commented-out
  `12.7rem/180px` variant remains), grid from `.door_list { grid-template-columns: auto auto auto auto auto; gap: 1rem; margin-bottom: 100px; }`.

**Promo-expired modal (exact strings)** — `.end-modal-bg` with inline `display:flex; justifyContent:center;
alignItems:center; height:100vh; padding:1rem`, inner `.end-modal.fade-in-top` with inline
`width:70%; maxWidth:800px; height:auto; maxHeight:25%; borderRadius:10px; padding:2rem; boxSizing:border-box`:
* `Promo expired` — `text-center pt-4`, inline `fontSize: clamp(24px, 5vw, 70px)`, `fontWeight: bold`
* `Click refresh to return to normal mode` — `text-center mt-2`, inline `fontSize: clamp(16px, 2.5vw, 36px)`
* Button `border rounded-10 d-flex justify-content-center align-items-center mx-auto mt-5`, inline
  `backgroundColor: "#50BA84"`, `padding: "1rem"`, `fontSize: clamp(14px, 2vw, 24px)`, `width: clamp(150px, 60%, 250px)`,
  `onClick={() => window.location.reload()}`; content = `<Image src={refresh} alt="Refresh icon" className="pr-2" width={30} height={30} />`
  + `<div className="p-2" style={{color:"white"}}>Refresh</div>`.

### 3.6 Interactions & business rules

* `selectDoor(doorNumber, lockerLocation, doorStatus, alias, payType)`:
  ```js
  if (!isPromoActive() && payType === "PROMO") {
    // alert("In promo mode, the page will reload to activate the Normal Mode");
    // window.location.reload();
    setIsRefreshPageModalVisible(true);
  } else {
    setLockerLocation(lockerLocation); setDoorNumber(doorNumber);
    setDoorStatus(doorStatus);        setLockerAlias(alias);
  }
  ```
  A door *last used during a promo* cannot be opened after the promo ends until the page is hard-reloaded; the
  commented-out `alert`/`reload` are dead code.
* Same-day purge rule (`fetchPrevData`): records whose `timeIn` is not today are deleted from `LockerDetails`
  (compares **day-of-month only**, so the 15th of a different month matches the 15th of this month).
* Offline-first rule: all three remote writes are queued locally and retried on every mount while promo is inactive;
  `posted`/`patched` booleans are the idempotency flags for queue entry deletion.
* No keyboard, no scan detection, no timers in this component (scan detection lives in `pages/home/index.js`).
* Bootstrapping writes are sequential (`await` inside `for…of`), so first paint of a cold kiosk is slow: N × (`GET /LocalDatabase/:id` + `GET lockerdetails`) round-trips.

### 3.7 Hardware integration

Indirect only: `GET /api/getDoors` → `pages/api/getDoors.js` → locker controller `…/api/lockercontroller/doors`, and
`GET ${NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS}` (`…/api/lockercontroller/lockerdetails` → `.location`) to stamp each
new local record with its cabinet location. **No door-open command is issued from this component** — opening happens
from `/details`, `/payment`, and `/cashpayment` via the HTTP controller endpoint (see §7).

### 3.8 Imports

| Import | Kind | Purpose |
| --- | --- | --- |
| `{ useState, useEffect }` from `react` | external | Component state + 3 mount effects. |
| `axios` from `axios` | external | All HTTP calls in this component. |
| `{ useAppContext }` from `@/context/app` | internal | Promo-aware `localDatabaseUrl`. |
| `{ isPromoActive }` from `@/utils/isPromoActive` | internal | Promo gate for payType, queue drain, and `selectDoor`. |
| `Image` from `next/image` | external | Refresh icon in the modal. |
| `refresh` from `@/assets/img/refresh.png` | internal asset | Refresh icon. |

### 3.9 Legacy → modern notes

* **Must be client-side:** tile `onClick`, the promo modal, `window.location.reload()`, and any code touching
  `window`/`localStorage`-style device state. Socket/SDK access would also be client-only.
* **Can move server-side:** the *rendering* of the door grid — a Server Component fed by a Route Handler
  (`GET /api/doors`, already written against Mongo, plus `GET /api/getDoors` for the controller view) can render the
  tiles; only the click behaviour needs `"use client"`. The local-queue drain (`postingPending`,
  `patchingPending`, `postingPendingPayments`) is background integration work and belongs in a scheduled worker /
  Route Handler with `fetch` + `cache: "no-store"`, not in a React mount effect. `NEXT_PUBLIC_LOCKER_CONTROLLER_*`
  being public is incidental — a Route Handler could hold the controller origin privately.
* Concrete defects a modernization should fix: `return` vs `continue` in `fetchPrevData` and `postingPending`;
  `response.data[0]` without a length check; unawaited `axios` calls that cause unhandled rejections;
  `console.log('lkjasdflkjsdf')`; `key={index}`; `payType` invisible in the UI; `NEXT_PUBLIC_*` secrets used as
  queue guards; no backoff/online listener for the outbox.

---

## 4. `src/components/layout/keyboard/index.js` — `KeyboardLayouts`

### 4.1 Purpose

The on-screen numeric PIN keypad (0–9 plus delete-all) shown to the user when entering a locker PIN. Used by
`src/pages/details/index.js` (`<Keyboard setPin={setPin} disableKey={disableKey} />`, line 554) and
`src/pages/admin/changepin.js` (`<Keyboard setPin={setPin} />`, line 141).

### 4.2 Props / exported API

```js
const KeyboardLayouts = ({ setPin, setDisableKey }) => { … }
export default KeyboardLayouts;
```

| Prop | Type | Default | Actually passed by |
| --- | --- | --- | --- |
| `setPin` | `(value: string) => void` (invoked as `setPin(quickpin)`) | none | `details` (`setPin` from `useState([])`), `admin/changepin` (`setPin` from `useState([])`) |
| `setDisableKey` | `boolean` | none | **Nobody passes this name.** `details` passes `disableKey={disableKey}`; `admin/changepin` passes nothing. |

The component also does **not** consume the `disableKey` that `details` actually sends — the prop is silently dropped.
Effect B below therefore keys off `undefined` in `changepin` and off a **snapshot** of `false` in `details`.

### 4.3 State, refs, effects

| Hook | Initial | Notes |
| --- | --- | --- |
| `useState([])` → `quickpin` | `[]` | Becomes a `string` after the first digit; only ever read via `.length`, `.slice()`, and `[...prev, e].join("")`. |
| `useState(true)` → `disableNext` | `true` | **Computed but never rendered** — the "Next"/submit button lives in the parent page. Dead state. |
| `useState(false)` → `disableKeys` | `false` | Disables the digit buttons at 6 digits. |
| `useState({clear:"", enter:""})` → `keyTexts` | `{clear:"",enter:""}` | **Never read or written.** Dead state. |

```js
useEffect(() => {                     // (A) [quickpin]
  setPin(quickpin);
  if (quickpin.length === 6) { setDisableNext(false); setDisableKeys(true); }
  else if (quickpin.length === 0) { setDisableNext(true); setDisableKeys(false); }
  else { setDisableNext(true); setDisableKeys(false); }
}, [quickpin]);

useEffect(() => {                     // (B) [setDisableKey]
  if (setDisableKey === false) { clear(); }
}, [setDisableKey]);
```

No refs, no memo, **no cleanup, no timers**.

```js
const handleClick = (e) => { setQuickpin((prevState) => [...prevState, e].join("")); };
const backSpace  = () => { setQuickpin((previousArr) => previousArr.slice(0, -1)); };
const clear      = () => { setQuickpin(""); };
```

`handleClick` spreads `prevState`: `[]` → `["1"]` → `"1"` → `["1","2"]` → `"12"` … so it works, but it depends on
`String` being spreadable and would break if a digit were ever passed as a multi-char string.

### 4.4 Data & APIs

**None.** No `fetch`, no `axios`, no socket, no SDK. The PIN never leaves the component except through `setPin`;
verification happens in the parent page (e.g. `details` compares against `mpin` via
`GET ${localDatabaseUrl}?alias=${alias}&mpin=${pin}&doorNumber=${doorNumber}`).

### 4.5 Rendering

```
<div className="col-md-8 mx-auto mt-5"
     style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', justifyItems:'center', alignItems:'center' }}>
  {KeyboardLayout.map(val => { … })}
</div>
```

Per entry of `@/utils/keyboard` (16 entries):

| Branch (exact test) | Output |
| --- | --- |
| `val.keyID != "" && val.keyID != "bckspc" && val.keyID != "clr" && val.keyID != "nxt"` | `<div key={val.id}><button className=" mx-2 my-2 keyboard btn-gradients keys text-light rounded d-flex align-items-center justify-content-center fs-31 font-semibold border-0" onClick={() => handleClick(val.keyID)} disabled={disableKeys}>{val.keyID}</button></div>` |
| `val.keyID == "bckspc" && …` | button `className="opacity-50 mx-2 my-2 keyboard keys  bg-dark text-light rounded d-flex align-items-center justify-content-center fs-31 font-semibold border-0"`, `onClick={() => backSpace()}`, content `<Image src={backspace} alt="" />` — **no `disabled` attribute: backspace stays clickable after 6 digits** |
| `val.keyID == "clr" && …` | button `className="opacity-50 mx-2 my-2 keyboard keys  bg-dark text-light rounded d-flex align-items-center justify-content-center fs-25 font-light border-0"`, `id="clear"`, `onClick={() => clear()}`, content `<span className="font-semibold fs-21">Clear all</span>` — also **not disabled** by `disableKeys` |
| else (`""` and `"nxt"`) | invisible placeholder: `<button className="pe-none opacity-0 mx-2 my-2 keys  keyboard cta-default text-dark rounded d-flex align-items-center justify-content-center fs-31 font-semibold border-0"></button>` |

Effective 4×4 keypad: `1 2 3 ⌫ / 4 5 6 Clear all / 7 8 9 (blank) / (blank) 0 (blank) (blank→nxt)`.
`nxt` therefore renders as an invisible, non-interactive button — the design intends the parent page to supply the
submit action.

### 4.6 Interactions & business rules

* Max PIN length **6** digits; at length 6 the digits are disabled (`disableKeys = true`), but delete/clear remain
  active so the user can recover.
* `setPin` is called on **every** keystroke (not just on submit) — the parent holds a live, partially-entered PIN.
* `disableNext` is maintained but unused → the parent cannot rely on this component to gate submission; each parent
  re-implements its own length check.
* Effect B is meant as "parent asked me to reset": it fires only when `setDisableKey` transitions to a value
  **strictly equal to `false`**. Consequences as wired today: in `details` the value is a constant `false` snapshot,
  so `clear()` runs exactly once on mount; in `admin/changepin` the prop is `undefined`, so it never runs.
  `details` instead calls its own `setDisableKey(false)` (a different setter feeding a different, unused boolean).
* No physical-keyboard/scan handling here; no navigation; no timers.

### 4.7 Hardware integration

None — the keypad is pure UI. (Physical barcode/scanner input for the hidden admin route is handled in
`pages/home/index.js` via `use-scan-detection`, not here.)

### 4.8 Imports

| Import | Kind | Purpose |
| --- | --- | --- |
| `{ useState, useEffect }` from `react` | external | Keypad state + the two effects. |
| `KeyboardLayout` from `@/utils/keyboard` | internal data | The 16-entry key descriptor array. |
| `backspace` from `@/assets/img/clear-icon.svg` | internal asset | Delete-one glyph. |
| `next` from `@/assets/img/chevron_left.svg` | internal asset | **Unused** (the `nxt` key renders as an invisible placeholder). |
| `Image` from `next/image` | external | Renders the backspace icon. |
| `{ SYMBOL_CLEARED_COOKIES }` from `next/dist/server/api-utils` | external **internal Next.js module** | **Unused dead import.** This is a server-only internal path (`next/dist/server/api-utils`); importing it into a client component is a red flag — in the Pages Router it happens to be tree-shaken away, but in App Router/Edge builds this class of import breaks the client bundle and it changes between Next minor versions. Must be deleted. |

### 4.9 Legacy → modern notes

* **Must be client-side:** all key handling is interactive state.
* A modern version should: rename the prop contract (`disabled` + `onClear`/`resetSignal`, or a `usePinInput` hook),
  delete `disableNext`/`keyTexts`/`next`/`SYMBOL_CLEARED_COOKIES`, and derive disabled state from `quickpin.length`
  in one place. PIN verification should move to a Server Action / Route Handler so the stored `mpin` is never shipped
  to the browser (today `details` does a client-side `GET /LocalDatabase?mpin=…`, exposing every PIN in the kiosk LAN
  and relying on a query-string match for authorization). Digit buttons should be `<button type="button" inputMode="numeric">`
  with `aria-label`s, and the pin display should use `-webkit-text-security` (already used by `.view`/`.view-admin`)
  rather than plain state.

---

## 5. `src/utils/hardwareClient.js` — client-side hardware SDK singleton

### 5.1 Purpose

Browser-side façade over `hardware-controller-sdk`'s `HardwareControllerClientSDK`. It owns the single socket.io
connection to the hardware server and exposes the bill-acceptor operations the kiosk uses. Comment header:
*"Hardware Controller SDK — Client-side Bill Acceptor Utility … Provides a singleton HardwareControllerClientSDK
instance and convenience functions for bill acceptor operations (start/end session, approve/reject held bills, status
check)."*

Used by: `pages/cashpayment/index.js` (`startBillSession`, `endBillSession`, `approveBill`, `rejectBill`,
`ensureConnected` — note `approveBill`/`rejectBill` are imported and `rejectBill` is called on `hold`;
`approveBill` is imported but unused), `pages/details/index.js` (`endBillSession`),
`pages/paymentselection/index.js` (`endBillSession`).

### 5.2 Props / exported API (module API)

| Export | Signature | Returns | Implementation |
| --- | --- | --- | --- |
| `getHardwareClient()` | `()` | `HardwareControllerClientSDK` | Lazily builds the singleton `clientInstance`. |
| `startBillSession(totalAmount, transactionId?, onInsert?)` | `(number, string?, (event) => void)` | `Promise<{completed:boolean, data?:object, error?:string}>` | `client.billAcceptor.startBillSession(totalAmount, transactionId, onInsert)` |
| `endBillSession()` | `()` | `Promise<void>`-ish | `client.billAcceptor.endBillSession()` |
| `approveBill()` | `()` | `Promise<void>`-ish | `client.billAcceptor.approveBill()` |
| `rejectBill()` | `()` | `Promise<void>`-ish | `client.billAcceptor.rejectBill()` |
| `ensureConnected()` | `()` | `Promise<void>` | `await client.sdk?.ensureConnected()` if that function exists; otherwise resolves immediately |
| `getBillAcceptorStatus()` | `()` | `Promise<{success:boolean, data?:{status:string}, error?:string}>` | `client.billAcceptor.getStatus()` |
| `getAcceptedBillsTotal()` | `()` | `Promise<{totalBillsCount:number, totalBillsAmount:number, storedBills:Array}>` | `client.billAcceptor.getAcceptedBillsTotal()` |

Module-level state: `let clientInstance = null;` — never reset, never disposed; **no export to disconnect**
(only `HardwareControllerClientSDK.disconnect()`/`destroy()`, which this wrapper does not surface).

`getBillAcceptorStatus`/`getAcceptedBillsTotal` are **not called anywhere in the app** (dead API surface).

### 5.3 Connection resolution (exact)

```js
function getServerUrl() {
  if (typeof window !== 'undefined') {
    const socketPort = process.env.NEXT_PUBLIC_HARDWARE_SOCKET_PORT || window.location.port;
    return `${window.location.protocol}//${window.location.hostname}:${socketPort}`;
  }
  return `http://localhost:${process.env.NEXT_PUBLIC_HARDWARE_SOCKET_PORT || '3000'}`;
}
export function getHardwareClient() {
  if (!clientInstance) {
    const serverUrl = getServerUrl();
    const token = process.env.NEXT_PUBLIC_HARDWARE_ACCESS_KEY || '';
    clientInstance = new HardwareControllerClientSDK(serverUrl, token);
  }
  return clientInstance;
}
```

* Transport: **socket.io** (`socket.io-client`), not raw `WebSocket`. The kiosk browser connects to
  `protocol://hostname:port` derived from the current page (`http://localhost:3000` in the default dev/prod setup),
  i.e. the **Next.js custom server itself** — `server.js` attaches a `SocketIOServer` to the same `http.Server` it
  gives to Next.
* Auth: the constructor's second argument becomes socket.io `auth: { token }`, taken from
  `NEXT_PUBLIC_HARDWARE_ACCESS_KEY`; the matching server-side key is `HARDWARE_ACCESS_KEY ||
  NEXT_PUBLIC_HARDWARE_ACCESS_KEY`, and `server.js` **exits the process** (`process.exit(1)`) if neither is set.
* Secret exposure: the hardware access token is a **build-time `NEXT_PUBLIC_*` value inlined into the client bundle**;
  anyone with the kiosk page can read it and command the hardware socket.

### 5.4 SDK construction & reconnection logic (verbatim behaviour)

`HardwareControllerClientServerSDK`-paired client is constructed with:

```js
io(serverUrl, {
  autoConnect: false,
  auth: token ? { token } : undefined,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 10000,
});
```

Handlers installed by the SDK:
* `on('connect')` → `console.log('[SDK-Client] Connected')`, `connectionPromise = null`
* `on('disconnect', reason)` → `console.log('[SDK-Client] Disconnected:', reason)`, `connectionPromise = null`
* `on('connect_error', err)` → `console.error('[SDK-Client] Connection error:', err.message)`, `connectionPromise = null`
* `on('reconnect', attemptNumber)` → `console.log('[SDK-Client] Reconnected after ${attemptNumber} attempts')`
* `on('reconnect_failed')` → `console.error('[SDK-Client] Failed to reconnect after maximum attempts')`

`ensureConnected()` (SDK-internal, surfaced via this wrapper):
1. `if (this.isDestroyed) throw new Error('Socket client has been destroyed')`
2. `if (this.socket.connected) return` (immediate resolve)
3. `if (this.connectionPromise) return this.connectionPromise` (**de-duplicates concurrent connect attempts**)
4. Otherwise create a promise with a `setTimeout(…, 10000)` that rejects `new Error('Connection timeout')`; register
   `once('connect')`/`once('connect_error')`; call `socket.connect()`.
5. On `connect`/`connect_error`/`disconnect` the cached `connectionPromise` is cleared, so the next call re-attempts.

**Reconnection rules, concretely:** socket.io's own reconnection is capped at **5 attempts with 1 s delay** and no
backoff; after `reconnect_failed` there is **no application-level retry** — every wrapper call simply calls
`ensureConnected()` again, which will happily `socket.connect()` anew, so recovery depends on the caller retrying
(in practice: the next page mount). There is no heartbeat/keepalive setting beyond the SDK default, no
`visibilitychange`/`online` hook, and no UI signal for connection state (the cashpayment page only shows a
"Connecting to Bill Acceptor…" overlay for the first attempt).

### 5.5 Device commands / events (exact socket.io names, from the vendored SDK)

`HardwareControllerClientSDK` methods all funnel into `HardwareControllerSdkSocketClient`, which emits these event
names (`SOCKET` constant, `hardware-controller-sdk/build/client/socket.types.js`) and resolves via ack-style
callbacks with `SocketResponse<T> = { completed: boolean, data?: T, error?: HardwareError }`. On failure the client
synthesises `error: { code: 'SOCKET_ERROR', message: 'Unknown error' }`.

| Wrapper surface | Emitted event | Payload | Ack / listener events |
| --- | --- | --- | --- |
| `locker.getDoors()` | `locker:getDoors` | — | ack |
| `locker.getDoorStates(doorIds?)` | `locker:getDoorStates` | `doorIds` | ack |
| `locker.openDoor(doorIds)` | `locker:openDoor` | `doorIds` | ack |
| `locker.openDoorWithState(doorIds, onClose?)` | `locker:openDoorWithState` | `doorIds` | listener `locker:onClose` (doorId) |
| `nfc.beep.getBalance(...)` | `nfc:beep:getBalance` | — | listeners `nfc:beep:onReading`, `nfc:beep:onRemove` |
| `nfc.beep.credit(...)` | `nfc:beep:credit` | `{ amount, uid }` | same listeners |
| `nfc.beep.debit(...)` | `nfc:beep:debit` | `{ amount, uid }` | same listeners |
| `nfc.beep.forceStopSession()` | `nfc:beep:forceStopSession` | — | ack |
| `billAcceptor.startBillSession(total, transactionId?, onInsert?)` | `billAcceptor:startSession` | `{ total, transactionId }` | **listener `billAcceptor:onInsert` registered before the emit and removed inside the ack callback** |
| `billAcceptor.endBillSession()` | `billAcceptor:endSession` | — | ack |
| `billAcceptor.approveBill()` | `billAcceptor:approveBill` | — | ack |
| `billAcceptor.rejectBill()` | `billAcceptor:rejectBill` | — | ack |
| `billAcceptor.getAcceptedBillsTotal()` | `billAcceptor:getAcceptedTotal` | — | ack |
| `billAcceptor.getStatus()` | `billAcceptor:getStatus` | — | ack |
| `billAcceptor.reboot()` | `billAcceptor:reboot` | — | ack |
| `billAcceptor.resetAcceptedBillsTotal()` | `billAcceptor:resetTotal` | — | ack |
| `cardDispenser.dispense/addStocks/deductStocks/clearStocks/getStocks/getLogs/clearLogs` | `cardDispenser:dispense` `{…}` / `addStocks` `{cardDispenserId, quantity}` / `deductStocks` `{id, quantity, transactionId}` / `clearStocks` / `getStocks` / `getLogs` / `clearLogs` | — | listeners `cardDispenser:onDispensing`, `cardDispenser:onWaitingToClaim`, `cardDispenser:onSuccessClaim`, `cardDispenser:onError` (installed only when `events` is supplied) |

Bill-acceptor data shapes (from `build/core/hardwares/bill-acceptor/types/BillAcceptor.types.d.ts`):

```ts
type BillInsertStatus = 'accepted' | 'rejected' | 'hold' | 'auto-rejected';
interface BillInsertEventData { totalInsertedAmount: number; insertedAmount: number; totalAmount: number;
                               remainingAmount: number; overAmount?: number; status: BillInsertStatus; }
interface BillInsertEvent { accepted: boolean; status: BillInsertStatus; data?: BillInsertEventData; error?: string; }
interface BillSessionCompletionData { totalAmountInserted: number; denomination: number[]; }
interface AcceptedBillsTotalData { totalBillsCount: number; totalBillsAmount: number; storedBills: IBill[]; }
interface IBill { transactionId?: string; amount: number; timestamp: Date; }
```

**Server side, for completeness:** `server.js` creates
`new SocketIOServer(server, { cors: { origin: '*', methods: ['GET','POST'] } })` and
`new HardwareControllerClientServerSDK(io, hardwareSocketKey)` → `await sdk.initialize()`. So the browser client and
the hardware broker share one origin/port; there is no separate `NEXT_PUBLIC_BILL_ACCEPTOR_URL` in the SDK path
(`http://localhost:5000/send-command` is the **legacy HTTP** route, still in `.env` as
`NEXT_PUBLIC_LOCKER_CONTROLLER_BILL_ACCEPTOR` but not used by `hardwareClient.js`).

### 5.6 The bill-acceptor / cash flow, end to end (as wired)

`pages/cashpayment/index.js` (`DOOR_RATE = parseInt(process.env.NEXT_PUBLIC_DOOR_RATE || "200", 10)`):

1. Mount effect (`[]` deps): render the bill-acceptor Lottie; `transactionId = `CASH-${doorNumber}-${Date.now()}``.
2. `ensureConnected()` → then a deliberate `setTimeout(…, 3000)` (comment: *"Keep the loading screen visible for
   3 seconds so the user has visual feedback that the bill acceptor is initializing"*) → `setIsConnecting(false)`.
3. `startBillSession(DOOR_RATE, transactionId, onBillInsert)` — long-running; the promise resolves when the session
   completes.
4. `onBillInsert(event)`:
   * `status === "accepted"` → read `{ insertedAmount, totalInsertedAmount, remainingAmount }`;
     `setCurrentTotal(totalInsertedAmount)`, `setCurrentBalance(remainingAmount)`; denomination counters
     (`insertedAmount === 50 | 100 | 200` → `current50/100/200`); reset the reminder alert; if
     `remainingAmount <= 0` → `hasCompletedRef.current = true; setPaymentStatus(1)`.
   * `status === "rejected"` → error text `Bill rejected. Only PHP 50, 100, and 200 bills are accepted.`
   * `status === "hold"` → sets `heldBillAmount`, error text
     `Excess amount inserted. Please insert exact amount.`, and **auto-calls `rejectBill()`** (comment:
     *"Auto-reject held bills since this machine doesn't give change"*), then clears `heldBillAmount`.
     (`approveBill` is imported but never used; the machine intentionally never holds.)
5. `useEffect(…, [paymentStatus])` when `paymentStatus === 1`: generate `cashRef = `QUBE-${lockerLocation || "1000"}-${Math.random().toString(36).substring(2,6)}``; `PATCH ${localDatabaseUrl}/${doorNumber}` with
   `{ lockerLocation, doorSize:"L", doorStatus:1, paymentStatus:"paid", payType:"CASH", amount:currentTotal, doorOpenCount:"1", mpin:pin, timeIn:dateNow, timeOut:"", alias, id:doorNumber, doorNumber, transStatus:"Active", billsCounter:[current50,current100,current200], refNumber:cashRef }`
   → `.then` → **open the door over HTTP**: `axios.get(`${NEXT_PUBLIC_LOCKER_CONTROLLER_DOOR_OPEN}/${doorNumber}/open`)`
   → inside that `.then`: `postPayment(cashRef)` (to `NEXT_PUBLIC_API_PAYMENT_STATUS`, with local `ForPostingPayments`/
   `ForPosting` fallbacks), `PATCH /api/transactions/{transID}` with
   `{ payType:"CASH", amount, timeIn, bookingStatus:"ready-for-pickup", billsCounter, refNumber:cashRef, refNum:cashRef }`
   (`refNum` is dropped by the API — see §11), `await endBillSession()`, then a 1.5 s "processing" interval and a
   6 s countdown (`timerText` starts at 6) that ends with `router.push({pathname:"/"}, "/", undefined, {shallow:true})`.
   Both intervals are cleared in the returned cleanup.
6. Back/Cancel: `handleBack` → if `currentTotal === 0` cancel immediately, else show the "Cancel Payment?" modal;
   `doCancelAndRoute`/`handleCancel` call `endBillSession()` (errors logged, never fatal), POST a
   `[JCASTLE]CANCELLED_PAYMENT[…]` record to `${NEXT_PUBLIC_API_PAYMENT_STATUS}` and fall back to the local queues on
   non-200, then `router.push("/paymentselection", { doorNumber, lockerLocation, pin, alias, transID })`.
7. Unmount cleanup (`[]` effect return): `isCancelled = true` and `endBillSession()` with error logging.

**Door open/close summary:** opening is `GET http://localhost:9090/api/lockercontroller/door/{doorNumber}/open`
(fire-and-forget `axios.get`, result ignored) from `pages/details/index.js` (3 call sites — cancel/complete, promo,
and existing-booking re-open), `pages/payment/index.js` (after QR/Narwhal success) and `pages/cashpayment/index.js`.
There is **no close command anywhere** in the app; the SDK's `locker:openDoor` / `locker:openDoorWithState`
(+ `locker:onClose`) and `locker:getDoorStates` are available but unused — the kiosk relies on the locker controller's
own auto-close.

### 5.7 Legacy → modern notes

* **Must stay client-side:** everything here. `window.location`-based URL discovery, the socket.io connection, and the
  bill-acceptor callbacks are browser/device-bound; Server Components and Server Actions cannot reach the user's
  bill acceptor or hold the session callbacks.
* **Should move off the public bundle:** `NEXT_PUBLIC_HARDWARE_ACCESS_KEY` is inlined into client JS. A modern design
  issues a short-lived, per-session token from a Route Handler (holding `HARDWARE_ACCESS_KEY` server-side) and passes
  it to the client component; the browser should never see the long-lived key.
* `hardwareClient.js` is a good candidate to become a typed `useHardwareClient()` hook (`useSyncExternalStore` for
  connection state) plus a `HardwareProvider`, which would fix the missing disconnect, the missing connection-state
  UI, and the unbounded 5-attempt reconnection policy (add capped exponential backoff + an online/visibility
  re-arm). The currently-unused `getBillAcceptorStatus`/`getAcceptedBillsTotal` should either be surfaced (health
  panel) or deleted.

---

## 6. `src/utils/keyboard.js` — static keypad descriptor

### 6.1 Purpose

A plain data module describing the keypad's 16 cells (4 columns × 4 rows) in DOM order. Consumed only by
`components/layout/keyboard/index.js` (`KeyboardLayout.map(...)`). No logic, no side effects, no imports.

### 6.2 Exported API

`export default Keyboard;` — an `Array<{ id: string, keyID: string }>` where `id` is the React `key` and `keyID` is
the emitted character or one of the sentinels `"bckspc"`, `"clr"`, `"nxt"`, `""` (blank cell).

Exact contents, in order:

| index | `id` | `keyID` | Meaning |
| --- | --- | --- | --- |
| 0 | `'1'` | `'1'` | digit 1 |
| 1 | `'2'` | `'2'` | digit 2 |
| 2 | `'3'` | `'3'` | digit 3 |
| 3 | `'4'` | `'bckspc'` | delete-one |
| 4 | `'5'` | `'4'` | digit 4 |
| 5 | `'6'` | `'5'` | digit 5 |
| 6 | `'7'` | `'6'` | digit 6 |
| 7 | `'8'` | `'clr'` | clear-all |
| 8 | `'9'` | `'7'` | digit 7 |
| 9 | `'10'` | `'8'` | digit 8 |
| 10 | `'11'` | `'9'` | digit 9 |
| 11 | `'12'` | `''` | blank |
| 12 | `'13'` | `''` | blank |
| 13 | `'14'` | `'0'` | digit 0 |
| 14 | `'15'` | `''` | blank |
| 15 | `'16'` | `'nxt'` | "next" — filtered out by the component and rendered as an invisible placeholder |

### 6.3 State / effects / data / rendering / hardware

None of these apply — it is a constant. The rendering contract lives entirely in §4.5.

### 6.4 Legacy → modern notes

Pure data, safe anywhere (server or client). A modernization should type it
(`type KeyId = Digit | 'bckspc' | 'clr' | 'nxt' | null`) and drop the `id`/`keyID` duplication and the `nxt` sentinel
if the submit button belongs to the parent.

---

## 7. `src/pages/api/doors.js`

### 7.1 Purpose

Read-only Mongo projection of the `doors` collection — the **modern** counterpart to the json-server list. Not
referenced by any page yet (a "forward-looking" endpoint).

### 7.2 Method / request

* Method: **`GET` only.** Anything else → `405` `{ success: false, error: 'Method not allowed' }`.
* Query: `?status=0|1` (optional). `status !== undefined` → `parseInt(status, 10)`; if the result is `0` or `1` →
  `filter.doorStatus = statusNum`. Any other value is silently **ignored** (no 400), i.e. `?status=abc` returns all doors.
* No body handling, no auth, no pagination, no projection (full documents returned).

### 7.3 Mongo / Mongoose

```js
await connectDB();
const doors = await Door.find(filter).sort({ doorNumber: 1 }).lean();
```

`connectDB()`/`Door` come from `src/lib/db.js` and `src/models/Door.js` (CommonJS `module.exports`, imported with ESM
syntax). `lib/db.js` is a module-scope singleton (`let isConnected = false`), `mongoose.set('strictQuery', true)`,
`serverSelectionTimeoutMS: 5000`, URI `process.env.MONGODB_URI || 'mongodb://ekMongoAdmin:…@localhost:27018/jcastle_kiosk?authSource=admin&replicaSet=rs0&directConnection=true'`,
logging `✅ MongoDB connected: ${conn.connection.host}:${conn.connection.port}/jcastle_kiosk` /
`❌ MongoDB connection failed: ${err.message}` and re-throwing (so a DB outage becomes the route's 500).

`Door` schema fields and defaults (returned verbatim by this route):
`doorNumber` (String, required, unique), `lockerLocation` (String, required), `doorSize` (String, enum `['S','M','L']`, default `'L'`),
`doorStatus` (Number, enum `[0,1]`, default `0`), `paymentStatus` (String, default `''`),
`payType` (String, enum `['', 'NARWHAL', 'CASH', 'PROMO']`, default `''`), `amount` (Number, default `0`),
`doorOpenCount` (Number, default `0`), `mpin` (String, default `''`), `timeIn`/`timeOut` (Date, default `null`),
`alias` (String, default `''`, maxlength 8), `refNumber` (String, default `''`), `transStatus` (String, default `''`),
`billsCounter` (`[Number]`, default `[0,0,0]`), `paymentId` (String, default `''`), `transNumber` (String, default `''`),
`transID` (String, default `''`), `refNum` (String, default `''`), plus `{ timestamps: true }` →
`createdAt`/`updatedAt`. Indexes: `{doorStatus:1}`, `{lockerLocation:1, doorStatus:1}`, `{refNumber:1}`,
`{doorStatus:1, payType:1}`, `{timeIn:1}` with `expireAfterSeconds: 86400 * 30` (30-day TTL on `timeIn`).

### 7.4 Responses

| Status | Body |
| --- | --- |
| `200` | `{ success: true, data: { doors, count: doors.length } }` — `doors` is an **array** of lean documents (contrast with `/api/getDoors`, whose `data.doors` is an **object**) |
| `405` | `{ success: false, error: 'Method not allowed' }` |
| `500` | `{ success: false, error: 'Internal server error' }`, plus `console.error('GET /api/doors error:', err.message)` |

No validation of `lockerLocation`, no field selection — `mpin`, `refNumber`, `transID` etc. are all returned to any
caller on the LAN.

### 7.5 Legacy → modern notes

Direct Route Handler translation: `export async function GET(request)` with
`const status = new URL(request.url).searchParams.get('status')`; add `export const dynamic = 'force-dynamic'`
(or `revalidate`) because Mongo reads must not be cached; add `runtime = 'nodejs'` explicitly (Mongoose cannot run on
Edge); return `NextResponse.json(..., { status })`; add an index-backed `select()` and a pagination `limit`; a route
handler can also hold the connection via a cached global. Because it is a pure read, it could equally be a Server
Component data fetch, with an RSC-friendly projection.

---

## 8. `src/pages/api/getDoors.js`

### 8.1 Purpose

Thin same-origin proxy in front of the locker controller's door list, giving the browser a cache-free, CORS-free path.
Used by `components/layout/door/index.js` (`axios.get("/api/getDoors")` → `response.data.data.doors`).

### 8.2 Method / request

**No method check at all** — `GET`, `POST`, `PUT`, `DELETE` all execute the same proxy fetch. No query params are
read, no body is read, no auth.

### 8.3 Upstream call

```js
const doorsUrl = process.env.NEXT_PUBLIC_LOCKER_CONTROLLER_DOORS;
const url = doorsUrl.startsWith("http")
  ? doorsUrl
  : `http://localhost:9090/${doorsUrl.replace(/^\//, "")}`;
const response = await fetch(url);
const data = await response.json();
res.status(200).json(data);
```

* Upstream default target: `http://localhost:9090/api/lockercontroller/doors`.
* **Pass-through response**: status is forced to `200` regardless of `response.status`, and the upstream JSON is
  returned **unwrapped** (`res.status(200).json(data)`), so the wire shape is the controller's:
  `{ data: { doors: { "<doorNumber>": { … } } } }` — an **object keyed by door number**, which is exactly what
  `DoorList` iterates with `Object.keys(doors)`. If the upstream returns `{…}.data.doors` absent, DoorList throws.
* Relative-URL handling exists because the env value is usually built as
  `${NEXT_PUBLIC_LOCKER_CONTROLLER_URL}api/lockercontroller/doors` (absolute in practice) — the fallback assumes
  **port 9090**, duplicating the value that already lives in `NEXT_PUBLIC_LOCKER_CONTROLLER_URL`.
* **No `try/catch` and no `cache` option**: a network error or non-JSON body becomes an unhandled rejection (Next
  returns a generic 500 HTML, so the client's `response.data.data.doors` access fails with a confusing error rather
  than a JSON error payload). Next 13 App-Router/Route-Handler caching semantics don't apply to the Pages Router API
  route, but the intent (fresh hardware state) argues for `cache: 'no-store'`.

### 8.4 Module-scope cron side effect (exact)

```js
cron.schedule("0 8 * * *", async () => {
  const initialData = {
    LocalDatabase: [], LockerDetails: [], ForPosting: [], ForPatching: [],
    ForPostingPayments: [], PromoLocalDatabase: [],
  };
  await fetch(process.env.NEXT_PUBLIC_LOCAL_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initialData),
  });
});
```

* `cron` from `node-cron` (a **devDependency** in `package.json`, used in production code — it must be a runtime
  dependency for `npm ci --omit=dev`).
* Schedule `"0 8 * * *"` = **every day at 08:00 in the server's local timezone**; job starts when the route module is
  first imported (i.e. on the first request to `/api/getDoors`, or at build/trace time), never cancelled, and would
  duplicate per process/instance.
* `PUT ${process.env.NEXT_PUBLIC_LOCAL_URL}` — a **full replace of the json-server database**. This deletes every
  `LocalDatabase` door record, every pending `ForPosting`/`ForPatching`/`ForPostingPayments` queue entry, and the
  `PromoLocalDatabase` snapshot — at 08:00 daily, **without checking for undrained queue entries**.
* As noted in §0.1, `NEXT_PUBLIC_LOCAL_URL` is **not defined in the shipped `.env*` files** (only
  `NEXT_PUBLIC_LOCAL_API_URL` is), so this PUT targets the string `undefined` (`fetch` throws `TypeError: Failed to
  parse URL`) — the unhandled rejection inside the cron callback is swallowed by node-cron, so the failure is silent.

### 8.5 Responses

| Status | Body |
| --- | --- |
| `200` | the locker controller's raw JSON (`{ data: { doors: {…}, … } }` as returned upstream) — unconditionally |
| `500` | Next's generic error page/JSON (no route-level handling) |

### 8.6 Legacy → modern notes

* Convert to a Route Handler: `export async function GET()` returning
  `NextResponse.json(await (await fetch(url, { cache: 'no-store' })).json())`, with `export const dynamic = 'force-dynamic'`,
  explicit upstream-status propagation (`if (!upstream.ok) return NextResponse.json({…}, {status: 502})`), a timeout
  (`AbortSignal.timeout`), and the controller origin read from a **server-only** env var (`LOCKER_CONTROLLER_URL`)
  instead of `NEXT_PUBLIC_*`.
* **The cron must be removed from the route module.** A daily destructive DB reset belongs in a scheduler/worker
  (cron container, cloud scheduler, `vercel.json` cron hitting a dedicated `/api/cron/reset-local-db` protected by a
  secret), and should first flush/verify the offline queues instead of blind-deleting them. Importing a side-effecting
  module inside a build trace also makes builds non-deterministic.

---

## 9. `src/pages/api/health.js`

### 9.1 Purpose

Liveness/readiness probe asserting MongoDB connectivity. No consumer in the repository (would be wired to a
supervisor / kiosk watchdog).

### 9.2 Method / request

**`GET` only.** Other methods → `405` `{ success: false, error: 'Method not allowed' }`. No query params, no body,
no auth.

### 9.3 Mongo

```js
await connectDB();
const status = getConnectionStatus();
```

`getConnectionStatus()` returns
`{ isConnected: boolean, readyState: mongoose.connection.readyState, states: { 0:'disconnected', 1:'connected', 2:'connecting', 3:'disconnecting' } }`.

### 9.4 Responses

| Status | Body |
| --- | --- |
| `200` | `{ success: true, data: { status: 'ok', mongodb: status.states[status.readyState] || 'unknown', readyState: status.readyState } }` |
| `405` | `{ success: false, error: 'Method not allowed' }` |
| `503` | `{ success: false, error: 'Database connection failed', data: { status: 'error', mongodb: 'disconnected' } }` |

Notes: the `503` branch has **no `console.error`** (unlike `doors.js`), so DB-down events leave no server-side trace
beyond `lib/db.js`'s own `❌ MongoDB connection failed:` log — which only runs if `isConnected` was false and
`connect()` threw. Because `connectDB()` short-circuits when `isConnected === true`, a connection that drops *after*
the first successful connect is not re-detected reliably (Mongoose's `readyState` is the only signal and
`isConnected` is never reset on `disconnected`), so `health` can report `mongodb: 'connected'` while queries fail.
The endpoint also has no uptime/version/uptime-seconds, no hardware-bill-acceptor check, and no `Cache-Control:
no-store` header.

### 9.5 Legacy → modern notes

Trivial Route Handler conversion (`export async function GET()`); make it `dynamic = 'force-dynamic'`,
`runtime = 'nodejs'`, and consider adding `readyState`-based reconnection by nulling `isConnected` on a
`mongoose.connection.on('disconnected')` handler. This is the one route in scope with **no client-side counterpart**,
so it is purely server: safe as a Route Handler, and a good place to expose hardware status
(`getBillAcceptorStatus()`) behind server-side auth.

---

## 10. `src/pages/api/transactions.js`

### 10.1 Purpose

Creates/looks up Mongo `Transaction` documents for the kiosk booking lifecycle. The file header states:
*"POST /api/transactions — Creates a new transaction with bookingStatus: 'payment-pending'. Called from
paymentselection page on mount. … Returns: { transID } — used by payment pages to update on completion"* and
*"GET /api/transactions?doorNumber=X — Looks up the active (ready-for-pickup) transaction for a door. Used by details
page to find transID when ending a transaction."*

Implementations: `POST` ← `pages/paymentselection/index.js` (mount, if `router.query.transID` is absent);
`GET` ← `pages/details/index.js` (completion) and `pages/admin/clear.js` (fallback "clear" lookup).

### 10.2 Method / request / response matrix

| Method | Request | Validation | Mongo | Status | Body |
| --- | --- | --- | --- | --- | --- |
| `GET` | `?doorNumber=X` (query, string) | `if (!doorNumber)` → `400` | `Transaction.findOne({ doorNumber: String(doorNumber), bookingStatus: { $nin: ['completed','canceled','cleared'] } }).sort({ createdAt: -1 })` | `200` | `{ success:true, data: transaction }` (full doc) |
| | | missing param | — | `400` | `{ success:false, error:'doorNumber query param is required' }` |
| | | no active doc | — | `404` | `{ success:false, error:'No active transaction for this door' }` |
| `POST` | body `{ doorNumber, lockerLocation, qpin, alias }` | `if (!doorNumber)` → `400` | `Transaction.create({…})` | `201` | `{ success:true, data:{ transID, bookingStatus:'payment-pending' } }` |
| | | missing `doorNumber` | — | `400` | `{ success:false, error:'doorNumber is required' }` |
| | | Mongoose/other throw | — | `500` | `{ success:false, error:'Internal server error' }` |
| any other | — | — | — | `405` | `{ success:false, error:'Method not allowed' }` |

Exact inserted document:

```js
const transID = `TXN-${doorNumber}-${Date.now()}`;
await Transaction.create({
  transID,
  doorNumber: String(doorNumber),
  lockerLocation: lockerLocation || '',
  qpin: qpin || '',
  alias: alias || '',
  transStatus: 'Active',
  bookingStatus: 'payment-pending',
});
console.log(`✅ Transaction created: ${transID} (payment-pending)`);
```

`doorSize`, `payType`, `amount`, `timeIn`, `timeOut`, `refNumber`, `billsCounter` are **not** set here (schema
defaults apply: `doorSize:'L'`, `payType:''`, `amount:0`, `timeIn/timeOut:null`, `refNumber:''`, `billsCounter:[0,0,0]`,
`posted:false`, `postedAt:null`).

**Error handling quirks**
* `await connectDB();` sits **outside** any `try/catch` (line 23) — a DB-connection failure throws out of the handler
  rather than producing the JSON `500`.
* The `GET` branch has **no `try/catch`** at all: a Mongoose error on `findOne` also escapes as an unhandled rejection.
  Only `POST` is wrapped in `try/catch`.
* Log strings: `POST /api/transactions error: ${err.message}` (console.error) and the success log above.
* No auth; `doorNumber` is not checked against the real door list; `transID` is predictable
  (`TXN-<door>-<epoch ms>`) and is used as the only handle by `PATCH /api/transactions/[transID]`.

`Transaction` schema (for shape reference): `transID` (String, default `''`), `doorNumber` (String, required, indexed),
`lockerLocation` (String, default `''`), `doorSize` (String, default `'L'`),
`payType` (String, enum `['','NARWHAL','CASH','PROMO']`, default `''`), `amount` (Number, default `0`),
`qpin` (String, default `''`), `alias` (String, default `''`), `timeIn`/`timeOut` (Date, default `null`),
`transStatus` (String, default `''`), `bookingStatus` (String, enum
`['payment-pending','ready-for-pickup','completed','canceled','cleared']`, default `'payment-pending'`),
`billsCounter` (`[Number]`, default `[0,0,0]`), `refNumber` (String, default `''`), `refNum` (String, default `''`),
`posted` (Boolean, default `false`), `postedAt` (Date, default `null`), `{ timestamps: true }`. Indexes:
`{transStatus:1}`, `{bookingStatus:1}`, `{posted:1, createdAt:1}`. Model registered once via
`mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema)`.

### 10.3 Client call sites (contracts actually exercised)

* **Create** (`paymentselection`, effect on `[doorNumber]`):
  ```js
  fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doorNumber, lockerLocation: lockerLocation || "", qpin: pin || "", alias: alias || "" }) })
    .then(res => res.json()).then(data => { if (data.success) setTransID(data.data.transID); })
    .catch(err => console.error("Create transaction failed:", err));
  ```
  If `router.query.transID` exists it is reused and **no** POST happens (returning from a payment method does not
  duplicate transactions).
* **Cancel** (`paymentselection.handleBack`): `PATCH /api/transactions/{transID}` with `{ bookingStatus: "canceled" }`.
* **Lookup-then-complete** (`details`): `GET /api/transactions?doorNumber=${doorNumber}` → if
  `result.success && result.data?.transID` → `PATCH /api/transactions/{transID}` with
  `{ bookingStatus: "completed", timeOut: new Date().toISOString() }`.
* **Admin clear** (`admin/clear.js`): `PATCH /api/transactions/{transID}` with
  `{ bookingStatus: "cleared", timeOut: new Date().toISOString() }` when `res.data.transID` starts with `'TXN-'`;
  otherwise the `GET` fallback lookup, then the same PATCH.

### 10.4 Legacy → modern notes

* Server-only code (Mongoose) — a Route Handler (`export async function GET/POST`) or a Server Action called from the
  payment pages. There is nothing client-specific here.
* Add `export const runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, a shared `try/catch` around `connectDB()` in
  both branches, Zod validation of `doorNumber`/`qpin`/`alias`, and return the created `transID` from a Server Action
  so `paymentselection` no longer round-trips through `/api`. Replace the guessable `TXN-…` id with a `crypto.randomUUID()`
  or keep `transID` and add an opaque `_id`-based route (`/api/transactions/[id]`).
* The kiosk is offline-first, so a POST that fails (server down) currently leaves `transID` undefined and the payment
  flow silently continues without Mongo tracking — a modern design should queue the create locally (as the rest of the
  app already does for `ForPosting`) instead of dropping it.

---

## 11. `src/pages/api/transactions/[transID].js`

### 11.1 Purpose

Single-field-bag PATCH updater for an existing transaction, keyed by the human-readable `transID`. Header comment:
*"PATCH /api/transactions/[transID] — Updates a transaction. Accepts any fields from the body. bookingStatus defaults
to 'ready-for-pickup' when not provided (for payment completion), but respects explicit values like 'canceled' (from
Back button on paymentselection). Body: { payType, amount, timeIn, refNumber, billsCounter, bookingStatus }"*.

### 11.2 Method / request / response

* Dynamic route param: `req.query.transID`.
* **`PATCH` only** — every other method → `405` `{ success:false, error:'Method not allowed' }`.
* Missing `transID` → `400` `{ success:false, error:'transID is required' }` (unreachable in practice, since the
  segment must be present for the route to match, but an empty string would hit it).

Request body handling (exact whitelist — anything else in the body is **ignored**):

```js
const { payType, amount, timeIn, refNumber, billsCounter, bookingStatus } = req.body;
await connectDB();
const updateFields = {};
if (bookingStatus) { updateFields.bookingStatus = bookingStatus; } else { updateFields.bookingStatus = 'ready-for-pickup'; }
if (payType) updateFields.payType = payType;
if (amount !== undefined) updateFields.amount = amount;
if (timeIn) updateFields.timeIn = new Date(timeIn);
if (refNumber) updateFields.refNumber = refNumber;
if (billsCounter) updateFields.billsCounter = billsCounter;
const transaction = await Transaction.findOneAndUpdate({ transID }, { $set: updateFields }, { new: true });
```

| Status | Body |
| --- | --- |
| `200` | `{ success: true, data: transaction }` (the **post-update** document, `new: true`) |
| `404` | `{ success: false, error: 'Transaction not found' }` (no doc matched `transID`) |
| `405` | `{ success: false, error: 'Method not allowed' }` |
| `500` | `{ success: false, error: 'Internal server error' }` with `console.error(`PATCH /api/transactions/${transID} error:`, err.message)` |

Success log: `` console.log(`✅ Transaction updated: ${transID} → ${updateFields.bookingStatus}${payType ? ` (${payType})` : ''}`) ``.

**Contract mismatches / gaps found**
* `bookingStatus` is **always** written, even when the body omits it: an omitted status silently means
  `'ready-for-pickup'`. A caller doing a "ref only" PATCH therefore also advances the booking state.
* `refNum` is **not** in the whitelist. `cashpayment` and `payment` both send `refNum` alongside `refNumber`
  (e.g. `{ …, refNumber: cashRef, refNum: cashRef }`) and it is **silently dropped** — the schema has a `refNum`
  field that this endpoint can never populate. Only `refNumber` persists.
* `timeOut` is **not** in the whitelist. `details` and `admin/clear` send `timeOut: new Date().toISOString()` with
  `bookingStatus: "completed"` / `"cleared"` and it is silently dropped → completed/cleared transactions keep
  `timeOut: null` in Mongo.
* `bookingStatus` is not validated against the enum before the query; an invalid value raises a Mongoose
  `ValidationError` inside `findOneAndUpdate` → caught → `500` (not a `400`).
* `amount` accepts any JSON type (no numeric coercion/validation).
* No `posted`/`postedAt` handling, no optimistic concurrency, no auth, and `transID` is the only key (not unique in
  the schema — no `unique: true` on `transID` — so a duplicate `transID` would update whichever document Mongo finds
  first).

### 11.3 Client call sites

| Caller | Body sent | Resulting Mongo change |
| --- | --- | --- |
| `pages/cashpayment/index.js` (payment success) | `{ payType:"CASH", amount, timeIn, bookingStatus:"ready-for-pickup", billsCounter, refNumber, refNum }` | `refNum` dropped |
| `pages/payment/index.js` (QR ref update, early) | `{ refNumber, refNum }` | `bookingStatus` becomes `'ready-for-pickup'` **as a side effect**; `refNum` dropped |
| `pages/payment/index.js` (QR success) | `{ payType:"NARWHAL", amount: NEXT_PUBLIC_DOOR_RATE, timeIn, bookingStatus:"ready-for-pickup", refNumber: paymentId, refNum: paymentId }` | `refNum` dropped |
| `pages/paymentselection/index.js` (Back) | `{ bookingStatus: "canceled" }` | status only |
| `pages/details/index.js` (complete) | `{ bookingStatus: "completed", timeOut }` | `timeOut` dropped |
| `pages/admin/clear.js` (clear) | `{ bookingStatus: "cleared", timeOut }` | `timeOut` dropped |

### 11.4 Legacy → modern notes

* Straightforward Route Handler: `export async function PATCH(request, { params })`; parse with Zod
  (`bookingStatus` optional + enum, `amount` coerce number, `timeIn`/`timeOut` `z.coerce.date()`, `refNumber`,
  `refNum`, `billsCounter` array of ints), build `updateFields` from the **parsed** object only, and return
  `NextResponse.json`. Add `timeOut`/`refNum`/`posted` to the whitelist (the current silent drops are a data-integrity
  bug, not a design choice that any client relies on).
* Because these PATCHes happen after the door has already opened, they must never block the kiosk UX — a modern
  version keeps them fire-and-forget (as today) but should surface failures into the same local outbox used for
  `ForPosting`/`ForPatching`, rather than `console.error`-only.
* `connectDB()` should sit inside the shared `try` (or behind a cached connection helper that never throws
  synchronously), and the route should be `runtime = 'nodejs'` + `dynamic = 'force-dynamic'`.

---

## 12. `src/styles/globals.css` — summary (736 lines)

### 12.1 Fonts (`@font-face`, `src: url("../assets/fonts/…")`)

| `font-family` | File |
| --- | --- |
| `Poppins-Regular` | `poppins/Poppins-Regular.ttf` |
| `Poppins-Bold` | `poppins/Poppins-Bold.ttf` |
| `Poppins-Black` | `poppins/Poppins-Black.ttf` |
| `Poppins-Light` | `poppins/Poppins-Light.ttf` |
| `Poppins-Medium` | `poppins/Poppins-Medium.ttf` |
| `Poppins-SemiBold` | `poppins/Poppins-SemiBold.ttf` |
| `Quicksand-SemiBold` | `quicksand/Quicksand-SemiBold.ttf` |

Each is a **separate family** (weight 400 by default) rather than one family with `font-weight`s — every weight is
selected via a utility class, never via `font-weight`. **No `body`/global font-family is declared**, so any element
without a `font-*` class falls back to the browser default. The last font-face is spelled `Quicksand-SemiBold`, while
the utility class `.quicksand` declares `font-family: "Quicksand-Semibold"` (lower-case `s` in "bold") — a **casing
mismatch that makes the footer font-face fail to match** (the family name in `@font-face` must match exactly).

### 12.2 `:root` variables and resets

```
--max-height: 1920px;  --max-width: 1080px;  --border-radius: 12px;  --font-mono: "Poppins-Regular";
--foreground-rgb: 0,0,0;  --background-start-rgb: 214,219,220;  --background-end-rgb: 255,255,255;
--primary-glow: conic-gradient(from 180deg at 50% 50%, #16abff33 0deg, #0885ff33 55deg, #54d6ff33 120deg, #0071ff33 160deg, transparent 360deg);
--secondary-glow: radial-gradient(rgba(255,255,255,1), rgba(255,255,255,0));
--tile-start-rgb / --tile-end-rgb / --tile-border (conic-gradient of #00000080→#00000010);
--callout-rgb / --callout-border-rgb / --card-rgb / --card-border-rgb;
```

* `:root` additionally sets **`overflow: hidden`** (a scroll-killer globally; `Layout` compensates with its own
  `100vh; overflowY:auto` inner container).
* `@media (prefers-color-scheme: dark)` re-declares all of the above for dark mode (including pure-black
  backgrounds and `--card-border-rgb: 200,200,200`).
* Resets: `* { box-sizing: border-box; padding: 0; margin: 0; }`,
  `html, body { max-width: 100vw; overflow-x: hidden; }`, `a { color: inherit; text-decoration: none; }`.
* Several variables (`--primary-glow`, `--secondary-glow`, `--tile-*`, `--callout-*`, `--card-*`, `--font-mono`,
  `--max-width`, `--border-radius`) exist only for the unused `Home.module.css` (§13) — dead weight in production.

### 12.3 Key class groups (what the components actually depend on)

**Typography / color**
* Families: `.font-semibold` (`"Poppins-SemiBold"`), `.font-regular` (`"Poppins-Regular"`), `.font-light`
  (`"Poppins-Light"`), `.font-bold` (`"Poppins-Bold"`), `.font-medium` (`"Poppins-Medium"`),
  `.quicksand` (`"Quicksand-Semibold"` — see the casing bug above).
* Sizes: `.fs-15 .fs-16 .fs-18 .fs-21 .fs-25 .fs-28 .fs-31 .fs-32 .fs-36 .fs-40 .fs-48 .fs-52 .fs-60 .fs-64 .fs-70`
  (the last also sets `font-weight: 600`) `.fs-108`.
* Colors: `.base-color` (gradient `#50ba84`→`#15abd0` text via `-webkit-background-clip: text` +
  `-webkit-text-fill-color: transparent`), `.text` (`#333 !important`), `.text-summary` (`#7d7f83`),
  `.text-right`, `.text-progress` (1188px tall, 478px top margin), `.alert-warning` (`#fff1bf` on `#664f01`),
  `.alert-warning-border` (`1px solid #f8bf00`, radius 12px).

**Spacing / layout utilities**
`.pb-16` (16px), `.pt-16`, `.pt-40`, `.pt-56`, `.pt-100`, `.pt-150`, `.pt-230`, `.p-4-5` (27px), `.pb-43`,
`.p-alert` (32/24px padding, 144px tall), `.p-alert-warning` (144px × 800px), `.main-container-cash`
(80px top+bottom padding), `.cancel-btn-cash` (height 145px, `color:#50ba84`, width 100%),
`.amount-text` (132px), `.cash-text` (88px), `.complete-cont` (1188px), `.e-wallet-cont` (1186.5 × 936px),
`.scroll` (`height: 55rem; overflow-y: scroll; overflow-x: hidden; z-index: 999`), `.children { z-index: 999 }`,
`.support-btn` (bottom/right 0), `.payment_selection` (116px).

**Door grid** — `.door-list .doors { width: 10rem; height: 10rem; }` (commented-out `12.7rem/180px` remains), and
`.door_list { margin-top: 20px; display: grid; grid-template-columns: auto auto auto auto auto; gap: 1rem; margin-bottom: 100px; }`
(five columns). A commented-out rule `.door_list div:nth-child(8) { pointer-events: none; }` remains as a
"disable door #8" experiment. `.doorNumber { height: 20px !important }`, `.gohome { height: 10rem; text-align: left !important }`.

**Buttons / keypad** — global element rule `button { border-radius: 60px !important; width: 400px; }` (every button
in the app is forced to 400px wide and pill-shaped, which the components then override with Bootstrap/inline styles),
`.btn-gradients { background: linear-gradient(to right, #50ba84, #15abd0); }`, `button.next { background: same; width: 100% }`,
`button:disabled { opacity: 50%; }`, `.keys { width: 100px; height: 100px; }`, `.pin { width: 100px }`,
`.pin-text { height: 87.5px }`, `.view { -webkit-text-security: disc; transform: scale(3.5); }`,
`.view-admin { -webkit-text-security: disc; }`.

**Images / backgrounds** — `.payment-complete` (784×888, `bg-success.svg`, centered flex),
`.bg-light-green` (840×388, `padding:56px`, `margin-top:40px`, `bg-cash.svg`).

**Overlays / modals** — `.end-modal-bg` (`rgba(0,0,0,.8)`, fixed, full-screen, `z-index: 9999`),
`.connecting-overlay` (`rgba(0,0,0,.85)`, fixed, `z-index: 99999`),
`.end-modal` (952×1185 white, absolute, auto-centered, `margin-top: 350px`, `padding-top: 250px`, `z-index: 9999999999`),
`.footer-modal-bg` (`rgba(0,0,0,.8)`, `z-index: 999999`),
`.footer-modal` (952×1185 white, `margin-top: 350px`, `padding: 62px 40px 0`),
`.footer-modal-contents-container` (872×1000, `overflow: auto`), `.content-footer-modal` (80px side padding),
`.btn-modal-p` (64×64, `background-image: url("../assets/img/x.svg")`, white, no border),
`.p-cancel` (150px side padding, `#7d7f83`), `.p-cancel-btn { margin-top: 100px }`.

**Footer** — `.footer-main { background:#fff; height:75px; width:743px; border-top-left/right-radius: 22px }`,
`.footer-contents { font-size: 18px }`, `.footer-contents .link { color: #50ba84 }`,
`.footer-contents .bd { background-color:#e1e3e7; width:1px; height:38px }`.

**Slick overrides** — `ul.slick-dots { top: 0; text-align: right; }`,
`.slick-arrow { pointer-events: none; display: none; }`,
`.slick-list .base-color { width: 75%; }`, active dot `background: linear-gradient(to right,#50ba84,#15abd0); border-radius:50%`,
dot glyphs `color:#16d391 !important; font-size:20px !important`.

**Animations (Animista, 500 ms ease-in-out both)** — `.fade-in-bottom` (`translateY(50px)`) + `@keyframes fade-in-bottom`,
`.fade-in` (opacity) + `@keyframes fade-in`, `.scale-in-center` (`scale(0→1)`) + `@keyframes scale-in-center`,
`.fade-out` + `@keyframes fade-out` (note: the `fade-out` keyframes actually animate opacity **0 → 1**, i.e. a fade-*in*
— the name is wrong and no `.fade-out` consumer gets a visible fade-out), `.fade-in-top` (`translateY(-50px)`) +
`@keyframes fade-in-top`. Each has `-webkit-` prefixed twins.

---

## 13. `src/styles/Home.module.css` — summary (229 lines)

**Status: dead code.** It is the untouched `create-next-app` starter module and is **imported by nothing** (only
`globals.css` is imported in `_app.js`). Its classes are never referenced in `src/`.

Contents:
* `.main` — column flex, `space-between`, centered, `padding: 6rem`, `min-height: 100vh`.
* `.description` (+ `a`, `p`) — inherits flex alignment, `font-size: 0.85rem`, `max-width: var(--max-width)`,
  `z-index: 2`, `font-family: var(--font-mono)`; `p` gets `rgba(var(--callout-rgb), 0.5)` background,
  `rgba(var(--callout-border-rgb), 0.3)` border, `var(--border-radius)`.
* `.code` — `font-weight: 700`, mono family.
* `.grid` — `repeat(4, minmax(25%, auto))`, `max-width: var(--max-width)`.
* `.card` (+ `span`, `h2`, `p`) — padding/radius/hover transition; `p` at `opacity: 0.6`, `max-width: 30ch`.
* `.center` with `::before` (secondary glow, 480×360, `margin-left:-400px`) and `::after` (primary glow, 240×180,
  `z-index:-1`), both `filter: blur(45px)` and `translateZ(0)`.
* `.logo`, `.vercelLogo` (dark-mode `filter: invert(1)`, logo also `drop-shadow(0 0 0.3rem #ffffff70)`).
* Media queries: `@media (hover: hover) and (pointer: fine)` (card hover), `@media (prefers-reduced-motion)`,
  `@media (max-width: 700px)` (mobile: 1-column grid, fixed description bars, `backdrop-filter: blur(24px)`),
  `@media (min-width: 701px) and (max-width: 1120px)` (2-column grid), `@media (prefers-color-scheme: dark)`.
* `@keyframes rotate` (`360deg` → `0deg`); `.content` is referenced only inside the mobile media query and is
  never defined.

**Modernization:** delete the file and the `--tile-*`/`--callout-*`/`--card-*`/`--primary-glow`/`--secondary-glow`
/`--font-mono` variables that exist solely for it. Tailwind (or CSS Modules scoped per component) should replace the
`fs-*`/`font-*`/`pt-*` utility soup — but note that the kiosk's 1080×1920 fixed-canvas assumptions are encoded in
pixel sizes here, so a migration needs a viewport strategy (e.g. `clamp()` plus a fixed 1080px design token scale)
rather than plain responsive units.

---

## 14. Consolidated cross-cutting findings

### 14.1 Hardware integration map

```
Browser (kiosk)                         Next.js custom server (server.js)            Devices
──────────────────────────────────────────────────────────────────────────────────────────────
components/layout/door/index.js
  GET /api/getDoors ─────────────────► pages/api/getDoors.js ──fetch──► http://localhost:9090/api/lockercontroller/doors
  GET NEXT_PUBLIC_LOCKER_CONTROLLER_DETAILS ─────────────────────────► http://localhost:9090/api/lockercontroller/lockerdetails
  axios ↔ http://localhost:3001/{LocalDatabase,LockerDetails,ForPosting,ForPatching,ForPostingPayments}  (json-server)

pages/details|payment|cashpayment
  GET {DOOR_OPEN}/{doorNumber}/open ─────────────────────────────────► http://localhost:9090/api/lockercontroller/door/{id}/open   ← DOOR OPEN (no close)

pages/cashpayment/index.js
  utils/hardwareClient.js ── socket.io ──► server.js SocketIOServer ──► HardwareControllerClientServerSDK ──► bill acceptor
      billAcceptor:startSession {total, transactionId}
      billAcceptor:onInsert  (listener; accepted|rejected|hold)
      billAcceptor:rejectBill (auto, on hold — no change given)
      billAcceptor:endSession (success, cancel, unmount)
      (available but unused: locker:getDoors/openDoor/openDoorWithState/onClose/getDoorStates, nfc:*, billAcceptor:approveBill/getAcceptedTotal/getStatus/reboot/resetTotal, cardDispenser:*)
```

* Token: `NEXT_PUBLIC_HARDWARE_ACCESS_KEY` (client, socket.io `auth.token`) must equal the server's
  `HARDWARE_ACCESS_KEY`; `server.js` exits if neither is set.
* Connection/reconnection: `autoConnect: false` → explicit `ensureConnected()`; dedup via `connectionPromise`;
  10 s connect timeout; socket.io `reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000`; no
  application retry beyond the caller's next attempt; no connection-state UI.
* Door "close" is never commanded by the app; the SDK exposes `locker:openDoorWithState` + `locker:onClose` and the
  kiosk ignores both.
* Money path: `DOOR_RATE` (`10` UAT / `250` prod, fallback `200`) → accepted denominations **50 / 100 / 200** only →
  `hold` bills are auto-rejected (the machine returns no change) → on `remainingAmount <= 0` the door record is
  PATCHed to `doorStatus: 1, paymentStatus: "paid", payType: "CASH"`, the door is opened, a payment is posted to
  `${NEXT_PUBLIC_API_PAYMENT_STATUS}` (with local queue fallback) and Mongo is updated to
  `bookingStatus: "ready-for-pickup"`, then a 6 s countdown returns to `/`.

### 14.2 Client-vs-server split (modernization summary table)

| File | Client-only? | Could become |
| --- | --- | --- |
| `components/layout/index.js` | Partly — modal + Lottie only | Server `Layout` shell + 2 Client Components; policy body as content |
| `components/layout/head.js` | Yes (carousel autoplay/DOM) | Client component, or CSS-only scroll-snap with zero JS |
| `components/layout/door/index.js` | Yes (grid clicks, promo modal, LAN calls) | Server-rendered tiles from a Route Handler + tiny Client Component for selection; **queue drain moves to a background worker/Route Handler** |
| `components/layout/keyboard/index.js` | Yes (interactive state) | Client component with a typed `disabled`/`onClear` contract; PIN verification via Server Action |
| `utils/hardwareClient.js` | Yes (browser socket.io + device) | Stays client; token should be minted server-side; wrap as a `useHardwareClient()` hook/provider |
| `utils/keyboard.js` | No | Shared constant (server or client) |
| `pages/api/doors.js` | No | Route Handler (`GET`) over Mongo |
| `pages/api/getDoors.js` | No | Route Handler (`GET`, force-dynamic, no-store, timeout, server-only env); **cron extracted to a scheduler** |
| `pages/api/health.js` | No | Route Handler; add hardware status + real reconnect detection |
| `pages/api/transactions.js` | No | Route Handler / Server Action (`GET`+`POST`) with validation |
| `pages/api/transactions/[transID].js` | No | Route Handler (`PATCH`) with a Zod-validated whitelist incl. `timeOut`/`refNum` |
| `styles/globals.css` | N/A | Split into tokens + component styles; delete unused CSS-module/`create-next-app` remnants |
| `styles/Home.module.css` | N/A | Delete (unreferenced) |

### 14.3 Defects worth fixing regardless of framework

1. `Layout` mode-classification precedence bug — any `DOOR_RATE="10"` shows "BILL ACCEPTOR UAT MODE".
2. `next/dist/server/api-utils` (`SYMBOL_CLEARED_COOKIES`) imported into a client component (unused).
3. `<string>` element in the header carousel slide 1.
4. `@font-face` `Quicksand-SemiBold` vs `.quicksand { font-family: "Quicksand-Semibold" }` casing mismatch.
5. `DoorList`: `return` instead of `continue` in `fetchPrevData` and `postingPending` (skips remaining records);
   `response.data[0]` index without length check; unawaited deletes/PATCHes; `console.log('lkjasdflkjsdf')`;
   `key={index}`; `isPromoActive()` recomputed per record.
6. `Keyboard`: prop-name mismatch (`disableKey` passed vs `setDisableKey` read) drops the reset signal; backspace
   and clear stay enabled after 6 digits; dead `disableNext`/`keyTexts`/`next` import.
7. `pages/home/index.js` calls `useScanDetection` **inside** `if (typeof window !== "undefined")` — a
   conditional Hook call (rules-of-hooks violation) that succeeds only because the branch is stable per environment.
8. `api/getDoors.js`: mutating cron in route module scope, destructive unrestricted `PUT`, and `NEXT_PUBLIC_LOCAL_URL`
   undefined in every shipped env file (silent `TypeError`).
9. `api/transactions/[transID].js`: `refNum` and `timeOut` are silently dropped from client payloads; omitted
   `bookingStatus` silently coerces to `'ready-for-pickup'`.
10. `api/transactions.js`: `connectDB()` outside `try/catch`, no `try/catch` on `GET`.
11. `NEXT_PUBLIC_LOCAL_URL_DATABASE_PROMO` missing from the shipped env files while `context/app.js` requires it in
    promo mode → every local door operation would target `undefined`.
12. `NEXT_PUBLIC_HARDWARE_ACCESS_KEY` / `MONGODB_URI` (with credentials) are committed in `.env*` files in this
    directory and rewritten in place by `loadEnv.js` (`mergeEnvFiles(srcFile, ".env")`) — the credentials in
    `.env`, `.env.uat.*`, `.env.prod.*`, `.env.example` must be treated as compromised and rotated.
