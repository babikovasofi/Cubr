---
name: anti-slop-design
description: Design quality constraints that prevent AI-default ("slop") visual design and copy. MUST be used whenever building, styling, or writing copy for any UI — landing pages, web apps, dashboards, components, emails, presentations. Bans the statistical-average AI look (purple gradients, Inter-everywhere, emoji icons, glassmorphism, feature-card grids, "seamless/unlock" copy) and enforces a deliberate design process instead. Trigger on any request like "make a landing page", "design a UI", "style this component", "write the hero copy".
---

# Anti-Slop Design

You are not a template engine. You are a designer with a point of view.

**Why this skill exists.** LLMs are prediction engines: without constraints they output the statistical average of their training data. That average is now instantly recognizable — users can spot a "vibe-coded" page in half a second, and it silently destroys trust and brand. Your job is to override the average with deliberate, subject-specific choices.

**Core rule:** every visual and verbal decision must be justified by THIS project's subject, audience, and content. If a choice would look the same on any other project, it is not a choice — it is a default. Replace it.

---

## Part 1 — HARD BANS: the visual tells

These patterns are the measurable fingerprint of AI-generated UI. Never use them unless the brief explicitly asks for one.

### Color & effects
- ❌ Purple/indigo/violet accents and purple-to-blue gradients (`indigo-500`, `violet-600`, `from-purple-* to-blue-*`). This is THE tell.
- ❌ Gradient text, glowing borders, neon glows, blurred "orbs" floating in the background.
- ❌ Glassmorphism (frosted-glass cards, `backdrop-blur` as decoration). Blur is allowed only to solve a real layering problem (e.g., a sticky header over scrolling content).
- ❌ Warm-cream background (#F4F1EA-ish) + high-contrast serif + terracotta accent (~#D97757) — the second most common AI default look.
- ❌ Near-black background + single acid-green or vermilion accent as a reflex "premium dark mode".
- ❌ Dark mode with low-contrast gray body text (below WCAG AA).
- ❌ Shadow soup: `shadow-md` with ~0.1 opacity on every element.

### Layout & components
- ❌ Centered hero with a small pill/badge above the H1 ("✨ Now in beta"), then a giant headline, then a subheadline, then two buttons. If the brief doesn't force it, find another hero.
- ❌ Three identical feature cards in a grid, each with an icon, a bold title, and two lines of text.
- ❌ Colored left border (border-left accent) on rounded cards — a single highly recognizable tell.
- ❌ Cards inside cards inside cards (3+ levels of nested padded/shadowed containers).
- ❌ Stat banners ("10k+ users / 99.9% uptime / 24/7 support") with invented numbers.
- ❌ Numbered step markers (01 / 02 / 03) unless the content is genuinely sequential and the order carries information.
- ❌ Tiny ALL-CAPS letter-spaced eyebrow labels above every section heading ("OUR FEATURES", "HOW IT WORKS").
- ❌ Rounded corners on literally everything at the same radius.
- ❌ Raw shadcn/ui defaults with zero visual customization.

### Typography
- ❌ Inter / Roboto / Arial / Space Grotesk as the automatic choice. They are allowed only as a deliberate, argued decision.
- ❌ The Space Grotesk + Instrument Serif combo; oversized *italic serif* hero headlines; serif italics for single accent words.
- ❌ 4–5 competing type styles in one hero (logotype + H1 + subhead + label + decorative element). Hierarchy = fewer levels, clearly separated.

### Icons, emoji, imagery
- ❌ Emoji as UI: emoji bullets (🚀 ✨ 💡 ✅ 📊), emoji in headings, buttons, nav, feature lists, empty states. Zero emoji in the interface unless the brief demands them.
- ❌ Decorative icons that add no information (an abstract lightning bolt next to "Fast").
- ❌ Empty/placeholder `src` on images, lorem-ipsum avatars, fake logos of "trusted by" companies.

### Motion
- ❌ Animate-everything: every section fading in on scroll, bouncing buttons, wiggling icons, cursor-following lines, floating badges.
- ❌ Hover states that REDUCE affordance (button fades/dims on hover instead of popping).
- ✅ Motion must pass one test: does it help the user understand the product or the state of the UI? If it's decoration for busyness — cut it. One orchestrated moment beats ten scattered effects. Always respect `prefers-reduced-motion`.

---

## Part 2 — HARD BANS: the copy tells

Copy can out a design as AI-generated even faster than visuals.

### Banned words (in UI copy, headlines, marketing text)
seamless, unlock, empower, elevate, supercharge, streamline, effortless, revolutionize, game-changing, cutting-edge, next-generation, leverage, delve, tapestry, landscape ("in today's digital landscape"), realm, journey, robust, holistic, "AI-powered" as a value proposition.

### Banned constructions
- "It's not X, it's Y." / "Not just X, but Y."
- Rhetorical question immediately answered by the next sentence.
- "In today's fast-paced world..." openers.
- Rule-of-three adjective chains ("fast, simple, and secure").
- Claims with no concrete referent ("boost your productivity"). If a sentence would be equally true for any other product, delete or specify it.
- Exclamation marks in UI; more than one em dash per screen of text.
- Title Case On Every Button And Heading (use sentence case).

### What to write instead
- **Specific beats clever.** Not "Empower your workflow" → "Cut review time from 2 days to 20 minutes." Real numbers only — never invent statistics, testimonials, or user counts.
- **Speak the user's language, not the system's.** "Manage notifications", not "Configure webhook events".
- **Active voice, exact verbs.** A button says exactly what happens: "Save changes", not "Submit". The verb stays consistent through the flow: "Publish" → toast "Published".
- **Errors and empty states give direction, not mood.** Say what went wrong and how to fix it. No apologies, no vagueness, no "Oops! 😅".
- Read every line aloud: if you wouldn't say it to a colleague, rewrite it.

---

## Part 3 — REQUIRED PROCESS (before writing any code)

Do not "generate a design and then fix it". Decide first, then build. Work through steps 1–4 in your reasoning; show the user only the result.

### 1. Ground in the subject
State in one or two sentences: what the product is, who the one primary audience is, and the single job of this page/screen. Pull distinctive material from the subject's own world — its vocabulary, artifacts, textures, instruments. A coffee roastery, a legal SaaS, and a rhythm game must not share a visual language.

### 2. Commit to a token system
Write it down before coding:
- **Palette:** 4–6 named hex values chosen FOR this subject. Check: would this palette be wrong for a random other product? If it fits anything, it fits nothing.
- **Type:** a characterful display face (used with restraint) + a complementary body face (+ optionally a utility face for data/captions). Name them and say why.
- **Layout concept:** one sentence + a rough wireframe. Choose ONE structural primitive and repeat it until it becomes the site's signature — not seven card styles, three banners, and a sidebar.
- **Signature element:** the single memorable thing this design will be remembered by (an interaction, a typographic device, an illustration system, a data visualization). Exactly one. Spend your boldness there; keep everything else quiet and disciplined.

### 3. Self-critique against the average
Ask: "If I got a similar brief with no constraints, would I land somewhere close to this?" For every part where the answer is yes — revise it. Also check consistency: one visual language across all sections (AI's tell is sections that look generated separately).

### 4. Build to a quality floor, silently
Responsive down to mobile; visible keyboard focus; AA contrast; consistent spacing scale; container padding ≥ 12px so text never touches edges; correct semantic hierarchy (one H1, ordered H2–H6); no broken/placeholder assets. Don't announce this — just do it.

### 5. Final checklist (run before delivering)
- [ ] Zero emoji in the UI
- [ ] Zero purple gradients, glows, glassmorphism, orbs
- [ ] No pill badge + centered hero + 3 feature cards template
- [ ] Fonts are a stated choice, not Inter-by-inertia
- [ ] One signature element; everything else restrained
- [ ] Every number and claim in the copy is real and specific
- [ ] No banned words/constructions from Part 2
- [ ] Motion only where it explains something; reduced-motion respected
- [ ] Chanel's rule applied: look at the result and remove one "accessory"

---

## Escape hatch

If the user's brief explicitly requests a banned pattern (e.g., "I want a purple gradient hero"), the brief wins — follow it exactly. These rules constrain YOUR defaults, not the user's intent. When a banned pattern genuinely is the best solution for the subject, you may use it, but you must be able to state the subject-specific reason in one sentence. "It looks modern" is not a reason.
