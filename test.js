'use strict';

const assert = require('assert');
const { crc16Hex, generatePromptPay, generateBillPayment, formatMobile, generateKShopQR, decode, kshopParamsFrom } = require('./index');
const { buildTagPayload } = require('./kshop');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

// --- Parse a payload back into a flat list of top-level TLV tags ---
function parseTLV(payload) {
  const out = [];
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    const value = payload.slice(i + 4, i + 4 + len);
    out.push({ id, len, value });
    i += 4 + len;
  }
  return out;
}

console.log('CRC16-CCITT:');
// Known PromptPay test vector: tag 00/01 + minimal body.
check('crc16Hex is 4 uppercase hex chars', () => {
  const h = crc16Hex('hello');
  assert.match(h, /^[0-9A-F]{4}$/);
});
check('crc16 of "123456789" === 0x29B1 (CCITT-FALSE)', () => {
  assert.strictEqual(crc16Hex('123456789'), '29B1');
});

console.log('formatMobile:');
check('0812345678 -> 0066812345678', () => {
  assert.strictEqual(formatMobile('0812345678'), '0066812345678');
});
check('dashes/spaces stripped', () => {
  assert.strictEqual(formatMobile('081-234-5678'), '0066812345678');
});

console.log('generatePromptPay (mobile, static):');
let p = generatePromptPay({ mobile: '0812345678' });
check('starts with 000201', () => assert.ok(p.startsWith('000201')));
check('POI method 11 (static)', () => {
  const tags = parseTLV(p);
  assert.strictEqual(tags.find((t) => t.id === '01').value, '11');
});
check('has no amount tag 54', () => {
  assert.ok(!parseTLV(p).some((t) => t.id === '54'));
});
check('merchant tag 29 has AID + mobile', () => {
  const m = parseTLV(p).find((t) => t.id === '29').value;
  const sub = parseTLV(m);
  assert.strictEqual(sub.find((t) => t.id === '00').value, 'A000000677010111');
  assert.strictEqual(sub.find((t) => t.id === '01').value, '0066812345678');
});
check('CRC validates (recompute matches)', () => {
  const crcTag = p.slice(-4);
  assert.strictEqual(crcTag, crc16Hex(p.slice(0, -4)));
});

console.log('generatePromptPay (mobile, dynamic w/ amount):');
let pa = generatePromptPay({ mobile: '0812345678', amount: 100 });
check('POI method 12 (dynamic)', () => {
  assert.strictEqual(parseTLV(pa).find((t) => t.id === '01').value, '12');
});
check('amount tag 54 = 100.00', () => {
  assert.strictEqual(parseTLV(pa).find((t) => t.id === '54').value, '100.00');
});

console.log('generatePromptPay (national id / ewallet):');
check('national id uses sub-tag 02', () => {
  const m = parseTLV(generatePromptPay({ nationalId: '1234567890123' })).find((t) => t.id === '29').value;
  assert.strictEqual(parseTLV(m).find((t) => t.id === '02').value, '1234567890123');
});
check('ewallet uses sub-tag 03', () => {
  const m = parseTLV(generatePromptPay({ ewallet: '123456789012345' })).find((t) => t.id === '29').value;
  assert.strictEqual(parseTLV(m).find((t) => t.id === '03').value, '123456789012345');
});
check('rejects more than one target', () => {
  assert.throws(() => generatePromptPay({ mobile: '081', nationalId: '1' }));
});

