# NewPMJobs Landing Page - UI Spec for Claude Code

This is a pixel-precise spec for the pre-login landing/homepage. Do NOT interpret, improvise, or "improve" any values. Use exactly what is listed. If something is not specified, ask before guessing.

Reference artifact: `newpmjobs-landing-v4.jsx` (attached as project knowledge)

---

## CRITICAL: Tailwind Conversion Notes

The reference artifact uses inline React styles. The codebase uses Tailwind. Here are the conversion rules:

### Arbitrary Values
Most positioning and sizing uses non-standard values. Use Tailwind arbitrary value syntax:
- `top: 72px` becomes `top-[72px]`
- `width: 155px` becomes `w-[155px]`
- `font-size: 48px` becomes `text-[48px]`
- `letter-spacing: -0.025em` becomes `tracking-[-0.025em]`

### Gradients
Tailwind's built-in gradient utilities only support simple linear gradients. For complex multi-stop or angled gradients, use arbitrary values:
- `background: linear-gradient(165deg, #081226 0%, #0C1E3A 30%, #0F2847 55%, #0A1F3D 75%, #081226 100%)` becomes `bg-[linear-gradient(165deg,#081226_0%,#0C1E3A_30%,#0F2847_55%,#0A1F3D_75%,#081226_100%)]`
- Replace spaces with underscores inside arbitrary gradient values

### Radial Gradient Orbs
These cannot be done with Tailwind utility classes. Use inline `style` attributes for radial gradients:
```jsx
<div className="absolute -top-[150px] -right-[120px] w-[600px] h-[600px] rounded-full pointer-events-none"
  style={{ background: "radial-gradient(circle, rgba(14,165,233,0.12), transparent 65%)" }} />
```

