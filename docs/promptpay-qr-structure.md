# PromptPay / Thai QR Code — Structure Deep Dive

PromptPay QR is a profile of the **EMVCo Merchant-Presented Mode (MPM)** QR
standard, localized by the **Bank of Thailand (BOT) Thai QR Payment Standard**.
This document is the reference behind this library's generators.

Sources: EMVCo *EMV QR Code Specification for Payment Systems — MPM* (v1.1),
BOT *Thai QR Code Standard* (FPG circular), `dtinth/promptpay-qr`,
`saladpuk/PromptPay`, and a full decode of the in-repo KSHOP PHP example.

---

## 1. Encoding: TLV (Tag-Length-Value)

The whole payload is a flat string of TLV fields:

```
ID (2 digits) | LEN (2 digits, decimal, zero-padded) | VALUE (LEN chars)
```

- **ID**: 2 numeric digits (`00`–`99`).
- **LEN**: 2 **decimal** digits, zero-padded (`05`, `16`). NOT hex. Because it's
  2 digits, a single value maxes at 99 chars.
- **VALUE**: exactly LEN characters (ASCII).

Some IDs are **templates** — their VALUE is itself a string of nested TLV
sub-fields using the same rules. PromptPay uses templates at `29`, `30`, `31`,
`51`, and `62`.

Example: `000201` = ID `00`, LEN `02`, VALUE `01`.

---

## 2. Top-level ID allocation (EMVCo)

| ID | Meaning | PromptPay usage |
|----|---------|-----------------|
| `00` | Payload Format Indicator | always `01` |
| `01` | Point of Initiation Method | `11` static / `12` dynamic |
| `02`–`03` | Visa account templates | merchant card schemes (optional) |
| `04`–`05` | Mastercard account templates | merchant card schemes (optional) |
| `06`–`08` | EMVCo reserved | |
| `09`–`10` | Discover | |
| `11`–`12` | Amex | |
| `13`–`14` | JCB | |
| `15`–`16` | UnionPay | merchant card schemes (optional) |
| `17`–`25` | EMVCo reserved (payment networks) | |
| `26`–`51` | **Merchant Account Information templates** | **`29` P2P, `30` bill-pay, `31` e-wallet innovation** |
| `52` | Merchant Category Code (MCC, ISO 18245) | e.g. `5732` electronics |
| `53` | Transaction Currency (ISO 4217 numeric) | `764` = THB |
| `54` | Transaction Amount | e.g. `100.00` (omit for static) |
| `55` | Tip / convenience indicator | rarely used |
| `56`–`57` | Convenience fee fixed / percentage | rarely used |
| `58` | Country Code (ISO 3166-1 alpha-2) | `TH` |
| `59` | Merchant Name | e.g. `MY SHOP` |
| `60` | Merchant City | e.g. `BANGKOK` |
| `61` | Postal Code | optional |
| `62` | Additional Data Field Template | refs / labels (see §6) |
| `63` | **CRC** | 4 hex chars (see §7) |
| `64` | Merchant Info — Language Template | optional |
| `65`–`79` | RFU for EMVCo | |
| `80`–`99` | Unreserved templates | |

`63` (CRC) is always the **last** field.

---

## 3. PromptPay Application IDs (AIDs)

PromptPay merchant-account templates begin with sub-tag `00` = the AID. The
values below are from the **Bank of Thailand "Policy Guideline: Standardized
Thai QR Code for Payment Transactions" (17 April 2019)** — see §11.

| AID | Purpose | Template | Source |
|-----|---------|----------|--------|
| `A000000677010111` | Credit Transfer w/ PromptPay ID (merchant-presented) | tag `29` | BOT |
| `A000000677010114` | Credit Transfer (customer-presented) | tag `29` | BOT |
| `A000000677010112` | Bill Payment — **domestic** merchant | tag `30` | BOT |
| `A000000677012006` | Bill Payment — **cross-border** merchant | tag `30` | BOT |
| `A000000677012004` | Payment Innovation (API) | tag `31` | BOT |
| `A000000677010113` | Payment Innovation (as seen in KBank/KShop QRs) | tag `31` | **vendor — not in BOT guideline** |

