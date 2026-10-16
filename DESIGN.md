# Reelify — Design System

Two surfaces with different rules:
- **Admin**: must feel native to Shopify. Follow Polaris and the Shopify App Design Guidelines.
- **Storefront widget**: must feel premium and social-native, while adapting to any theme.

---

## Part 1 — Admin (Polaris web components + App Bridge)

### Principles
1. Native first. Use Polaris web components as shipped by the template. No custom color palette, no other UI kits.
2. Every screen handles four states: **loading** (skeleton), **empty** (helpful empty state with one clear action),
   **error** (banner with what happened + what to do), **success** (toast).
3. One primary action per page. Destructive actions are never primary and always confirmed.
4. Copy is sentence case, short, friendly and specific. "Upload videos", not "Click here to upload your video files".
5. Works in the Shopify mobile admin (narrow widths).

Verify component tag names and attributes in the current Polaris web components docs before using them.
Do not invent tags. If a needed pattern has no component, compose from layout primitives.

### Page anatomy
- Page: title, primary action, up to two secondary actions, back action on detail pages.
- Content in sections/cards with clear headings.
- Settings pages: two-column "annotated" layout (description on the left, fields on the right) on desktop; stacked on mobile.
- Forms: App Bridge save bar for unsaved changes (Save / Discard). Never a floating custom save button.
- Feedback: App Bridge toast for success; Polaris banner for errors and warnings; modal for confirmations.

### Status badges (video)
| Status | Tone | Label |
|--------|------|-------|
| UPLOAD_PENDING | neutral | Uploading |
| UPLOADED / PROCESSING | attention (with spinner) | Processing |
| READY | success | Ready |
| FAILED | critical | Failed — with reason and "Retry" or "Upload again" |

### Navigation
Dashboard · Videos · Widgets · Analytics · Settings · Plans

("Widgets" is the merchant-facing word for playlists.)

### Screens

**Dashboard**
- Welcome heading with the shop name.
- Onboarding checklist with progress: Upload a video → Tag a product → Create a widget → Add to your theme. Each step has a CTA and completes automatically.
- KPI cards (last 30 days): Views, Product clicks, Add to carts.
- Plan card showing current plan and usage (e.g. "7 of 10 videos").

**Videos**
- Primary: "Upload videos". Secondary: "Import from Instagram" (only when `FEATURE_INSTAGRAM` is on).
- Drop zone + upload queue (thumbnail, filename, progress, cancel/retry, per-file errors in plain language). Files go
  directly to Cloudflare Stream; after the upload bar completes the card shows "Processing" while Stream encodes.
- Rights confirmation checkbox: "I own or have permission to use these videos."
- Library grid of 9:16 cards: poster, duration chip, status badge, source icon, "3 products" tag. Optional list view.
- Search, filter by status/source, sort. Bulk: delete, add to widget. Cursor pagination.
- Empty state: illustration + "Upload your first video" + one line on what happens next.

**Video detail**
- Left: 9:16 player card (Cloudflare Stream embedded player, signed URL). Right: details (title, caption), Tagged products (resource picker, reorder, remove,
  "Product deleted" warning rows), Used in widgets, Metadata.
- Failed videos show a banner with the reason and next step ("Upload again" — Stream cannot re-process a failed upload).

**Widgets**
- List: name, type, video count, placement summary, active toggle, updated.
- Create: choose type with visual cards (Carousel, Product videos; Bubble and Stories marked "Coming soon" until built), then name.
- Editor: Videos (add from library, reorder), Appearance (heading, card size, radius, accent color, show product chip),
  Placement (home / all products / specific products / collections), Status.
- "Add to theme" card: button deep-linking into the theme editor + 3 short steps.
- Live preview (stretch): sticky right column with Desktop/Mobile toggle using the same CSS tokens as the storefront.

**Analytics**
- Date range (7 / 30 / 90 days). KPI cards with change vs previous period.
- Views and add-to-carts over time. Top videos table.
- Empty state: "Your analytics will appear once shoppers watch your videos."

**Settings**
- Connected accounts (Instagram, only when flag on): avatar, @username, last synced, reconnect banner, disconnect.
- Defaults for new widgets (accent color, radius).

**Plans**
- Current plan, usage against limits, button to Shopify's hosted plan selection page. Short FAQ.
- Upgrade prompts elsewhere are calm modals or banners, never blocking walls.

---

## Part 2 — Storefront widget

### Principles
1. Feels like Instagram Reels / TikTok: vertical, immersive, fast.
2. Adapts to the theme: inherits fonts, uses theme-friendly neutral surfaces, customizable accent.
3. Never hurts the store: no layout shift, no render blocking, lazy everything.
4. Accessible by default.