### Color Blending (mix function)
The artifact uses a JS `mix()` function to blend company brand colors with white at various percentages. This creates the tinted card backgrounds and gradient headers. You MUST keep this as a JS utility function. It cannot be done in pure Tailwind. Define it once and use it for inline `style` on company cards:
```js
function mix(hex, pct) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const f = pct / 100;
  return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`;
}
```
Usage: `mix("#4285F4", 96)` = Google blue at 96% white (very light tint for card bg). `mix("#4285F4", 55)` and `mix("#4285F4", 30)` for the header gradient stops.

### Custom Animations
Add these to `tailwind.config.js` under `theme.extend`:
```js
keyframes: {
  heroFloat: {
    '0%': { transform: 'translateY(0)' },
    '100%': { transform: 'translateY(-10px)' },
  },
  slideIn: {
    from: { opacity: '0', transform: 'translateY(24px)' },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
  pulse: {
    '0%, 100%': { opacity: '0.6' },
    '50%': { opacity: '1' },
  },
},
animation: {
  'hero-float': 'heroFloat 3s ease-in-out infinite alternate',
  'hero-float-slow': 'heroFloat 3.5s ease-in-out infinite alternate',
  'hero-float-slower': 'heroFloat 4s ease-in-out infinite alternate',
  'slide-in': 'slideIn 0.6s ease both',
  'pulse-dot': 'pulse 2s ease infinite',
},
```
For staggered delays, use inline `style={{ animationDelay: '0.4s' }}` since Tailwind doesn't support arbitrary animation-delay out of the box.

### Backdrop Blur
Tailwind supports this natively: `backdrop-blur-[16px]` or `backdrop-blur-md`.

### Grid Texture Overlay
Use a `<div>` with inline style for the repeating grid pattern:
```jsx
<div className="absolute inset-0 pointer-events-none"
  style={{
    backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
    backgroundSize: "60px 60px",
  }} />
```

### Input Placeholder Color
Use Tailwind: `placeholder:text-white/30`

---

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| hero-bg-start | #081226 | Hero/CTA gradient darkest stop |
| hero-bg-mid | #0C1E3A | Hero/CTA primary navy (also nav bg) |
| hero-bg-light | #0F2847 | Hero/CTA lighter navy stop |
| accent-blue | #0EA5E9 | CTA buttons, links, gradient text, badges |
| accent-blue-dark | #0284C7 | Button gradient end, logo gradient end |
| forest | #16874D | "+N new" badge text, salary chip text, "How it Works" label |
| badge-bg | #E8F5EE | "+N new" badge background, salary chip background |
| problem-red | #A14B38 | "The problem" section label |
| salary-gold | #B8860B | levels.fyi section label and heading |
| salary-bg-start | #FFFBF0 | levels.fyi card gradient start |
| salary-bg-end | #FFF5E0 | levels.fyi card gradient end |
| salary-border | #F0DEB0 | levels.fyi card border |
| text-primary | #1A1A2E | Headings, names, strong text |
| text-secondary | #6E6E80 | Body text, descriptions, locations |
| text-muted | #9494A8 | Timestamps, labels, footer text |
| text-dim | #C0C0CC | Pipe separators in job rows |
| card-border | #E0E0E6 | Card/input borders on light backgrounds |
| section-gray-start | #F0F4F8 | Light section gradient start |
| section-gray-mid | #E8EDF4 | Light section gradient mid |
| section-warm | #F5F3F0 | Warm section gradient stop |
| section-warm-2 | #F2EFE8 | Warm section gradient alt stop |
| section-cool | #EEF1F5 | Cool section gradient stop |
| section-cool-2 | #EDF0F5 | Cool section gradient alt |
| footer-bg | #060E1D | Footer background |

---

## Page Structure (top to bottom)

1. **Fixed Nav** (transparent, turns navy on scroll)
2. **Hero Section** (dark navy gradient, full viewport height)
   - Left: copy + CTA
   - Right: floating company cards + notification toasts
   - Bottom strip: company logos
3. **Problem Section** (light gray-to-warm gradient)
4. **How It Works** (warm-to-cool gradient)
5. **Product Screens** (dark navy gradient)
6. **Latest Jobs** (light cool-to-warm gradient)
7. **levels.fyi Callout** (warm gradient)
8. **Stats Bar** (cool gradient)
9. **Final CTA** (dark navy gradient)
10. **Footer** (darkest navy)

---

## 1. Fixed Nav

- `position: fixed; top: 0; left: 0; right: 0; z-index: 100`
- Default: `background: transparent`
- On scroll (>20px): `background: rgba(8, 18, 38, 0.92); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.06)`
- Transition: `all 0.3s ease`
- Inner container: `max-width: 1140px; margin: 0 auto; padding: 0 40px; height: 64px; display: flex; align-items: center; justify-content: space-between`

### Left: Logo
- PM box: 32x32px, border-radius 8px, gradient `135deg #0EA5E9 to #0284C7`, text "PM" white, weight 800, size 12px, letter-spacing 1.5px
- "NewPMJobs": white, weight 700, size 18px, gap 10px from logo

### Right: Nav links + button
- Links "How it Works", "Latest Jobs": `color: rgba(255,255,255,0.6); font-size: 14px; font-weight: 500; text-decoration: none`
- Gap between links: 24px
- "Sign In" button: gradient `135deg #0EA5E9 to #0284C7`, white text, weight 600, size 14px, padding 9px 22px, border-radius 8px

---

## 2. Hero Section

### Container
- Background: `linear-gradient(165deg, #081226 0%, #0C1E3A 30%, #0F2847 55%, #0A1F3D 75%, #081226 100%)`
- `min-height: 100vh; display: flex; flex-direction: column; position: relative; overflow: hidden`

### Decorative Orbs (absolute positioned, pointer-events: none)
1. Top-right: `-top-[150px] -right-[120px]` 600x600, `radial-gradient(circle, rgba(14,165,233,0.12), transparent 65%)`
2. Bottom-left: `-bottom-[100px] -left-[100px]` 500x500, `radial-gradient(circle, rgba(99,91,255,0.08), transparent 65%)`
3. Center: `top-[40%] left-[30%]` 300x300, `radial-gradient(circle, rgba(16,163,127,0.06), transparent 65%)`

### Grid Texture Overlay
- Absolute, covers full section, pointer-events: none
- See "Grid Texture Overlay" in Tailwind notes above

### Content Grid
- `max-width: 1140px; margin: 0 auto; padding: 110px 40px 40px`
- `display: grid; grid-template-columns: 1fr 1.1fr; gap: 40px; align-items: center`