console.log('generateBillPayment (tag 30, Mae Manee / SCB style):');
let bp = generateBillPayment({ billerId: '000000000000000', ref1: 'INV001', amount: 50 });
check('uses tag 30 (not 29)', () => {
  const tags = parseTLV(bp);
  assert.ok(tags.some((t) => t.id === '30'));
  assert.ok(!tags.some((t) => t.id === '29'));
});
check('tag 30 has bill-pay AID, biller, ref1', () => {
  const sub = parseTLV(parseTLV(bp).find((t) => t.id === '30').value);
  assert.strictEqual(sub.find((t) => t.id === '00').value, 'A000000677010112');
  assert.strictEqual(sub.find((t) => t.id === '01').value, '000000000000000');
  assert.strictEqual(sub.find((t) => t.id === '02').value, 'INV001');
});
check('ref2 omitted when not given', () => {
  const sub = parseTLV(parseTLV(bp).find((t) => t.id === '30').value);
  assert.ok(!sub.some((t) => t.id === '03'));
});
check('ref2 + merchant name/city included when given', () => {
  const q = generateBillPayment({
    billerId: '000000000000000', ref1: 'A', ref2: 'B',
    merchantName: 'SHOP', merchantCity: 'BANGKOK',
  });
  const tags = parseTLV(q);
  const sub = parseTLV(tags.find((t) => t.id === '30').value);
  assert.strictEqual(sub.find((t) => t.id === '03').value, 'B');
  assert.strictEqual(tags.find((t) => t.id === '59').value, 'SHOP');
  assert.strictEqual(tags.find((t) => t.id === '60').value, 'BANGKOK');
});
check('amount -> dynamic POI 12 + valid CRC', () => {
  assert.strictEqual(parseTLV(bp).find((t) => t.id === '01').value, '12');
  assert.strictEqual(bp.slice(-4), crc16Hex(bp.slice(0, -4)));
});
check('static POI 11 when no amount', () => {
  const q = generateBillPayment({ billerId: '01', ref1: 'A' });
  assert.strictEqual(parseTLV(q).find((t) => t.id === '01').value, '11');
});
check('dynamic param forces POI override', () => {
  // force static even with an amount
  const s = generateBillPayment({ billerId: '01', ref1: 'A', amount: 5, dynamic: false });
  assert.strictEqual(parseTLV(s).find((t) => t.id === '01').value, '11');
  // force dynamic even without an amount
  const d = generateBillPayment({ billerId: '01', ref1: 'A', dynamic: true });
  assert.strictEqual(parseTLV(d).find((t) => t.id === '01').value, '12');
  assert.strictEqual(d.slice(-4), crc16Hex(d.slice(0, -4)));
});
check('generatePromptPay dynamic param overrides', () => {
  const s = generatePromptPay({ mobile: '0812345678', amount: 5, dynamic: false });
  assert.strictEqual(parseTLV(s).find((t) => t.id === '01').value, '11');
  const d = generatePromptPay({ mobile: '0812345678', dynamic: true });
  assert.strictEqual(parseTLV(d).find((t) => t.id === '01').value, '12');
});
check('requires billerId and ref1', () => {
  assert.throws(() => generateBillPayment({ ref1: 'A' }));
  assert.throws(() => generateBillPayment({ billerId: '01' }));
});

console.log('buildTagPayload (PHP parity):');
check('single array value: 00 02 01', () => {
  assert.strictEqual(buildTagPayload('00', ['01']), '000201');
});
check('object sub-tags nest with correct outer length', () => {
  // 30 -> 00 16 A000000677010112 (sub = "0016A000000677010112" = 20 chars) => "3020" + inner
  const r = buildTagPayload('30', { '00': 'A000000677010112' });
  assert.strictEqual(r, '3020' + '0016A000000677010112');
});

console.log('generateKShopQR:');
// Fixture config — all values are fabricated placeholders, not real accounts.
const KSHOP_FIXTURE = {
  billerId: '000000000000000',
  merchantRef: 'KB000000000000',
  merchantName: 'TEST MERCHANT',
  merchantCity: 'TEST CITY',
  visaTemplate: '0000000000000000',
  mastercardTemplate: '000000000000000',
  unionpayTemplate: '0000000000000000000000000000000',
  cardScheme: { '00': 'A0000000041010', '01': '000000', '02': '00000000000' },
  mcc: '5732',
  // tag 62 sub-TLVs: 05 (ref label, 9 chars) + 07 (terminal label, 8 chars)
  additionalData: '0509000000000070800000000',
};
const k = generateKShopQR(100, 'REF0000000000001', KSHOP_FIXTURE);
// 00 02 01  +  01 02 12  => "000201" + "010212" (dynamic, carries amount)
check('starts with 000201010212', () => assert.ok(k.startsWith('000201010212')));
check('POI method 12 (dynamic, has amount)', () => {
  assert.strictEqual(parseTLV(k).find((t) => t.id === '01').value, '12');
});
check('ends with valid 6304 CRC tag', () => {
  assert.strictEqual(k.slice(-8, -4), '6304');
  assert.strictEqual(k.slice(-4), crc16Hex(k.slice(0, -4)));
});
check('amount tag 54 = 100.00', () => {
  assert.strictEqual(parseTLV(k).find((t) => t.id === '54').value, '100.00');
});
check('tag 30 contains domestic AID, biller, ref, and reference', () => {
  const t30 = parseTLV(parseTLV(k).find((t) => t.id === '30').value);
  assert.strictEqual(t30.find((t) => t.id === '00').value, 'A000000677010112');
  assert.strictEqual(t30.find((t) => t.id === '01').value, KSHOP_FIXTURE.billerId);
  assert.strictEqual(t30.find((t) => t.id === '02').value, KSHOP_FIXTURE.merchantRef);
  assert.strictEqual(t30.find((t) => t.id === '03').value, 'REF0000000000001');
});
check('tag 59 merchant name from config', () => {
  assert.strictEqual(parseTLV(k).find((t) => t.id === '59').value, 'TEST MERCHANT');
});
check('full payload re-parses cleanly (lengths consistent)', () => {
  const tags = parseTLV(k);
  const rebuilt = tags.map((t) => t.id + String(t.len).padStart(2, '0') + t.value).join('');
  assert.strictEqual(rebuilt, k);
});
check('throws when required config fields are missing', () => {
  assert.throws(() => generateKShopQR(100, 'REF', { merchantName: 'X' }), /missing required config/);
});
check('throws when reference is missing', () => {
  assert.throws(() => generateKShopQR(100, '', KSHOP_FIXTURE), /reference is required/);
});
check('optional card templates omitted when not provided', () => {
  const minimal = generateKShopQR(100, 'REF', {
    billerId: '1', merchantRef: '2', merchantName: 'M', merchantCity: 'C',
  });
  const tags = parseTLV(minimal);
  assert.ok(!tags.some((t) => ['02', '04', '15', '51', '52', '62'].includes(t.id)));
  assert.strictEqual(minimal.slice(-4), crc16Hex(minimal.slice(0, -4)));
});
check('KSHOP dynamic:false yields static POI 11 + valid CRC', () => {
  const q = generateKShopQR(100, 'REF', Object.assign({}, KSHOP_FIXTURE, { dynamic: false }));
  assert.strictEqual(parseTLV(q).find((t) => t.id === '01').value, '11');
  assert.strictEqual(q.slice(-4), crc16Hex(q.slice(0, -4)));
});