> ⚠️ The original PHP and real KShop QRs use `A000000677010113` in tag `31`. That
> value is **not** documented in the BOT guideline (which lists `A000000677012004`
> for the Payment-Innovation API template). It appears to be a KBank/KShop-specific
> usage; the library reproduces whatever the caller/config provides.

---

## 4. Tag 29 — Credit Transfer (the common P2P PromptPay QR)

```
29 LL
   00 16 A000000677010111      ← AID
   01 13 0066812345678         ← mobile  (one of 01..05)
   02 13 1234567890123         ← national ID / tax ID
   03 15 123456789012345       ← e-wallet ID
   04 .. <bankcode+accountno>  ← bank account (BOT: ans, up to 43)
   05 10 <OTA>                 ← mandatory if AID = ...010114 (customer-presented)
```

Provide **exactly one** of the identifier sub-tags. Per the BOT guideline,
tag 29 also defines `04` (bank account = 3-digit bank code + account no.) and
`05` (OTA, mandatory for the customer-presented AID). This library generates
`01`/`02`/`03` (the common cases).

**Mobile normalization** (sub-tag `01`, always 13 chars):
1. Strip non-digits.
2. Drop a single leading `0`.
3. Prepend `66` (Thailand).
4. Left-pad with `0` to 13 chars.

`0812345678 → 812345678 → 66812345678 → 0066812345678`

National ID / tax ID → sub-tag `02`, 13 digits as-is.
E-wallet ID → sub-tag `03`, 15 digits as-is.

---

## 5. Tag 30 — Bill Payment (biller) + Reference 1 / Reference 2

```
30 LL
   00 16 A000000677010112      ← AID (domestic)
   01 LL <BillerID>            ← Biller ID = 13-digit Tax ID + 2-digit suffix (15)
   02 LL <Reference1>          ← mandatory, biller-defined
   03 LL <Reference2>          ← optional, biller-defined
```

Per the BOT guideline, tag 30 fields are: `00` AID (M), `01` Biller ID
(N, **15**, M), `02` Reference 1 (ans, up to **20**, **M**), `03` Reference 2
(ans, up to **20**, **O**).

- **Biller ID**: "National ID / Tax ID + Suffix" — the merchant's 13-digit tax
  ID plus a 2-digit suffix, so 15 chars. Bank-assigned.
- **Reference 1 (`02`)**: **mandatory** (per BOT). Biller-defined meaning —
  usually the customer/account/invoice identifier. Alphanumeric, ≤20.
- **Reference 2 (`03`)**: **optional** (per BOT). Secondary reference (branch,
  terminal, order id). Alphanumeric, ≤20. Omit the whole sub-tag if unused.

> The KSHOP PHP puts the bank-issued merchant ref in `02` and the per-order
> KShop reference in `03`. That's a valid biller-specific choice — not a fixed
> rule of the standard.

---

## 6. Tag 62 — Additional Data Field Template

Nested template carrying references/labels. Common sub-tags:

| Sub | Meaning |
|-----|---------|
| `01` | Bill Number |
| `02` | Mobile Number |
| `03` | Store Label |
| `04` | Loyalty Number |
| `05` | Reference Label |
| `06` | Customer Label |
| `07` | Terminal Label |
| `08` | Purpose of Transaction |
| `09` | Additional Consumer Data Request |

In the KSHOP example, `62` decodes as `05` (reference label) + `07` (terminal
label).

---

## 7. Tag 63 — CRC16

Algorithm: **CRC-16/CCITT-FALSE**.

- Width 16, polynomial `0x1021`, init `0xFFFF`.
- **No** input/output reflection, **no** final XOR.
- Computed over the **entire preceding payload INCLUDING the literal `6304`**
  (the CRC tag id + length), then the 4-char uppercase hex result is appended.

Test vector: `CRC("123456789") = 0x29B1`.

```
payload += "6304" + crc16(payload + "6304").toString(16).toUpperCase().padStart(4,"0")
```

---

## 8. Static vs Dynamic (tag 01)

Per EMVCo, tag `01` signals **intent**, not a technical lock:

| Value | EMVCo definition |
|-------|------------------|
| `11` | **Static** — use when *the same QR is shown for more than one transaction*. |
| `12` | **Dynamic** — use when *a new QR is shown for each transaction* (usually carries amount/reference). |

