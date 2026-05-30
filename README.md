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
  // mcc, additionalData, dynamic (default true), innovationSubId (default '004')
};

generateKShopQR(100, 'ORDER0000000001', config);                        // dynamic (POI '12')
generateKShopQR(100, 'ORDER0000000001', { ...config, dynamic: false }); // static  (POI '11')
```

`amount` (1st arg) and `reference` (2nd arg — the per-order ref placed in tag
30/03 and 31/04) vary per call. Structural defaults (`dynamic: true`,
`currency: '764'`, `countryCode: 'TH'`, `innovationSubId: '004'`) live in
`KSHOP_DEFAULTS`; the required fields are listed in `REQUIRED_FIELDS`.

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
