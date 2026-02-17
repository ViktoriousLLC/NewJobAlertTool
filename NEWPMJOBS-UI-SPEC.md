# NewPMJobs Dashboard - UI Spec for Claude Code

This is a pixel-precise spec. Do NOT interpret, improvise, or "improve" any values. Use exactly what is listed. Every pixel value, color, and font weight is intentional. If something is not specified, ask before guessing.

---

## Global

- Font: `Outfit` from Google Fonts
- Import URL: `https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap`
- Apply `font-family: 'Outfit', sans-serif` to the root container AND every button, input, and span. Do not rely on inheritance alone.
- Page background: `#FBFBFC`
- Reset: `box-sizing: border-box; margin: 0; padding: 0` on all elements
- No em dashes or en dashes anywhere in the UI text

---

## Color Palette (exact hex values, do not substitute)

| Token | Hex | Usage |
|---|---|---|
| bg-page | #FBFBFC | Page background |
| nav-bg | #0C1E3A | Nav bar background |
| nav-active | #132B4D | Active nav button background |
| accent-blue | #0EA5E9 | PM logo gradient start, Add Company button |
| accent-blue-dark | #0284C7 | PM logo gradient end |
| forest | #16874D | Badge text color, healthy status dot, New stat number |
| badge-bg | #E8F5EE | "New" badge background (soft green tint) |
| rust | #A14B38 | Error status dot, Errors stat color |
| text-primary | #1A1A2E | Company names, roles number, headings |
| text-secondary | #6E6E80 | "roles" label text |
| text-muted | #9494A8 | Timestamps, stat labels, company count |
| card-border | #E0E0E6 | Card borders, footer divider, filter button borders |
| stat-total-bg | #FAF8F5 | Total stat box background |
| stat-total-border | #E8E4DF | Total stat box border |
| stat-new-bg | #F0FAF4 | New stat box background |
| stat-new-border | #C8E6D5 | New stat box border |
| stat-error-bg | #FDF5F3 | Error stat box background |
| stat-error-border | #E8CFC9 | Error stat box border |

---

## Nav Bar

- Height: `54px` exactly
- Background: `#0C1E3A`
- `position: sticky; top: 0; z-index: 100`
- Padding: `0 24px`
- `display: flex; align-items: center; gap: 8px`

### PM Logo
- Container: `width: 30px; height: 30px; border-radius: 6px`
- Background: `linear-gradient(135deg, #0EA5E9, #0284C7)`
- Text "PM": `color: #fff; font-weight: 800; font-size: 12px; letter-spacing: 1.5px`
- Centered with flexbox

### Brand Text
- "NewPMJobs": `color: #fff; font-weight: 700; font-size: 16px`
- Gap between logo and text: `10px`
- Right margin after brand group: `20px`

### Nav Buttons (Home, Starred, View All Jobs)
- Each: `border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 6px 14px`
- Text: `color: #fff; font-size: 13px; font-weight: 500`
- Home: `background: #132B4D`. Others: `background: transparent`
- Icons (plain text): Home = ⌂, Starred = ★, View All Jobs = ≡
- Icon: `font-size: 14px`, gap to label: `6px`
- `display: flex; align-items: center`

### Add Company Button
- `background: #0EA5E9; border: none; color: #fff; padding: 6px 16px; border-radius: 6px`
- `font-size: 13px; font-weight: 600; margin-left: 8px`

### User Section
- Spacer `flex: 1` between Add Company and user section
- Email: `color: rgba(255,255,255,0.6); font-size: 12px; font-weight: 500`
- Sign Out: `background: transparent; border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.7); padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-left: 6px`

---

## Main Content

- `max-width: 1320px; margin: 0 auto; padding: 18px 24px`

---

## Header Row

- `display: flex; align-items: stretch; justify-content: space-between; margin-bottom: 16px`

### Title
- "Dashboard": `font-size: 22px; font-weight: 700; color: #1A1A2E`

### Stat Boxes
- Container: `display: flex; gap: 10px; align-items: stretch`
- Each box: `border-radius: 8px; padding: 8px 18px; min-width: 80px`
- `display: flex; flex-direction: column; align-items: center; justify-content: center`
- Number: `font-size: 20px; font-weight: 700; line-height: 1`
- Label: `font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; opacity: 0.7`