### Left Column (copy)

#### "Made by a PM, for PMs" badge
- Container: `background: rgba(14,165,233,0.1); border: 1px solid rgba(14,165,233,0.18); padding: 5px 14px; border-radius: 20px; margin-bottom: 24px; display: inline-flex; align-items: center; gap: 6px`
- Pulsing dot: 6x6px circle, `background: #0EA5E9`, animation `pulse 2s ease infinite`
- Text: `font-size: 12px; font-weight: 600; color: #0EA5E9`
- Animation: `slideIn 0.6s ease 0.1s both`

#### Headline
- `font-size: 48px; font-weight: 900; color: #fff; line-height: 1.1; margin-bottom: 22px; letter-spacing: -0.025em`
- Text: "New PM role at your" / "dream company?" / "You'll know first."
- "You'll know first." has gradient text: `background: linear-gradient(135deg, #0EA5E9, #38BDF8, #7DD3FC); -webkit-background-clip: text; -webkit-text-fill-color: transparent`
- Animation: `slideIn 0.6s ease 0.2s both`

#### Subtext
- `font-size: 18px; color: rgba(255,255,255,0.5); line-height: 1.65; margin-bottom: 34px; max-width: 440px; font-weight: 400`
- Text: "We scan career pages at top tech companies every day and notify you the moment a product management role is posted. Pick your companies, and let the jobs come to you."
- Animation: `slideIn 0.6s ease 0.3s both`

#### Email input + button row
- `display: flex; align-items: center; gap: 10px`
- Input: `width: 260px; padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); font-size: 15px; color: #fff; background: rgba(255,255,255,0.05)`
- Placeholder: "Your email address", color `rgba(255,255,255,0.3)`
- Button: gradient `135deg #0EA5E9 to #0284C7`, white text, weight 700, size 15px, padding 14px 28px, border-radius 10px, `box-shadow: 0 4px 20px rgba(14,165,233,0.3)`
- Animation: `slideIn 0.6s ease 0.4s both`

#### Subtext below input
- "Free forever. No spam. No credit card."
- `font-size: 13px; color: rgba(255,255,255,0.25); margin-top: 12px; font-weight: 400`
- Animation: `slideIn 0.6s ease 0.5s both`

### Right Column (floating cards + toasts)

**CRITICAL: The absolute positioning of cards and toasts is intentional and carefully tuned. Do NOT rearrange.**

Container: `position: relative; height: 480px; animation: slideIn 0.8s ease 0.3s both`

#### HeroCard Component
Each card is `width: 155px; border-radius: 12px; overflow: hidden`
Box shadow: `0 8px 32px rgba(0,0,0,0.18)`
Border: `1px solid rgba(255,255,255,0.08)`

Card structure:
- Header band: `background: linear-gradient(135deg, mix(color, 55), mix(color, 30)); padding: 6px 9px; display: flex; align-items: center; gap: 5px`
  - Logo square: 20x20px, border-radius 4px, solid brand color, white letter centered, size 9px weight 700
  - Company name: size 12px, weight 700, color #1A1A2E
- Body: `background: mix(color, 96); padding: 12px 8px; text-align: center`
  - Badge (if newCount > 0): `background: #E8F5EE; color: #16874D; font-size: 8px; font-weight: 700; padding: 2px 7px; border-radius: 4px; margin-bottom: 5px`
  - Roles number: size 18px, weight 700, color #1A1A2E
  - "roles" label: size 10px, weight 500, color #6E6E80

Supports `noFloat` prop: when true, card does not animate on its own (used inside groups).

#### Toast Component
Each toast: `background: rgba(255,255,255,0.97); border-radius: 12px; padding: 10px 14px; border: 1px solid rgba(14,165,233,0.15); display: flex; align-items: center; gap: 10px`
PM icon: 34x34px, border-radius 9px, gradient `135deg #0EA5E9 to #0284C7`, "PM" white weight 800 size 10px
Title: size 12px, weight 700, color #0C1E3A
Subtitle: size 10px, color #6E6E80

