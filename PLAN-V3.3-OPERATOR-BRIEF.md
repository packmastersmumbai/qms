# QR Scan Pilot — Operator Brief (1 Page)

**For:** GRN clerk, Security, Dispatch, Floor-1 in-charge, Floor-2 in-charge, IPQC tech
**Duration:** 5 working days, starting Day 0
**Web app:** https://script.google.com/macros/s/AKfycbyxRPJVpjs_CA7fXj3OsHbA4CZIJixLo_r7NmPJbz3z/exec?page=scan

---

## The 4 stickers and what they mean

| Sticker (mounted at) | Code | Verb (auto) | When to scan |
|---|---|---|---|
| Gate-In | `LOC\|GATE-IN` | **RECEIVE** | Every incoming lot — when GRN is being created |
| Gate-Out | `LOC\|GATE-OUT` | **SHIP** | Every outgoing lot — at dispatch loading |
| 1st-Floor-In | `LOC\|FLOOR-1-IN` | **UP-1** | When lift takes a lot up to 1st floor |
| 2nd-Floor-In | `LOC\|FLOOR-2-IN` | **UP-2** | When lift takes a lot up to 2nd floor |

**You never pick the verb.** The sticker decides. Just scan the sticker and enter the lot ID.

---

## 3-step scan procedure

1. **Open** the web app on your phone (link above or bookmark). Sign in with Google.
2. **Enter your 4-digit PIN** on the keypad → tap the chokepoint button that matches where you are.
3. **Type or scan the lot ID** (e.g. `PM/GRN/2026-001`) → tap **Submit**. Confirmation shows in 1 second.

If Wi-Fi is down → you will see a red "Scan didn't reach server" banner. Try again when Wi-Fi returns. The system records both attempts.

---

## PIN list (memorise yours; do NOT share)

| User | PIN | Role |
|---|---|---|
| Admin | 1234 | Admin (fallback) |
| Khushi | 1111 | GRN clerk |
| Anuj | 2222 | Floor-1 in-charge |
| Santosh | 3333 | Floor-2 in-charge |
| Rajesh | 4444 | Gate / Security |
| TBM | 5555 | Admin |
| BBM | 6666 | Owner |

---

## What we measure (so you know what success looks like)

- **Compliance** — did you scan at every chokepoint your lot passed through? Target ≥ 80%.
- **Locating accuracy** — when someone asks "where is lot X?", does the system return the right floor? Target ≥ 80%.
- **Time-to-locate** — under 2 minutes from question to answer.

No individual scoring. No penalties for missed scans. We are testing the system, not you.

---

## Day 1 morning

The warehouse-in-charge will stand at Gate-In + Gate-Out for the first 2 hours and coach the first 10 scans. Spot-checks on Floor-1 + Floor-2 at lunch. After Day 1 you scan unprompted.

---

## If something breaks

- Sticker damaged or unreadable → tell warehouse-in-charge; backup sticker in office.
- Web app shows error → screenshot + send to admin.
- Forgot your PIN → talk to admin; do NOT use someone else's PIN.

---

**One line to remember:** *Scan the sticker at the doorway. Enter the lot. Done.*