console.log('decode():');
const dk = decode(k);
check('CRC reports valid for a good payload', () => assert.strictEqual(dk.crc.valid, true));
check('detects bad CRC', () => {
  const bad = k.slice(0, -1) + (k.slice(-1) === 'A' ? 'B' : 'A');
  assert.strictEqual(decode(bad).crc.valid, false);
});
check('top-level fields extracted', () => {
  assert.strictEqual(dk.amount, 100);
  assert.strictEqual(dk.currency, '764');
  assert.strictEqual(dk.countryCode, 'TH');
  assert.strictEqual(dk.merchantName, 'TEST MERCHANT');
  assert.strictEqual(dk.poiMethod, '12');
});
check('nested tag 30 expanded to object', () => {
  assert.strictEqual(dk.fields['30']['00'], 'A000000677010112');
  assert.strictEqual(dk.fields['30']['01'], KSHOP_FIXTURE.billerId);
  assert.strictEqual(dk.fields['30']['03'], 'REF0000000000001');
});
check('decodes a standard PromptPay mobile QR', () => {
  const d = decode(generatePromptPay({ mobile: '0812345678', amount: 50 }));
  assert.strictEqual(d.fields['29']['01'], '0066812345678');
  assert.strictEqual(d.amount, 50);
  assert.strictEqual(d.crc.valid, true);
});
check('throws on truncated payload (length overruns)', () => {
  // tag 00 declares length 05 but only 'AB' follows -> overrun
  assert.throws(() => decode('0005AB'));
});

console.log('kshopParamsFrom() round-trip:');
check('extracts account params from a KSHOP master QR', () => {
  const p = kshopParamsFrom(k);
  assert.strictEqual(p.billerId, KSHOP_FIXTURE.billerId);
  assert.strictEqual(p.merchantRef, KSHOP_FIXTURE.merchantRef);
  assert.strictEqual(p.merchantName, 'TEST MERCHANT');
  assert.strictEqual(p.merchantCity, 'TEST CITY');
  assert.strictEqual(p.additionalData, KSHOP_FIXTURE.additionalData);
  assert.strictEqual(p.dynamic, true);
});
check('regenerating with extracted params reproduces the master QR', () => {
  const params = kshopParamsFrom(k);
  const regen = generateKShopQR(100, 'REF0000000000001', params);
  assert.strictEqual(regen, k);
});
check('extracted params drive a NEW account QR', () => {
  // Simulate a different account's master QR, then reuse its params.
  const other = generateKShopQR(0, 'SEED', {
    billerId: '111111111111111',
    merchantRef: 'KB111111111111',
    merchantName: 'OTHER SHOP',
    merchantCity: 'OTHER CITY',
  });
  const params = kshopParamsFrom(other);
  const made = generateKShopQR(250.5, 'ORDER123', params);
  const d = decode(made);
  assert.strictEqual(d.fields['30']['01'], '111111111111111');
  assert.strictEqual(d.merchantName, 'OTHER SHOP');
  assert.strictEqual(d.fields['30']['03'], 'ORDER123');
  assert.strictEqual(d.amount, 250.5);
  assert.strictEqual(d.crc.valid, true);
});

console.log(`\nAll ${passed} checks passed.`);