Important nuances:

- **The payload does not enforce single use.** A `12` payload has no nonce,
  counter, expiry, or session token — it is just static text with `01=12`. So a
  "dynamic" QR is physically **reusable**: re-scanning yields the same valid
  payload. Whether a second payment is *accepted* is decided by the bank /
  issuer back-end, not by the QR. (Observed: SCB accepts repeat payments on a
  `12` QR.)
- **An amount can appear under either value.** Including tag `54` doesn't
  require `12`; e.g. KShop-style QRs use `11` *with* an amount (see §9), and
  that form has the widest bank-app acceptance — notably **K PLUS rejects `12`**
  for that merchant family.
- Common shorthand calls `12` "one-time", but that's a convention (POS shows a
  fresh code per sale), not a property of the payload.

Practical guidance: omit `54` ⇒ `11` (reusable, payer types amount); fixed
amount ⇒ either works — choose based on the target apps' acceptance.

---

## 9. Worked example — KSHOP payload layout

Field layout of a KSHOP-format merchant QR. Values shown are **placeholders**;
the account-identifying fields (biller ID, merchant ref, card templates,
additional data) are supplied by the caller and issued by the bank.

```
00 02 01                                   Payload format = 01
01 02 12                                   Point of init = dynamic (carries amount)
02 .. <visa template>                      Visa merchant template (optional)
04 .. <mastercard template>                Mastercard merchant template (optional)
15 .. <unionpay template>                  UnionPay merchant template (optional)
30 ..                                       PromptPay BILL PAYMENT
   00 16 A000000677010112                      AID (domestic)
   01 .. <biller id>                           Biller ID
   02 .. <merchant ref>                        Reference 1 (merchant ref)
   03 .. <order ref>                           Reference 2 (per-order ref)
31 ..                                       PromptPay PAYMENT INNOVATION
   00 16 A000000677010113                      AID
   01 03 004                                    (network/sub-id)
   02 .. <merchant ref>                        merchant ref
   04 .. <order ref>                           order ref
51 ..                                       Card-scheme merchant template (optional)
   00 14 A0000000041010                         RID (Mastercard, public)
   01 .. <bin>                                  BIN/issuer
   02 .. <account ref>                          account ref
52 .. <mcc>                                 MCC (optional)
53 03 764                                   Currency = THB
54 06 100.00                                Amount
58 02 TH                                    Country
59 .. <merchant name>                       Merchant name
60 .. <merchant city>                       Merchant city
62 ..                                       Additional data (optional)
   05 .. <reference label>                      Reference label
   07 .. <terminal label>                       Terminal label
63 04 <crc>                                 CRC16
```

This library ships no merchant data: `generateKShopQR` requires the
account-identifying fields and emits the optional card/MCC/additional-data tags
only when they are provided.

---

## 10. Validation checklist for a generated payload

1. Starts with `000201`.
2. `01` is `11` or `12`, consistent with presence of `54`.
3. Exactly one merchant template identifies the payee (`29` *or* `30`/`31`).
4. `53` = `764`, `58` = `TH`.
5. Every TLV length matches its value; payload re-parses with no leftover bytes.
6. Ends with `6304` + valid CRC16 of everything before the 4 CRC chars.

---

## 11. Official source

The PromptPay-specific tags (29/30/31 AIDs and sub-tags, biller/reference
definitions) in this document were verified against the **Bank of Thailand**
primary source:

> **"Policy Guideline: Standardized Thai QR Code for Payment Transactions"**,
> Bank of Thailand, effective **17 April 2019 (B.E. 2562)**.
> EN: <https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2562/EngPDF/25620084.pdf>
> TH: <https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2562/ThaiPDF/25620084.pdf>

All top-level tags not specific to PromptPay (52/53/54/58/59/60/62/63 and the
Point of Initiation method `01`) are defined by **EMVCo "QR Code Specification
for Payment Systems: Merchant-Presented Mode (MPM)"**, which the BOT guideline
references rather than redefines. In particular, the BOT guideline does **not**
add its own static/dynamic semantics for tag `01` — see §8.