### Tokens (CSS custom properties, set on the widget root)
```
--rl-accent:        #111111   (merchant setting)
--rl-on-accent:     #ffffff
--rl-text:          currentColor
--rl-surface:       #ffffff
--rl-surface-muted: rgba(0,0,0,.04)
--rl-overlay:       linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0) 45%)
--rl-radius:        14px      (merchant setting, 0–24px)
--rl-gap:           12px
--rl-card-w:        clamp(140px, 42vw, 220px)   (S / M / L variants)
--rl-shadow:        0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)
--rl-ease:          cubic-bezier(.2,.8,.2,1)
--rl-dur:           220ms
--rl-z-player:      2147483000
```
All classes are prefixed `.rl-`. `font-family: inherit` everywhere.

### Video card
- `aspect-ratio: 9 / 16`, `object-fit: cover`, radius `--rl-radius`, `--rl-shadow`.
- Static poster (signed Stream thumbnail) always visible first; an **animated thumbnail** preview fades in (opacity) while the
  card is ≥ 50 % visible (max 2 at once). If the animated image fails or under reduced motion / Save-Data, the static poster stays.
  No autoplaying HLS/iframe in cards (cost and performance — D11).
- Bottom overlay gradient; product chip (thumbnail 28px, price) at the bottom-left; small play icon.
- Hover (pointer devices only): `transform: translateY(-2px) scale(1.01)`, stronger shadow. Disabled under reduced motion.
- Focus: visible 2px outline using `--rl-accent` with offset.

### Carousel block
- Heading (optional) aligned per setting.
- Desktop: horizontal `scroll-snap` row with arrow buttons that appear on hover/focus; disabled at ends.
- Mobile: swipe with a visible peek of the next card. No arrows.
- Skeleton: same card size with a subtle shimmer (disabled under reduced motion).

### Product videos block
- Compact carousel on product pages, videos tagged with the current product.
- Renders nothing (no spacing) when there are no videos.

### Player
The MVP uses Cloudflare's embedded Stream player (iframe) inside our own dialog (D11). Our dialog owns the chrome
(close, prev/next, product sheet, mute toggle via the Player API); the iframe owns video rendering. Constraints and
workarounds: `docs/STREAM.md` §6.

- Desktop: centered 9:16 player (max height 90vh) over a dark blurred backdrop, prev/next arrows on the sides, close at top-right.
- Mobile: full-screen, vertical swipe, safe-area insets respected. Swipes that start on the iframe are not delivered to our page;
  swipe/next works from our edge/overlay zones and buttons (see `docs/STREAM.md` §6).
- Top: thin progress bar (from Player API `timeupdate`); mute toggle (remember choice in sessionStorage); tap to pause/play —
  taps inside the iframe are handled by the Stream player itself, so our icon flash only follows Player API `play`/`pause` events.
- Bottom sheet: product card (image, title, price, compare-at with sale badge, "Add to cart"). Multiple products → horizontal list of compact cards.
- Variant sheet: option pills (size, color); unavailable options disabled with strike style; price updates live.
- Add to cart button states: default → loading (spinner, disabled) → "Added" (check icon, 2s) → default. Errors show inline text, not alerts.
- Opening animation: scale/opacity from the card (220ms); none under reduced motion.
- Semantics: `role="dialog"`, `aria-modal="true"`, labelled by the video title; focus trap; ESC closes; focus returns to the opening card;
  body scroll locked without page jump.
- Video error (Player API `error`, or expired signed URL): show poster + "Couldn't load video. Retry" (retry refetches fresh signed URLs).

### Motion
Only `transform` and `opacity` animate. Durations 150–250ms. Everything respects `prefers-reduced-motion: reduce`.

### Accessibility checklist
- Contrast ≥ 4.5:1 for text over video (the overlay gradient guarantees it).
- Touch targets ≥ 44×44px.
- All controls have accessible names. Icons are `aria-hidden`.
- Keyboard: Tab through cards, Enter opens, arrows navigate in player, ESC closes.

### Performance budget
- JS ≤ 25 KB gzipped, CSS ≤ 8 KB gzipped.
- Cards load only the static poster until near the viewport; max 2 animated previews at once. The Stream player SDK and iframe load
  only when the player opens. Do not preload neighbouring videos' media (each fetched segment is billed); at most pre-render the
  next poster.
- The third-party iframe/SDK weight is reported separately from our 25 KB JS budget.
- Lighthouse performance score drop ≤ 10 points with the widget installed (Dawn, mobile).
