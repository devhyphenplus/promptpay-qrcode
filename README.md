# promptpay-qrcode

Zero-dependency Node.js generator for **PromptPay QR payload strings** (the
EMVCo / Thai QR text you encode into a QR image). Three generators plus a
decoder:

1. **Standard PromptPay** (Tag 29) — mobile number, national/tax ID, or
   e-wallet ID, inspired by [saladpuk/PromptPay](https://github.com/saladpuk/PromptPay).
2. **Bill Payment** (Tag 30) — biller ID + reference(s). The merchant
   "bill payment" QR family, the same shape SCB's **แม่มณี (Mae Manee)** and
   similar merchant QRs use (the payer's app shows the shop name).
3. **KShop** — the KShop-format merchant QR (Tag 30 + Tag 31). You supply the
   account-identifying fields; the library ships no merchant data.

Plus `decode()` to read any PromptPay/Thai QR back into structured fields.

See [`docs/promptpay-qr-structure.md`](docs/promptpay-qr-structure.md) for a
deep dive on the EMVCo / Thai QR tag structure.

Output is the **payload string only** — pass it to any QR library, or use the
optional built-in image helpers (see [Rendering to an image](#rendering-to-an-image-optional)).

## Install

```
npm install promptpay-qrcode
```

The core has **no dependencies**. Image rendering uses the optional `qrcode`
peer dependency (install it only if you need images).

```js
const { generatePromptPay, generateBillPayment, generateKShopQR } = require('promptpay-qrcode');
```

## Standard PromptPay (Tag 29)

```js
generatePromptPay({ mobile: '0812345678' });              // static (no amount)
generatePromptPay({ mobile: '0812345678', amount: 100 }); // dynamic, 100.00 THB
generatePromptPay({ nationalId: '1234567890123' });
generatePromptPay({ ewallet: '123456789012345', amount: 50.25 });
```

Provide **exactly one** of `mobile`, `nationalId`, `ewallet`. By default the QR
is dynamic (POI `12`) when `amount` is present and static (POI `11`) otherwise.
Pass `dynamic: true | false` to force it either way:

```js
generatePromptPay({ mobile: '0812345678', amount: 100, dynamic: false }); // static w/ amount
generatePromptPay({ mobile: '0812345678', dynamic: true });               // dynamic w/o amount
```

Mobile numbers are normalized to the 13-char proxy form
(`0812345678` → `0066812345678`).

## Bill Payment (Tag 30) — Mae Manee / SCB merchant style

```js
generateBillPayment({
  billerId: '000000000000000', // bank-issued Biller ID (usually 15 digits)
  ref1: 'INV20240001',         // Reference 1 (mandatory)
  ref2: 'BRANCH01',            // Reference 2 (optional)
  amount: 50,                  // optional; present => dynamic QR (POI 12) by default
  dynamic: true,               // optional; force POI (true='12', false='11')
  merchantName: 'MY SHOP',     // optional (tag 59)
  merchantCity: 'BANGKOK',     // optional (tag 60)
});
```

The Biller ID and references are issued/defined by your bank (for SCB, via the
Mae Manee / Business QR onboarding). `ref1` is required; `ref2` is optional.

## KShop

The KShop-format merchant QR (Tag 30 + Tag 31). This library ships **no
merchant data** — you must supply the account-identifying fields, which your
bank issues. `billerId`, `merchantRef`, `merchantName` and `merchantCity` are
required; `generateKShopQR` throws if any are missing.

```js
const config = {
  billerId:     '000000000000000', // bank-issued Biller ID    (required)
  merchantRef:  'KB000000000000',  // bank merchant reference   (required)
  merchantName: 'MY SHOP',         // tag 59                    (required)
  merchantCity: 'BANGKOK',         // tag 60                    (required)
  // Optional — emitted only when provided:
  // visaTemplate, mastercardTemplate, unionpayTemplate, cardScheme,
  // mcc, additionalData, dynamic (default false), innovationSubId (default '004'),
  // innovationAid (tag 31 AID — default KShop value; see below)
};

generateKShopQR(100, 'ORDER0000000001', config);                       // static  (POI '11') — default
generateKShopQR(100, 'ORDER0000000001', { ...config, dynamic: true }); // dynamic (POI '12')
```

`amount` (1st arg) and `reference` (2nd arg — the per-order ref placed in tag
30/03 and 31/04) vary per call. Structural defaults (`dynamic: false`,
`currency: '764'`, `countryCode: 'TH'`, `innovationSubId: '004'`) live in
`KSHOP_DEFAULTS`; the required fields are listed in `REQUIRED_FIELDS`.

> **Tag 31 AID (`innovationAid`).** The Bank of Thailand guideline documents
> `A000000677012004` for the Payment-Innovation template, but **KBank/KShop QRs
> in the wild use `A000000677010113`**. The library defaults to the KShop value
> so real KShop QRs round-trip exactly; pass `innovationAid` to override:
>
> ```js
> const { generateKShopQR, AID_PAYMENT_INNOVATION_BOT } = require('promptpay-qrcode');
> generateKShopQR(100, 'ORDER1', { ...config, innovationAid: AID_PAYMENT_INNOVATION_BOT });
> ```
>
> Both AIDs are exported: `AID_PAYMENT_INNOVATION` (KShop, default) and
> `AID_PAYMENT_INNOVATION_BOT` (BOT). `detach`/`kshopParamsFrom` capture whichever
> the source QR used.

> **Static vs dynamic — bank-app compatibility.** KShop defaults to **static
> (POI `11`) with the amount included**, because that form is accepted by the
> widest range of apps — including **K PLUS** and the KShop app. In real-device
> testing, **dynamic (POI `12`) is rejected by K PLUS** for this merchant QR
> family (though it works in SCB, KTB Next, BBL and UOB). Pass `dynamic: true`
> only if you specifically target apps that accept POI `12`.

If you already have a master QR for an account, you can decode it and reuse its
fields — see [`kshopParamsFrom`](#decoding-a-qr-read-a-master-qr-back) below.

## Decoding a QR (read a master QR back)

`decode(payload)` parses any EMVCo / PromptPay / Thai QR string into structured
fields and validates the CRC:

```js
const { decode } = require('promptpay-qrcode');

const d = decode(masterQrString);
d.amount;        // 100        (null if none)
d.merchantName;  // 'MY SHOP'
d.poiMethod;     // '12'  (d.static === false)
d.crc.valid;     // true  -> the QR's checksum is correct
d.fields['30'];  // { '00': 'A000000677010112', '01': '000000000000000', ... }
d.tags;          // ordered [{ id, length, value }] of the top level
```

It throws on a malformed payload (a declared length running past the string).

### Cloning another KShop account from its master QR

`kshopParamsFrom(qr)` pulls out exactly the account-identifying fields you'd
pass to `generateKShopQR` — so you can mint new QRs for an existing account:

```js
const { kshopParamsFrom, generateKShopQR } = require('promptpay-qrcode');

const params = kshopParamsFrom(masterQr);
// params = { billerId, merchantRef, merchantName, merchantCity,
//            additionalData, visaTemplate, mastercardTemplate,
//            unionpayTemplate, cardScheme, innovationSubId, mcc,
//            currency, countryCode, dynamic }  (only those present)

// Generate a fresh QR for that account with your own amount + order ref:
const qr = generateKShopQR(250.5, 'ORDER123', params);
```

Per-transaction values (`amount`, and the order reference in tag 30/03 & 31/04)
are **not** included in `params` — you supply those per call. Round-trip is
exact: `generateKShopQR(amount, ref, kshopParamsFrom(qr))` reproduces the
original master QR byte-for-byte when given the same amount and ref.

### Detaching any master QR (all types)

`detach(qr)` is the generic version: it auto-detects the QR type and splits it
into reusable **account** info and the per-transaction values, for **all three**
families. `kshopParamsFrom` is the KShop-specific case underneath it.

```js
const { detach, generatePromptPay, generateBillPayment, generateKShopQR } = require('promptpay-qrcode');

const { type, account, transaction } = detach(masterQr);
```

| `type` | `account` (reusable) | `transaction` (per-call) | Regenerate |
| --- | --- | --- | --- |
| `'promptpay'` | `{ mobile \| nationalId \| ewallet }` | `{ amount, dynamic }` | `generatePromptPay({ ...account, ...transaction })` |
| `'billpayment'` | `{ billerId, merchantName?, merchantCity? }` | `{ ref1, ref2?, amount, dynamic }` | `generateBillPayment({ ...account, ...transaction })` |
| `'kshop'` | full KShop config (= `kshopParamsFrom`) | `{ amount, reference }` | `generateKShopQR(transaction.amount, transaction.reference, account)` |

```js
// Example: re-issue a bill-payment QR with a new amount, same account
const { account } = detach(masterBillQr);
const next = generateBillPayment({ ...account, ref1: 'INV2', amount: 75 });
```

For PromptPay the mobile proxy is reversed (`0066812345678` → `0812345678`) so
it round-trips through `generatePromptPay`. `detach` accepts a payload string or
a prior `decode()` result, and also returns the full `decoded` object.
`detectType(fields)` is exposed separately if you only need the type.

## CLI

A small command-line inspector ships with the package (`promptpay-qr`, or
`node cli.js` from the repo). It decodes a payload, validates the CRC, and shows
the detached account/transaction split and a tag dump — all locally, nothing
leaves your machine.

```
# from the repo
node cli.js '00020101021130...C9ED'
npm run decode -- '00020101...'          # via the npm script

# installed globally (npm i -g promptpay-qrcode)
promptpay-qr '00020101...'

# pipe it in, or get raw JSON
echo '00020101...' | promptpay-qr
promptpay-qr --json '00020101...'
```

Example output:

```
Type      : kshop
CRC       : C9ED  ✓ valid
POI       : 11  (static — K PLUS compatible)
Amount    : (none — payer enters)
Merchant  : MY SHOP / CITY

Account (reusable):    { billerId, merchantRef, merchantName, ... }
Transaction (per-call): { amount, reference }

Tags:
00 02 01
01 02 11
30 81
   00 16 A000000677010112
   ...
```

Exit code is `0` for a valid CRC, `1` for an invalid/malformed payload — handy
in scripts.

## Rendering to an image (optional)

The core is zero-dependency. To turn a payload into an actual QR image, install
the optional [`qrcode`](https://www.npmjs.com/package/qrcode) package:

```
npm install qrcode
```

Then use the built-in helpers — they lazy-load `qrcode` and reject with a clear
message if it isn't installed:

```js
const { generatePromptPay, toFile, toDataURL, toSVG, toBuffer, toTerminal } = require('promptpay-qrcode');

const payload = generatePromptPay({ mobile: '0812345678', amount: 100 });

await toFile('qr.png', payload, { width: 300, margin: 2 }); // PNG file
const url = await toDataURL(payload);                        // data:image/png;base64,...
const svg = await toSVG(payload);                            // SVG markup string
const buf = await toBuffer(payload);                         // PNG Buffer
console.log(await toTerminal(payload));                      // scannable QR in the terminal
```

The second `options` argument is passed straight through to `qrcode`
(`width`, `margin`, `color`, `errorCorrectionLevel`, …). See `example-image.js`
(`npm run example:image`) for a full demo.

## API

| Function | Returns |
| --- | --- |
| `generatePromptPay({ mobile \| nationalId \| ewallet, amount?, dynamic? })` | payload string |
| `generateBillPayment({ billerId, ref1, ref2?, amount?, dynamic?, merchantName?, merchantCity? })` | payload string |
| `generateKShopQR(amount, reference, config)` | payload string |
| `KSHOP_DEFAULTS` / `REQUIRED_FIELDS` | KShop structural defaults / required field list |
| `decode(payload)` | structured decode + CRC validation |
| `parseTLV(payload)` | low-level ordered `[{ id, length, value }]` |
| `kshopParamsFrom(qr)` | account params to clone a KShop master QR |
| `detach(qr)` | `{ type, account, transaction, decoded }` for any QR type |
| `detectType(fields)` | `'promptpay'` \| `'billpayment'` \| `'kshop'` \| `'unknown'` |
| `crc16Ccitt(str)` / `crc16Hex(str)` | CRC16-CCITT (number / 4-char hex) |
| `formatMobile(str)` | 13-char PromptPay mobile proxy |
| `toFile(path, payload, opts?)` | `Promise<void>` — write PNG file *(needs `qrcode`)* |
| `toDataURL(payload, opts?)` | `Promise<string>` — data URL *(needs `qrcode`)* |
| `toBuffer(payload, opts?)` | `Promise<Buffer>` — PNG buffer *(needs `qrcode`)* |
| `toSVG(payload, opts?)` | `Promise<string>` — SVG markup *(needs `qrcode`)* |
| `toTerminal(payload, opts?)` | `Promise<string>` — terminal QR *(needs `qrcode`)* |

## Files

- `crc.js` — CRC16-CCITT (0xFFFF init, 0x1021 poly).
- `promptpay.js` — standard PromptPay (Tag 29) + bill payment (Tag 30) generators.
- `kshop.js` — KShop generator (configurable, no bundled merchant data).
- `decode.js` — decode/parse a payload + `kshopParamsFrom` extractor.
- `image.js` — optional image helpers (lazy-load `qrcode`).
- `cli.js` — command-line inspector (`promptpay-qr` / `npm run decode`).
- `index.js` — public entry point.
- `test.js` — `npm test`. `example.js` — `npm run example`.
  `example-image.js` — `npm run example:image` (needs `qrcode`).
- `docs/promptpay-qr-structure.md` — EMVCo / Thai QR tag-structure reference.

## Tests

```
npm test
```

Verifies CRC against the `123456789 → 0x29B1` vector, TLV nesting parity, the
Tag 29 / Tag 30 / KShop structures, decode + CRC validation, and the
`kshopParamsFrom` → `generateKShopQR` round-trip.

## License

MIT — see [LICENSE](LICENSE).