| Stat | Background | Border | Number color | Label color |
|---|---|---|---|---|
| Total Roles | #FAF8F5 | #E8E4DF | #1A1A2E | #9494A8 |
| New | #F0FAF4 | #C8E6D5 | #16874D | #16874D |
| Errors | #FDF5F3 | #E8CFC9 | #A14B38 | #A14B38 |

---

## Filter Bar

- `display: flex; align-items: center; gap: 8px; margin-bottom: 16px`

### Search Input
- `padding: 7px 12px; border-radius: 7px; border: 1px solid #E0E0E6`
- `font-size: 13px; width: 200px; color: #1A1A2E; background: #fff; outline: none`
- Placeholder: "Search companies..."

### Filter Buttons (order: All, New, Healthy, Errors)
- `padding: 6px 14px; border-radius: 7px; font-size: 13px; font-weight: 600`
- Active: `background: #0C1E3A; border: 1px solid #0C1E3A; color: #fff`
- Inactive: `background: #fff; border: 1px solid #E0E0E6; color: #1A1A2E`
- `transition: all 0.15s ease`

### Company Count
- `font-size: 12px; color: #9494A8; margin-left: 6px; font-weight: 500`
- Singular/plural: "1 company" vs "5 companies"

---

## Card Grid

- `display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px`

---

## Company Card

**Total height: `156px` exactly. Do not change this.**

- `border-radius: 10px; overflow: hidden`
- `display: flex; flex-direction: column`
- `position: relative; cursor: pointer`
- Default border: `1px solid #E0E0E6`
- Default shadow: `0 1px 3px rgba(0,0,0,0.04)`

### Card Background
- Company brand color mixed 96% toward white
- Formula: `mix(brandColor, 96)` (see mixing formula below)

### Entrance Animation
- `animation: fadeUp 0.35s ease {index * 0.03}s both`
- `@keyframes fadeUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }`

### Hover State
- `transform: translateY(-3px)`
- Border: `1px solid {mix(brandColor, 50)}`
- Shadow: `0 8px 20px {mix(brandColor, 75)}44`
- `transition: all 0.2s ease`

### Delete Button (only visible on hover)
- `position: absolute; top: 5px; right: 5px`
- `width: 22px; height: 22px; border-radius: 5px`
- `background: rgba(0,0,0,0.3); color: #fff; font-size: 13px; border: none`
- Content: x character
- `z-index: 2; line-height: 1`
- Centered with flexbox

---

### Card Header Band

- `min-height: 42px; padding: 8px 10px`
- `display: flex; align-items: center; gap: 8px`
- Background: `linear-gradient(135deg, {mix(brandColor, 60)}, {mix(brandColor, 35)})`

#### Logo Square
- `width: 28px; height: 28px; border-radius: 6px`
- Background: raw brand color (NOT mixed)
- Letter: `color: #fff; font-weight: 700; font-size: 13px`
- `flex-shrink: 0`, centered with flexbox

#### Company Name
- `font-size: 16px; font-weight: 700; color: #1A1A2E; line-height: 1.1`

---

### Card Body (CRITICAL SECTION - READ CAREFULLY)

- `flex: 1` (fills space between header and footer)
- `display: flex; flex-direction: column; align-items: center; justify-content: center`
- When badge IS present: `gap: 10px`
- When badge is NOT present: `gap: 0`

This uses a "centered float" layout. Badge and roles are grouped together and vertically centered as a unit. When there is no badge, the roles count floats up into the center alone.

#### "New" Badge: Soft Tint Chip

**THIS IS THE MOST IMPORTANT VISUAL ELEMENT ON THE CARD.**

The badge is a soft green tinted rectangle. It is NOT a filled dark green pill.

Here is exactly how to render it:

```jsx
<span style={{
  background: '#E8F5EE',
  color: '#16874D',
  fontSize: 11,
  fontWeight: 700,
  padding: '3px 12px',
  borderRadius: 6,
  letterSpacing: '0.02em',
}}>
  +{newCount} new
</span>
```

