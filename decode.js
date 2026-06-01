'use strict';

const { crc16Hex } = require('./crc');

// Templates whose value is itself a string of nested TLV sub-fields.
const NESTED_TAGS = new Set(['26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', '62', '64', '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

/**
 * Parse a TLV string into an array of { id, length, value } in order.
 * Throws if a declared length runs past the end of the string (malformed QR).
 * @param {string} payload
 * @returns {{id:string,length:number,value:string}[]}
 */
function parseTLV(payload) {
  const out = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) {
      throw new Error(`Malformed payload: truncated tag header at offset ${i}`);
    }
    const id = payload.slice(i, i + 2);
    const length = parseInt(payload.slice(i + 2, i + 4), 10);
    if (Number.isNaN(length)) {
      throw new Error(`Malformed payload: bad length for tag ${id} at offset ${i}`);
    }
    const start = i + 4;
    const end = start + length;
    if (end > payload.length) {
      throw new Error(`Malformed payload: tag ${id} length ${length} exceeds payload at offset ${i}`);
    }
    out.push({ id, length, value: payload.slice(start, end) });
    i = end;
  }
  return out;
}

/**
 * Recursively turn a TLV list into a plain object keyed by tag id. Nested
 * templates become nested objects. Where a tag id repeats (rare), values are
 * collected into an array.
 * @param {{id:string,value:string}[]} tags
 * @param {boolean} nested Whether this level may contain sub-templates.
 * @returns {Object}
 */
function tagsToObject(tags, nested) {
  const obj = {};
  for (const { id, value } of tags) {
    let v = value;
    if (nested && NESTED_TAGS.has(id)) {
      v = tagsToObject(parseTLV(value), true);
    }
    if (id in obj) {
      obj[id] = Array.isArray(obj[id]) ? obj[id].concat([v]) : [obj[id], v];
    } else {
      obj[id] = v;
    }
  }
  return obj;
}

/**
 * Decode an EMVCo / PromptPay / Thai QR payload string.
 *
 * @param {string} payload The raw QR text.
 * @returns {object} Structured decode:
 *   - tags: ordered [{id,length,value}] of the top level
 *   - fields: nested object keyed by tag id (templates expanded)
 *   - crc: { value, expected, valid }
 *   - amount, currency, countryCode, merchantName, merchantCity, poiMethod, static
 */
function decode(payload) {
  if (typeof payload !== 'string' || payload.length < 8) {
    throw new Error('decode() expects a QR payload string');
  }

  const tags = parseTLV(payload);
  const fields = tagsToObject(tags, true);

  // CRC: recompute over everything up to (but not including) the 4 CRC chars.
  const crcValue = fields['63'];
  let crc = null;
  if (typeof crcValue === 'string' && payload.endsWith(crcValue)) {
    const body = payload.slice(0, payload.length - crcValue.length);
    const expected = crc16Hex(body);
    crc = { value: crcValue, expected, valid: expected === crcValue.toUpperCase() };
  }

  const poi = fields['01'];
  return {
    tags,
    fields,
    crc,
    poiMethod: poi || null,
    static: poi === '11',
    amount: fields['54'] != null ? Number(fields['54']) : null,
    currency: fields['53'] || null,
    countryCode: fields['58'] || null,
    merchantName: fields['59'] || null,
    merchantCity: fields['60'] || null,
  };
}

/**
 * Given a KSHOP-style master QR, extract the account-identifying fields needed
 * to regenerate QRs for that account via generateKShopQR(amount, ref, params).
 *
 * Returns ONLY the mandatory / account-specific fields that are present, so the
 * result can be spread straight into the options argument. Per-transaction
 * values (amount, the order reference in 30/03 & 31/04) are intentionally
 * omitted — those are supplied per call.
 *
 * @param {string|object} qr A payload string or a prior decode() result.
 * @returns {object} Options suitable for generateKShopQR's 3rd argument.
 */
