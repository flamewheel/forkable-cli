# Forkable private API — reverse-engineered spec

Captured 2026-07-24 by watching the Member Console SPA (`https://forkable.com/mc/`) network traffic.
This is an **undocumented internal API**. No official public API exists — that's the whole reason for this CLI.

## Base + transport
- Base URL: `https://forkable.com/api/v2`
- Authenticated GraphQL: `POST /api/v2/graphql`
- Public (pre-auth) GraphQL: `POST /api/v2/public/graphql`
- CSRF: `GET /api/v2/csrf_token` → `{ "token": "<opaque>" }`
- Auth is **cookie-based session** (HttpOnly cookie set on login). Not a bearer token.
  Client must use a cookie jar and send cookies on every request (`credentials: include`).

### Required headers (all GQL requests)
- `Content-Type: application/json`
- `Accept: application/json`
- `Forkable-Referrer: mc`   (the SPA sends the string "mc")
- `X-CSRF-Token: <token>`   (from /csrf_token; refresh if it expires)

### GraphQL body shape
- Query: `{ "query": "query { ... }", "variables": {} }`
- Mutation wire format (from the app's `_mutate2` helper):
  `mutation ($input: <PascalCaseName>Input!) { <name>(input: $input) { <fields> } }`
  with `variables: { input: {...} }`.
  Response field `errorAttributes` (when present) is a JSON-encoded string.

## Auth / login
Login mutation is `createSession`. Called by the SPA as
`$api.mutate("createSession", "errorAttributes errorDetails user { <meQuery> }", { email, password, token })`.

- `email` — lowercased, trimmed
- `password`
- `token` — only present for claim/invite links (`route.params.uuid`); omit for normal login
- Optional MFA: `mfaCode`, `recoveryCode`, `skipMfa` (account has `mfaEnabled` bool)

On success the response `Set-Cookie` establishes the session; persist the cookie jar.

Pre-login helper (public endpoint): `identities(email:)` → integration/SSO info.
An empty array ⇒ plain password login (no SSO configured for that email).

Logout: `logout` (session teardown).

## Core read queries
- `me { ... }` — profile, settings, restrictions, likes, dislikes, tips, roles, permissions,
  mealClubAutoOrder, mfaEnabled, companies, allManagedClubs, ... (huge object)
- `me { mealClubs { id forBuffet forFamily userRoles } preferredLocations { wday clubId club {...} } }`
- `myDeliveries(from: "YYYY-MM-DD") { ... }` — the week's deliveries: state, forDeliveryAt,
  deliveryWindow, availableMenuIds, orders { pieces { itemId menuId name userId ... } }, club { id ... }, etc.
  Each delivery has an `id` (deliveryId) and pieces have a `pieceId` (uuid).
- `myInProgressDeliveryIds`
- `myNotifications { ... }`
- `menus(ids: <int|[ints]>, clubId: <int>) { id name displayName venue { id name } sections { id name items {
    id menuId name description price ingredientTags modifierIds imageUrl averageRating dietLevel userRating
    modifiers { id name optionSetId min max free required options { id name price ingredientTags } } } }
    diets { name level label shortLabel restrictedIngredients } ingredients { category ingredients } }`
  (NB: `diets` and `ingredients` are sibling root fields on the query, not nested under `menus`.)
- `mealGenerationScores(deliveryId:, userId:, menuIds: [ints]) { menuId itemId score }`
  ⭐ Forkable's OWN per-item preference score for the user. This is the auto-order ranking brain.
- `mealRestrictions(userId:, menuId:, itemId:, customization: "<json>") { conflicts }`
  Dietary-conflict check for an item + modifier selection before ordering.
- `venueUsage(ids: [ints], from:, to:)` — venue capacity usage.

## Core mutations
- `replacePiece(input: ReplacePieceInput!)` — **choose/replace a meal**. Observed input:
  ```json
  {
    "deliveryId": "<deliveryId>",
    "itemId": "<itemId>",
    "menuId": "<menuId>",
    "instructions": "",
    "selectionsHash": { "<modifierId>": [-1], "<modifierId>": ["<optionId>"] },
    "fromTopRated": true,
    "topRatedType": "meal_generation",
    "oldPieceId": "<uuid of the piece being replaced>",
    "myMeals": true
  }
  ```
  - `selectionsHash`: map of modifierId → [optionId], `-1` meaning "no selection"/default for that modifier group.
  - `oldPieceId`: the piece currently occupying that slot (from myDeliveries).
  - `fromTopRated`/`topRatedType` are analytics-ish; can set false/omit for a plain manual pick.
  Returns updated `delivery`, `userReceipt`, `errors`, `errorDetails`, `warningDetails`.
- `addTopRatedMealsImpression(input: { deliveryId }) { errors }` — analytics only, safe to skip.

## Discovering your own IDs
All IDs are per-account and discovered at runtime — nothing is hard-coded:
- `userId` comes from the `me` query.
- `clubId` comes from `me.mealClubs[].id` (or each delivery's `club.id`).
- `deliveryId` and the current `oldPieceId` come from `myDeliveries(from:)`.
- `menuId`/`itemId` come from `menus(...)`, scoped to `delivery.availableMenuIds`.

## Notes / gotchas
- Selecting a meal = `replacePiece` against the delivery's existing piece (`oldPieceId`). There is no
  separate "add"; the slot always has a piece you replace.
- Modifiers: `menus(...).sections.items.modifiers` define option sets; `min/max/free/required` constrain
  choices. `selectionsHash` keys are modifier ids, values are arrays of option ids.
- Prices can be hidden per-club (`hidePrices`, `hiddenPriceLimit`).
- Change eligibility: use `!isReadOnly && !pastLateOrderDeadline`. `canRequestChanges` is a *separate*
  post-cutoff change-request signal and is false during the normal pre-order window.
