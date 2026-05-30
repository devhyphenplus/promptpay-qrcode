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

PromptPay merchant-account templates begin with sub-tag `00` = the AID.

| AID | Purpose | Template |
|-----|---------|----------|
| `A000000677010111` | Credit Transfer (mobile / national ID / e-wallet) | tag `29` |
| `A000000677010112` | Bill Payment (domestic biller) | tag `30` |
| `A000000677010113` | Payment / e-wallet Innovation | tag `31` |
| `A000000677010114` | Customer-Presented | (customer-side QR) |

---

## 4. Tag 29 — Credit Transfer (the common P2P PromptPay QR)

```
29 LL
   00 16 A000000677010111      ← AID
   01 13 0066812345678         ← mobile  (one of 01/02/03)
   02 13 1234567890123         ← national ID / tax ID
   03 15 123456789012345       ← e-wallet ID
```

Provide **exactly one** of sub-tags `01`/`02`/`03`.

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

- **Biller ID**: assigned by the bank; the merchant's 13-digit tax ID plus a
  2-digit suffix (commonly `00`), so 15 chars.
- **Reference 1 (`02`)**: mandatory. The biller decides its meaning — usually the
  customer/account/invoice identifier. Alphanumeric.
- **Reference 2 (`03`)**: optional secondary reference (e.g. branch, terminal,
  order id). Alphanumeric. Omit the whole sub-tag if unused.

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

| Value | Meaning |
|-------|---------|
| `11` | **Static** — reusable; amount usually omitted, payer types it. |
| `12` | **Dynamic** — single use; amount (`54`) present. |

Convention: include `54` ⇒ use `12`; omit `54` ⇒ use `11`. Scanners still read
an amount even if `01=11` (as the KSHOP payload does), but `12` is the correct
marker for a one-time amount.

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