Toasts use `marginTop: -8px` to overlap the bottom edge of their parent card.

#### Company Cards + Toast Groups

**CRITICAL: Cards with toasts must be grouped in a single parent container so they float together.** The parent container gets the `heroFloat` animation, and neither the card nor the toast inside it should have their own float animation. Cards without toasts (Stripe, Uber, Figma) float independently with their own animation.

Group structure:
```jsx
{/* Parent floats */}
<div style={{ position: "absolute", top: X, left: Y, animation: "heroFloat 3s ease-in-out infinite alternate" }}>
  <HeroCard noFloat />  {/* Card does NOT float on its own */}
  <ToastNotification />  {/* Toast also rides the parent's float */}
</div>
```

Standalone cards:
```jsx
<HeroCard style={{ position: "absolute", top: X, left: Y }} />  {/* Card floats on its own */}
```

##### Company data for cards

| Company | Color | Letter | Roles | New Count |
|---------|-------|--------|-------|-----------|
| Google | #4285F4 | G | 44 | 2 |
| Stripe | #635BFF | S | 33 | 1 |
| Netflix | #E50914 | N | 35 | 0 |
| OpenAI | #10A37F | O | 8 | 0 |
| Uber | #000000 | U | 45 | 1 |
| Discord | #5865F2 | D | 12 | 0 |
| Figma | #A259FF | F | 5 | 0 |

##### Groups (card + toast float together)

| Group | Card Position | Float Duration | Float Delay | Toast marginTop | Toast marginLeft |
|-------|--------------|----------------|-------------|-----------------|------------------|
| Google + toast | `top: 0; left: 5` | 3s | 0s | -18px | 50px |
| Netflix + toast | `top: 170; left: 0` | 3.4s | 0.8s | -18px | 10px |
| OpenAI + toast | `top: 185; right: 10` | 3.6s | 1.2s | -18px | -15px |

##### Standalone cards (float independently)

| Card | Company | Position | Float Delay |
|------|---------|----------|-------------|
| Stripe | #635BFF | `top: 0; right: 45` | 0.4s |
| Uber | #000000 | `top: 355; left: 10` | 0.6s |
| Discord | #5865F2 | `top: 370; left: 175` | 1.0s |
| Figma | #A259FF | `top: 360; right: 5` | 1.4s |

##### Toast slide-in timing (animation: slideIn)

| Toast | Company | Role Text | Slide Delay | z-index |
|-------|---------|-----------|-------------|---------|
| 1 | Google | Sr. Product Manager, Cloud AI | 1s | 12 |
| 2 | Netflix | Dir. of Product, Content Platform | 1.6s | 11 |
| 3 | OpenAI | Product Manager, API Platform | 2.2s | 10 |

### Company Strip (bottom of hero)
- `border-top: 1px solid rgba(255,255,255,0.04); padding: 18px 0`
- Inner: `max-width: 1140px; margin: 0 auto; padding: 0 40px; display: flex; align-items: center; gap: 16px`
- "Tracking daily" label: size 11px, weight 600, `color: rgba(255,255,255,0.2)`, uppercase, letter-spacing 0.08em, no wrap
- Company chips: `display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 5px; padding: 3px 9px 3px 5px`
  - Mini logo: 14x14px, border-radius 3px, brand color bg, white letter size 7px weight 700
  - Name: size 10px, weight 500, `color: rgba(255,255,255,0.4)`
- "+ more" chip: `background: rgba(14,165,233,0.08); border: 1px solid rgba(14,165,233,0.12)`, text color #0EA5E9

Companies to show in strip: Google, Netflix, Stripe, Uber, Airbnb, OpenAI, Anthropic, Discord, Figma, Roblox, DoorDash, Reddit, Meta, Instacart, PayPal, Cisco

---

## 3. Problem Section

- Background: `linear-gradient(180deg, #F0F4F8 0%, #E8EDF4 40%, #F5F3F0 100%)`
- Padding: `100px 0 60px`
- Inner: `max-width: 1140px; margin: 0 auto; padding: 0 40px`