function kshopParamsFrom(qr) {
  const d = typeof qr === 'string' ? decode(qr) : qr;
  const f = d.fields;
  const t30 = f['30'] || {};
  const t31 = f['31'] || {};
  const t51 = f['51'] || {};

  const params = {};
  if (f['02'] != null) params.visaTemplate = f['02'];
  if (f['04'] != null) params.mastercardTemplate = f['04'];
  if (f['15'] != null) params.unionpayTemplate = f['15'];
  if (t30['01'] != null) params.billerId = t30['01'];
  // Merchant ref appears in 30/02 (and usually mirrored in 31/02).
  if (t30['02'] != null) params.merchantRef = t30['02'];
  if (t31['00'] != null) params.innovationAid = t31['00'];
  if (t31['01'] != null) params.innovationSubId = t31['01'];
  if (Object.keys(t51).length) params.cardScheme = t51;
  if (f['52'] != null) params.mcc = f['52'];
  if (f['53'] != null) params.currency = f['53'];
  if (f['58'] != null) params.countryCode = f['58'];
  if (f['59'] != null) params.merchantName = f['59'];
  if (f['60'] != null) params.merchantCity = f['60'];
  if (f['62'] != null) {
    // tag 62 is stored as an expanded object; re-flatten to its raw string.
    params.additionalData = flattenTag62(d.tags);
  }
  params.dynamic = d.poiMethod === '12';

  return params;
}

/** Pull tag 62's raw inner string from the ordered top-level tag list. */
function flattenTag62(tags) {
  const tag = tags.find((t) => t.id === '62');
  return tag ? tag.value : undefined;
}

/**
 * Reverse formatMobile: turn a 13-char PromptPay proxy back into a national
 * mobile number so it round-trips through generatePromptPay.
 * e.g. "0066812345678" -> "0812345678"
 * @param {string} proxy
 * @returns {string}
 */
function proxyToMobile(proxy) {
  let s = String(proxy).replace(/^0+/, ''); // drop the left-pad zeros
  if (s.startsWith('66')) s = s.slice(2); // drop the country code
  return '0' + s;
}

/**
 * Detect a QR's PromptPay type from its decoded fields.
 * @param {object} fields decode().fields
 * @returns {'promptpay'|'kshop'|'billpayment'|'unknown'}
 */
function detectType(fields) {
  if (fields['29']) return 'promptpay';
  if (fields['30'] && fields['31']) return 'kshop';
  if (fields['30']) return 'billpayment';
  return 'unknown';
}

/**
 * Detach a master QR into its reusable account info and its per-transaction
 * values. Works for all three types (auto-detected):
 *
 *   - promptpay  : account { mobile | nationalId | ewallet }, transaction { amount, dynamic }
 *   - billpayment: account { billerId, merchantName?, merchantCity? },
 *                  transaction { ref1, ref2?, amount, dynamic }
 *   - kshop      : account = kshopParamsFrom(qr), transaction { amount, reference }
 *
 * Regenerate a fresh QR from the parts:
 *   promptpay   -> generatePromptPay({ ...account, ...transaction })
 *   billpayment -> generateBillPayment({ ...account, ...transaction })
 *   kshop       -> generateKShopQR(transaction.amount, transaction.reference, account)
 *
 * @param {string|object} qr A payload string or a prior decode() result.
 * @returns {{ type: string, account: object, transaction: object, decoded: object }}
 */
function detach(qr) {
  const d = typeof qr === 'string' ? decode(qr) : qr;
  const f = d.fields;
  const type = detectType(f);

  let account = {};
  let transaction = {};

  if (type === 'promptpay') {
    const t29 = f['29'] || {};
    if (t29['01'] != null) account.mobile = proxyToMobile(t29['01']);
    else if (t29['02'] != null) account.nationalId = t29['02'];
    else if (t29['03'] != null) account.ewallet = t29['03'];
    transaction = { amount: d.amount, dynamic: d.poiMethod === '12' };
  } else if (type === 'kshop') {
    account = kshopParamsFrom(d); // includes dynamic + all merchant/card fields
    // The order reference lives in 30/03 (mirrored in 31/04).
    const ref = (f['30'] || {})['03'];
    transaction = { amount: d.amount, reference: ref != null ? ref : undefined };
  } else if (type === 'billpayment') {
    const t30 = f['30'] || {};
    if (t30['01'] != null) account.billerId = t30['01'];
    if (f['59'] != null) account.merchantName = f['59'];
    if (f['60'] != null) account.merchantCity = f['60'];
    transaction = {
      ref1: t30['02'],
      ref2: t30['03'] != null ? t30['03'] : undefined,
      amount: d.amount,
      dynamic: d.poiMethod === '12',
    };
  } else {
    // Unknown layout: hand back the raw decoded fields so nothing is lost.
    account = { fields: f };
    transaction = { amount: d.amount };
  }

  return { type, account, transaction, decoded: d };
}

module.exports = { decode, parseTLV, kshopParamsFrom, detach, detectType };
