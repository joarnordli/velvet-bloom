# Robust chrome — never let nav cover the composer

The screenshot shows the real failure mode: on `/meldinger/:id`, the global TopNav (`mittpunkt`) and BottomNav both render *on top of* a route that already has its own header and its own composer. The thread tries to reserve space with `pt-[5.25rem]` and `pb-[5rem]`, but the moment anything shifts (keyboard, URL-bar collapse, request-locked composer state, banner growing, route transition transforms) the floating chrome overlaps content. The only foolproof fix is to take the global chrome **out of immersive routes entirely** and let those routes own their own top/bottom edges.

## Root cause

Two competing layers fight over the bottom of the viewport:
- `BottomNav` is `position: fixed` + `z-40` and lives at the global root.
- The thread composer is a flow element inside a `h-[100svh]` flex column with `pb-[5rem]` slack.
Any extra UI (request banner, locked-composer notice, keyboard inset, pending attachments tray) eats into that slack and the composer slides under the nav.

Same for the top: the thread has its own back/avatar/menu header but the global `TopNav` still paints over it, so the thread compensates with 5.25rem of top padding that wastes real estate and still overlaps during transitions.

## Foolproof solution

**Treat conversation threads (and any future "immersive" route) as chrome-free.** The global chrome is for *browsing* surfaces (feed, discover, profile, inbox). Inside a single conversation it's noise and a collision risk.

### Changes

1. **`src/components/brand/GlobalChrome.tsx`** — replace the `inThread`/`!inThread && <Fab />` logic with a single `isImmersive` flag and short-circuit the whole render: if immersive, return `null` (no TopNav, no BottomNav, no FAB, no SideNav-bottom-overlap). `isImmersive` matches `/^\/meldinger\/[^/]+/` today; structured so future routes (e.g. fullscreen media viewer) can be added in one place.

2. **`src/routes/_authenticated/meldinger.$conversationId.tsx`** — the thread now owns the full viewport. Drop the chrome-compensation paddings:
   - Container becomes `h-[100dvh]` (dynamic viewport — shrinks with the keyboard) with `pt-[env(safe-area-inset-top)]` and no `pb-[5rem]`.
   - The thread's own header stays as the visible top bar.
   - The composer pins to the bottom of the flex column with `padding-bottom: env(safe-area-inset-bottom)`; with the global BottomNav gone there is nothing to clear.
   - With viewport meta `interactive-widget=resizes-content` (already set) plus `100dvh`, the composer rides above the keyboard natively on Android; the existing `useVisualViewportVars` shim covers iOS.

3. **`src/components/brand/SideNav.tsx`** — verify it has its own immersive guard for desktop. If it currently renders unconditionally, gate it on the same `isImmersive` check (read from `useRouterState`) so desktop threads also get the full viewport. (Audit-only step; only edit if it renders inside threads.)

4. **`src/styles.css`** — keep the existing `.app-top-nav` / `.app-bottom-nav` rules. No change needed since immersive routes simply don't mount those bars. Leave the visual-viewport vars and `keyboard-inset-height` margin in place for non-immersive routes.

### Why this is the most foolproof option

- Removes the entire class of "fixed bar overlaps flow content" bugs by removing the fixed bar, not by tuning padding.
- No reliance on JS measuring nav height and writing it into a CSS var (the previous attempted shim is fragile across orientation/keyboard/PWA standalone).
- Works identically in browser tab, installed PWA, iOS Safari, Android Chrome, and during route transitions, because there's nothing to collide with.
- Scales: any future fullscreen surface (camera, media viewer, onboarding) can join `isImmersive` and inherit the same guarantee.

### Risk acknowledgement (user accepted)

- Loss of bottom-tab nav inside a thread — user navigates out via the in-thread back arrow. This matches iMessage / WhatsApp / Instagram DM behavior and is the expected pattern for chrome-free chat.
- Slight visual jump entering/leaving a thread as the chrome unmounts/remounts. Acceptable trade-off for the stability win.

## Verification

- Open `/meldinger/:id` on mobile preview: only the thread header at top, only the composer at bottom, no `mittpunkt` bar, no bottom tab bar.
- Focus the textarea: composer hugs the keyboard on Android and iOS, no overlap.
- Send a message that triggers the recipient banner / locked-composer notice: the visible UI swaps cleanly with no nav fighting it.
- Tap back arrow → inbox restores TopNav, BottomNav, FAB.
- Desktop ≥ md: SideNav stays (unless step 3 finds it needs gating); thread fills the remaining viewport.

## Out of scope

- No changes to message logic, mutations, realtime, or styling tokens.
- No changes to inbox `/meldinger` (chrome stays there).
- No changes to the visual-viewport shim or viewport meta — those stay as the safety net for non-immersive routes.