### Header
- Label: "The problem with PM job hunting", size 12px, weight 700, color #A14B38, uppercase, letter-spacing 0.1em
- Heading: "Job boards weren't built for product managers.", size 38px, weight 800, color #0C1E3A, line-height 1.15, margin-top 12px, letter-spacing -0.015em
- Centered

### Pain Point Cards
- `display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 900px; margin: 0 auto`
- Each card: `background: rgba(255,255,255,0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.6); border-radius: 14px; padding: 24px 22px; display: flex; gap: 14px; align-items: flex-start; box-shadow: 0 1px 4px rgba(0,0,0,0.02)`
- Emoji: size 22px, flex-shrink 0
- Title: size 16px, weight 700, color #0C1E3A, margin-bottom 4px
- Description: size 14px, color #6E6E80, line-height 1.55, weight 430

Cards (in order):
1. "PM roles are buried in noise" / 'Search "product manager" and you get production managers, project managers, and product engineers. Finding real PM roles takes forever.'
2. "Location filters don't work" / "You want US-based or remote roles. Instead, you scroll through hundreds of listings in countries you can't work in."
3. "Level and salary are a mystery" / "Is this a senior role or an entry-level one? What's the comp range? Most listings don't tell you, and you waste time applying blind."
4. "You're checking the same pages daily" / "You have 10 dream companies. Every morning you visit each careers page and scroll through listings, hoping something new appeared."

---

## 4. How It Works Section

- Background: `linear-gradient(180deg, #F5F3F0 0%, #EEF1F5 50%, #F0F4F8 100%)`
- Padding: `80px 0`
- `id="how-it-works"` for nav anchor

### Header
- Label: "How it works", size 12px, weight 700, color #16874D, uppercase, letter-spacing 0.1em
- Heading: "Three steps. Zero manual searching.", same sizing as Problem heading

### Step Cards
- `display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px`
- Each card: `background: rgba(255,255,255,0.6); backdrop-filter: blur(16px); border-radius: 16px; padding: 32px 28px; border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 2px 12px rgba(0,0,0,0.03); position: relative; overflow: hidden`
- Watermark number: `position: absolute; top: -10px; right: -6px; font-size: 80px; font-weight: 900; color: rgba(14,165,233,0.06); line-height: 1`
- Icon emoji: size 28px, margin-bottom 14px
- Title: size 18px, weight 700, color #0C1E3A, margin-bottom 8px
- Description: size 15px, color #6E6E80, line-height 1.6, weight 430

Steps:
1. "Pick your companies" / "Choose from 20+ top tech companies like Google, Stripe, Netflix, OpenAI, and more. Or add any company with a careers page."
2. "We scan every morning" / "Our scrapers check each company's careers page daily and filter for real product management roles. No noise, no duplicates."
3. "Get notified same-day" / "New PM role posted? You'll know within 24 hours, delivered to your inbox with salary data from levels.fyi so you can act fast."

---

## 5. Product Screens Section

- Background: `linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #081226 100%)`
- Padding: `80px 0`
- Orbs: top-left and bottom-right, same pattern as hero

### Header
- Label: "See it in action", size 12px, weight 700, color #0EA5E9, uppercase
- Heading: "Everything you need, all in one place.", size 34px, weight 800, color #fff
- Subtext: "Your dashboard. Every PM job. Full salary details.", size 16px, color `rgba(255,255,255,0.4)`, weight 400

