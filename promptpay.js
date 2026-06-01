'use strict';

const { crc16Hex } = require('./crc');

// Application IDs (AID) for PromptPay.
const AID_PERSON = 'A000000677010111'; // credit transfer (mobile, national id, ewallet) -> tag 29
const AID_BILLPAY = 'A000000677010112'; // bill payment (domestic biller) -> tag 30

const CURRENCY_THB = '764';
const COUNTRY_TH = 'TH';

/**
 * Build a single EMVCo TLV field: id (2) + length (2, zero-padded) + value.
 * @param {string} id Two-char tag id.
 * @param {string} value Field value.
 * @returns {string}
 */
function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * Resolve the Point of Initiation Method value (tag 01).
 *
 * Per EMVCo, '11' (static) = the same QR is shown for more than one
 * transaction; '12' (dynamic) = a new QR is shown for each transaction. This is
 * an intent marker only — the payload does not enforce single use, so a '12' QR
 * is still physically reusable; whether a repeat payment is accepted is up to
 * the bank back-end. An amount may appear under either value.
 *
 * `dynamic` overrides when set (`true` -> '12', `false` -> '11'). When left
 * undefined it defaults to dynamic if an amount is present, static otherwise.
 *
 * @param {boolean|undefined} dynamic Explicit override, or undefined to auto.
 * @param {boolean} hasAmount Whether the payload carries an amount.
 * @returns {'11'|'12'}
 */
function poiMethod(dynamic, hasAmount) {
  if (dynamic === undefined) return hasAmount ? '12' : '11';
  return dynamic ? '12' : '11';
}

/**
 * Format a Thai mobile number into the 13-char PromptPay proxy value.
 * e.g. "081-234-5678" -> "0066812345678"
 * @param {string} mobile
 * @returns {string}
 */
function formatMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '').replace(/^0/, '');
  return ('66' + digits).padStart(13, '0');
}

/**
 * Generate a standard PromptPay QR payload string.
 *
 * Provide exactly one of: mobile, nationalId, ewallet.
 * By default the QR is dynamic (POI '12') when `amount` is given and static
 * (POI '11') otherwise; pass `dynamic` to force either.
 *
 * @param {object} opts
 * @param {string} [opts.mobile]     Thai mobile number (any format).
 * @param {string} [opts.nationalId] 13-digit national ID / tax ID.
 * @param {string} [opts.ewallet]    15-digit e-Wallet ID.
 * @param {number} [opts.amount]     Optional amount in THB.
 * @param {boolean} [opts.dynamic]   Force POI: true='12', false='11'. Auto if omitted.
 * @returns {string} The EMVCo QR payload including CRC.
 */
function generatePromptPay({ mobile, nationalId, ewallet, amount, dynamic } = {}) {
  const provided = [mobile, nationalId, ewallet].filter((v) => v != null);
  if (provided.length !== 1) {
    throw new Error('Provide exactly one of: mobile, nationalId, ewallet');
  }

  let merchantField;
  if (mobile != null) {
    merchantField = tlv('01', formatMobile(mobile));
  } else if (nationalId != null) {
    merchantField = tlv('02', String(nationalId).replace(/\D/g, ''));
  } else {
    merchantField = tlv('03', String(ewallet).replace(/\D/g, ''));
  }

  const merchantAccount = tlv('00', AID_PERSON) + merchantField;
  const hasAmount = amount != null && amount !== '';

  let payload = '';
  payload += tlv('00', '01'); // payload format indicator
  payload += tlv('01', poiMethod(dynamic, hasAmount)); // dynamic vs static
  payload += tlv('29', merchantAccount); // PromptPay merchant account info
  payload += tlv('53', CURRENCY_THB);
  if (hasAmount) {
    payload += tlv('54', Number(amount).toFixed(2));
  }
  payload += tlv('58', COUNTRY_TH);

  payload += '6304' + crc16Hex(payload + '6304');
  return payload;
}

/**
 * Generate a PromptPay Bill Payment (Tag 30) QR payload string.
 *
 * This is the merchant "bill payment" QR family — the same shape SCB's
 * แม่มณี (Mae Manee) and other merchant QRs use. The payer's app shows the
 * merchant name (tag 59) rather than a person's name.
 *
 * @param {object} opts
 * @param {string} opts.billerId       Bank-issued Biller ID (usually 15 digits:
 *                                      13-digit tax ID + 2-digit suffix).
 * @param {string} opts.ref1           Reference 1 (mandatory, biller-defined).
 * @param {string} [opts.ref2]         Reference 2 (optional, biller-defined).
 * @param {number} [opts.amount]       Amount in THB. Present => dynamic by default.
 * @param {boolean} [opts.dynamic]     Force POI: true='12', false='11'. Auto if omitted.
 * @param {string} [opts.merchantName] Merchant name (tag 59).
 * @param {string} [opts.merchantCity] Merchant city (tag 60).
 * @returns {string} The EMVCo QR payload including CRC.
 */
function generateBillPayment({ billerId, ref1, ref2, amount, dynamic, merchantName, merchantCity } = {}) {
  if (!billerId) throw new Error('billerId is required');
  if (!ref1) throw new Error('ref1 is required');

  let merchantAccount = tlv('00', AID_BILLPAY) + tlv('01', String(billerId)) + tlv('02', String(ref1));
  if (ref2 != null && ref2 !== '') {
    merchantAccount += tlv('03', String(ref2));
  }

  const hasAmount = amount != null && amount !== '';

  let payload = '';
  payload += tlv('00', '01'); // payload format indicator
  payload += tlv('01', poiMethod(dynamic, hasAmount)); // dynamic vs static
  payload += tlv('30', merchantAccount); // bill payment merchant account info
  payload += tlv('53', CURRENCY_THB);
  if (hasAmount) {
    payload += tlv('54', Number(amount).toFixed(2));
  }
  payload += tlv('58', COUNTRY_TH);
  if (merchantName) payload += tlv('59', merchantName);
  if (merchantCity) payload += tlv('60', merchantCity);

  payload += '6304' + crc16Hex(payload + '6304');
  return payload;
}

module.exports = { generatePromptPay, generateBillPayment, formatMobile, tlv, poiMethod };