Property by property:
- `background: #E8F5EE` - This is a LIGHT mint green. NOT #16874D. NOT any dark green.
- `color: #16874D` - Forest green TEXT. NOT white. NOT #fff.
- `font-size: 11px`
- `font-weight: 700`
- `padding: 3px 12px`
- `border-radius: 6px` - Soft rounded rectangle. NOT 20px. NOT a pill shape.
- `letter-spacing: 0.02em`
- Text format: `+{count} new` with plus sign, lowercase "new"
- Examples: "+2 new", "+1 new", "+4 new"

Only render when newCount > 0. When newCount is 0, render nothing in this position.

**MISTAKES THAT WILL REQUIRE A REDO:**
1. Using background #16874D (dark green fill) instead of #E8F5EE (light tint)
2. Using color #fff (white text) instead of #16874D (green text)
3. Using border-radius 20px (pill) instead of 6px (rounded rect)
4. Omitting the + sign
5. Capitalizing "New" instead of "new"
6. Showing placeholder text when there is no badge

#### Roles Count
- `display: flex; align-items: baseline; gap: 4px`
- Number: `font-size: 26px; font-weight: 700; color: #1A1A2E; line-height: 1`
- Label: `font-size: 13px; font-weight: 500; color: #6E6E80`
- Singular: "role" when count is 1. Plural: "roles" otherwise.

---

### Card Timestamp Footer

- `border-top: 1px solid #E0E0E6`
- `padding: 5px 10px`
- `display: flex; align-items: center; justify-content: center; gap: 5px`

#### Status Dot
- `width: 5px; height: 5px; border-radius: 50%`
- Healthy: `background: #16874D`
- Error: `background: #A14B38`

#### Time Text
- `font-size: 10px; color: #9494A8; font-weight: 500`
- Show ONLY the time: "6:06 AM" or "Failed" for errors
- No date, no "Last checked:" prefix

---

## Brand Colors

| Company | Hex | Letter |
|---|---|---|
| Uber | #000000 | U |
| Netflix | #E50914 | N |
| Google | #4285F4 | G |
| Stripe | #635BFF | S |
| eBay | #E53238 | E |
| Airbnb | #FF5A5F | A |
| Instacart | #43B02A | I |
| Anthropic | #D4A574 | A |
| PayPal | #003087 | P |
| OpenAI | #10A37F | O |
| Atlassian | #0052CC | A |
| Vanta | #5C2D91 | V |
| Cisco | #049FD9 | C |
| Slack | #611F69 | S |
| Figma | #A259FF | F |
| DoorDash | #FF3008 | D |
| Reddit | #FF4500 | R |
| Discord | #5865F2 | D |
| Roblox | #E2231A | R |
| Bitkraft | #1A1A2E | B |

---

## Color Mixing Formula

Copy this function exactly into a utils file. It is used for card backgrounds, header bands, and hover states.

```javascript
function mix(hex, percentTowardWhite) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = percentTowardWhite / 100;
  return `rgb(${Math.round(r + (255 - r) * f)}, ${Math.round(g + (255 - g) * f)}, ${Math.round(b + (255 - b) * f)})`;
}
```

Where it is used:
- Card background: `mix(brandColor, 96)`
- Header gradient left: `mix(brandColor, 60)`
- Header gradient right: `mix(brandColor, 35)`
- Hover border: `mix(brandColor, 50)`
- Hover shadow base: `mix(brandColor, 75)` with string `44` appended as hex alpha

---

## Things NOT to do

- Do NOT use Tailwind classes. Use inline styles or CSS modules with these exact values.
- Do NOT use Inter, Roboto, or system fonts. Only Outfit.
- Do NOT use a filled dark green pill for the badge. The badge is #E8F5EE background, #16874D text, border-radius 6px.
- Do NOT use border-radius 20px on the badge.
- Do NOT show placeholder text on cards without badges.
- Do NOT change the card height from 156px.
- Do NOT add "Last checked:" or dates to timestamps.
- Do NOT use purple, pastel, beige, or gray as accent colors.
- Do NOT use em dashes or en dashes anywhere.
- Do NOT make nav buttons free-floating text without borders.
- Do NOT capitalize "new" in the badge. It is lowercase.
- Do NOT omit the + sign before the number in the badge.
- Do NOT round any font sizes, padding, or gap values to "nicer" numbers.
- Do NOT substitute the Outfit font with any other font.