### Mock Screens
- `display: grid; grid-template-columns: 1.3fr 0.9fr 0.9fr; gap: 16px; align-items: start`
- Each mock has a macOS-style window chrome (three dots: #FF5F56, #FFBD2E, #27C93F, each 8x8px circles) and a label
- Background: #FBFBFC, border-radius 10px, padding 16px, border: 1px solid rgba(224,224,230,0.5)
- Caption below each: size 13px, color `rgba(255,255,255,0.35)`, weight 500, centered, margin-top 10px

**Dashboard Mock:** 5 mini company cards in a 5-column grid. Same card structure as main dashboard but smaller (logo 16px, name 10px, roles 16px). Companies: Google (44, +2), Stripe (33, +1), Netflix (35), Uber (45, +1), Airbnb (6).

**Jobs List Mock:** 3 job rows. Each: 24px logo square, title 10px weight 650, company+location 8px, salary chip 8px in green badge.

**Job Detail Mock:** Full detail with 32px logo, title 13px, tags row (Senior, $198K-$284K, Full-time, Hybrid), levels.fyi salary box (warm background with gold accent), Apply + Save buttons.

The levels.fyi box in Job Detail Mock uses: `background: linear-gradient(135deg, #FFFBF0, #FFF5E0); border: 1px solid #F0DEB0; border-radius: 6px`

---

## 6. Latest Jobs Section

- `id="jobs"` for nav anchor
- Background: `linear-gradient(180deg, #F0F4F8 0%, #EDF0F5 50%, #F2EFE8 100%)`
- Padding: `80px 0`

### Header Row
- Left: label "Fresh from today's scan" (blue, uppercase) + heading "Latest PM roles"
- Right: "View All Jobs" button: `background: rgba(255,255,255,0.8); backdrop-filter: blur(8px); border: 1px solid rgba(224,224,230,0.5); padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 600`

### Job Rows
- `display: flex; flex-direction: column; gap: 10px`
- Each row: `background: rgba(255,255,255,0.6); backdrop-filter: blur(12px); border: 1px solid rgba(224,224,230,0.5); border-radius: 12px; padding: 16px 20px; display: flex; align-items: center; gap: 14px; cursor: pointer`
- Hover: `background: rgba(255,255,255,0.95); border-color: #0EA5E9; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(14,165,233,0.1)`
- Logo square: 40x40px, border-radius 10px, brand color bg, white letter 16px weight 700
- Title: size 15px, weight 650, color #0C1E3A
- Company + location: size 13px, color #6E6E80, weight 500, separated by pipe (color #C0C0CC)
- Salary chip (right): `background: #E8F5EE; color: #16874D; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 6px`
- Posted time (right, below salary): size 12px, color #9494A8, weight 500

Jobs to show (9 total):
1. Google #4285F4 / "Senior Product Manager, Cloud AI" / Mountain View, CA / $198K - $284K / 2 hours ago
2. Stripe #635BFF / "Product Manager, Payment Methods" / San Francisco, CA / $176K - $264K / 5 hours ago
3. Netflix #E50914 / "Director of Product, Content Platform" / Los Gatos, CA / $270K - $420K / 1 day ago
4. Airbnb #FF5A5F / "Product Manager II, Search & Discovery" / Remote (US) / $160K - $215K / 1 day ago
5. Discord #5865F2 / "Senior PM, Safety & Trust" / San Francisco, CA / $183K - $210K / 3 days ago
6. OpenAI #10A37F / "Product Manager, API Platform" / San Francisco, CA / $245K - $385K / 4 days ago
7. Roblox #E2231A / "Senior PM, Creator Monetization" / San Mateo, CA / $220K - $295K / 5 days ago
8. Meta #0668E1 / "Product Manager, AI Experiences" / Menlo Park, CA / $185K - $267K / 5 days ago
9. Figma #A259FF / "PM, Developer Platform" / San Francisco, CA / $168K - $245K / 6 days ago

NOTE: These are placeholder/example jobs. When the backend supports it, replace with real data from Supabase. For now, hardcode these.

Footer text: "Sign up to see all roles, set alerts, and save your favorites." size 14px, color #9494A8, centered, margin-top 28px

---

## 7. levels.fyi Callout Section

- Background: `linear-gradient(180deg, #F2EFE8 0%, #F5F2EB 50%, #EEF1F5 100%)`
- Padding: `40px 0 80px`

### Card
- `background: linear-gradient(145deg, rgba(255,251,240,0.8), rgba(255,248,232,0.6)); backdrop-filter: blur(16px); border: 1px solid rgba(240,222,176,0.5); border-radius: 18px; padding: 40px 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; box-shadow: 0 2px 16px rgba(184,134,11,0.04)`

### Left: Copy
- Label: "Salary Intelligence", size 12px, weight 700, color #B8860B, uppercase, letter-spacing 0.08em
- Heading: "Know the comp before you apply.", size 28px, weight 800, color #0C1E3A, line-height 1.2
- Body: "Every job listing includes real salary data from levels.fyi. See base pay, stock, and total compensation so you never waste time on roles outside your range.", size 15px, color #6E6E80, line-height 1.6

### Right: Salary Data Card
- `background: rgba(255,255,255,0.85); border-radius: 12px; padding: 24px; border: 1px solid rgba(240,222,176,0.4); box-shadow: 0 4px 16px rgba(184,134,11,0.05)`
- Title: "Google Sr. Product Manager", size 12px, weight 700, color #B8860B
- Stats grid: 3 columns
  - Median Total: $284K
  - Base Salary: $198K
  - Stock/yr: $86K
  - Values: size 26px, weight 800, color #0C1E3A
  - Labels: size 11px, color #9494A8, weight 500
- Footer: "Powered by" (size 11, #9494A8) + "levels.fyi" (size 12, weight 700, #0C1E3A), border-top 1px rgba(240,222,176,0.4)

---

## 8. Stats Section

- Background: `linear-gradient(180deg, #EEF1F5 0%, #F0F4F8 100%)`
- Padding: `0 0 80px`
- `display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px`

Each stat box: `background: rgba(255,255,255,0.65); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.5); border-radius: 14px; padding: 28px 20px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.02)`

| Value | Label | Color |
|-------|-------|-------|
| 20+ | Companies tracked | #0C1E3A |
| 250+ | PM roles monitored | #0C1E3A |
| 6AM | Daily scans complete | #0C1E3A |
| Free | No credit card ever | #0EA5E9 |

Value: size 32px, weight 900. Label: size 13px, color #6E6E80, weight 500, margin-top 4px.

---

## 9. Final CTA Section

- Background: `linear-gradient(165deg, #081226 0%, #0C1E3A 40%, #0F2847 70%, #0A1F3D 100%)`
- Same orbs and grid texture as hero
- Padding: 80px 40px, centered text

- Heading: "Your next PM role is one scan away.", size 38px, weight 800, color white
- Subtext: "Join free. Pick your companies. Get daily alerts.", size 17px, color `rgba(255,255,255,0.4)`
- Email input + button: same as hero CTA

---

## 10. Footer

- Background: #060E1D
- Border-top: `1px solid rgba(255,255,255,0.03)`
- Padding: 28px 40px
- `display: flex; align-items: center; justify-content: space-between`

- Left: PM logo (24x24px version) + "NewPMJobs" in `rgba(255,255,255,0.4)` weight 600 size 14px
- Right: "Built by [Vik Agarwal](linkedin link)" in `rgba(255,255,255,0.25)` size 13px. Link: color #0EA5E9, weight 600. Followed by " | Made by a PM, for PMs"

---

## Scroll Animations (IntersectionObserver)

Use a reusable component or hook. When element enters viewport (threshold 0.1):
- `opacity: 0 -> 1`
- `transform: translateY(30px) -> translateY(0)`
- `transition: opacity 0.7s cubic-bezier(.22,.68,0,.71), transform 0.7s cubic-bezier(.22,.68,0,.71)`
- Support `delay` prop applied to both transition properties
- Trigger once (disconnect observer after first intersection)

---

## Things NOT to do

- Do NOT use Inter, Roboto, or system fonts. Use Outfit only.
- Do NOT use em dashes or en dashes anywhere in UI text.
- Do NOT flatten the section gradients to solid colors.
- Do NOT remove the radial gradient orbs or grid texture. They create depth.
- Do NOT rearrange the hero card/toast positioning. The coordinates are pixel-tuned.
- Do NOT replace the `mix()` JS function with static colors. It must dynamically compute from the company's brand color.
- Do NOT simplify the backdrop-filter effects. The glassmorphism is intentional.
- Do NOT add any additional sections or CTAs not in this spec.
- Do NOT use Tailwind's built-in color palette (blue-500, gray-200, etc.) as substitutes. Use the exact hex values from the color table.

---

## Routing Note

This landing page should be the default route (`/`) for unauthenticated users. Authenticated users hitting `/` should be redirected to their dashboard. The existing `/login` page with magic link input can remain as a separate route, or the landing page CTA buttons can link to `/login`.
