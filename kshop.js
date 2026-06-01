'use strict';

const { crc16Hex } = require('./crc');
const { poiMethod } = require('./promptpay');

// ---- Public PromptPay Application IDs (not account-specific) ----
const AID_MERCHANT_PRESENTED = 'A000000677010111'; // credit transfer -> tag 29 (BOT)
const AID_DOMESTIC = 'A000000677010112'; // bill payment, domestic -> tag 30 (BOT)
const AID_CUSTOMER_PRESENTED = 'A000000677010114'; // credit transfer, customer-presented (BOT)
// Tag 31 (Payment Innovation) AID. The Bank of Thailand guideline documents
// `A000000677012004`; KBank/KShop QRs in the wild use `A000000677010113`. The
// KShop value is the default so real KShop QRs round-trip; pass
// `innovationAid` to override (e.g. AID_PAYMENT_INNOVATION_BOT).
const AID_PAYMENT_INNOVATION = 'A000000677010113'; // tag 31 — KBank/KShop (vendor)
const AID_PAYMENT_INNOVATION_BOT = 'A000000677012004'; // tag 31 — BOT guideline
const CURRENCY_THB = '764';
const COUNTRY_CODE = 'TH';

/**
 * Build an EMVCo TLV field, mirroring the PHP `buildTagPayload`.
 *
 * - Array form (single positional value): `['value']` -> `id + len + value`.
 * - Object form (sub-tags): `{ '00': v, '01': v }` -> nested sub-TLVs wrapped
 *   in the outer `id + len`.
 *
 * @param {string} tagId
 * @param {string[]|Object<string,string>} data
 * @returns {string}
 */
function buildTagPayload(tagId, data) {
  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    if (data.length === 1) {
      const v = data[0];
      return tagId + String(v.length).padStart(2, '0') + v;
    }
    // Multiple positional values are not used by the PHP; treat as concat.
    data = Object.assign({}, data);
  }

  const entries = Object.entries(data);
  if (entries.length === 0) return '';

  let inner = '';
  for (const [subTagId, v] of entries) {
    inner += subTagId + String(v.length).padStart(2, '0') + v;
  }
  return tagId + String(inner.length).padStart(2, '0') + inner;
}

/**
 * Format amount as a fixed 2-decimal string (PHP number_format equivalent).
 * @param {number|string} amount
 * @returns {string}
 */
function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

// Universal, non-identifying defaults only. All account-specific values must be
// supplied by the caller (see required fields in generateKShopQR).
const KSHOP_DEFAULTS = {
  // Point of initiation (tag 01) uses the shared poiMethod rule: the `dynamic`
  // flag wins, else amount-driven. KShop defaults `dynamic` to FALSE (static,
  // POI '11') for maximum bank-app compatibility — notably K PLUS rejects
  // dynamic (POI '12') for this merchant QR family, while static-with-amount
  // works in K PLUS, KShop, SCB, KTB, BBL and UOB. Pass dynamic:true to force
  // POI '12' when targeting apps that accept it.
  dynamic: false,
  innovationAid: AID_PAYMENT_INNOVATION, // tag 31 / 00 (KShop default; see AID_PAYMENT_INNOVATION_BOT)
  innovationSubId: '004', // tag 31 / 01 (network sub-id used by the KShop format)
  currency: CURRENCY_THB, // tag 53
  countryCode: COUNTRY_CODE, // tag 58
};

// Account-identifying fields the caller MUST provide.
const REQUIRED_FIELDS = ['billerId', 'merchantRef', 'merchantName', 'merchantCity'];

/**
 * Generate a KShop-format PromptPay merchant QR payload (Tag 30 + Tag 31).
 *
 * All account-identifying values must be supplied via `config` — this library
 * ships no merchant data. Card-scheme templates (tags 02/04/15/51), MCC (52)
 * and the additional-data block (62) are optional and only emitted when given.
 *
 * @param {number} amount    Transaction amount in THB.
 * @param {string} reference Per-order reference (tag 30/03 and tag 31/04).
 * @param {object} config
 * @param {string} config.billerId       Bank-issued Biller ID (required).
 * @param {string} config.merchantRef    Bank merchant reference, e.g. "KB..." (required).
 * @param {string} config.merchantName   Merchant name, tag 59 (required).
 * @param {string} config.merchantCity   Merchant city, tag 60 (required).
 * @param {boolean} [config.dynamic]     tag 01: force true='12' / false='11'.
 *                                        Auto if omitted (dynamic when amount present).
 * @param {string} [config.innovationAid]   tag 31/00 AID. Default is the
 *                                           KBank/KShop value; pass
 *                                           `AID_PAYMENT_INNOVATION_BOT` for the
 *                                           Bank of Thailand-documented AID.
 * @param {string} [config.innovationSubId] tag 31/01 (default '004').
 * @param {string} [config.currency]     tag 53 (default '764' THB).
 * @param {string} [config.countryCode]  tag 58 (default 'TH').
 * @param {string} [config.visaTemplate]       tag 02 (optional).
 * @param {string} [config.mastercardTemplate] tag 04 (optional).
 * @param {string} [config.unionpayTemplate]   tag 15 (optional).
 * @param {Object<string,string>} [config.cardScheme] tag 51 sub-tags (optional).
 * @param {string} [config.mcc]          tag 52 merchant category code (optional).
 * @param {string} [config.additionalData] tag 62 raw value (optional).
 * @returns {string} The EMVCo QR payload including CRC.
 */
function generateKShopQR(amount, reference, config = {}) {
  const cfg = Object.assign({}, KSHOP_DEFAULTS, config);

  const missing = REQUIRED_FIELDS.filter((k) => cfg[k] == null || cfg[k] === '');
  if (missing.length) {
    throw new Error('generateKShopQR: missing required config field(s): ' + missing.join(', '));
  }
  if (reference == null || reference === '') {
    throw new Error('generateKShopQR: reference is required');
  }

  const hasAmount = amount != null && amount !== '';

  let payload = '';
  payload += buildTagPayload('00', ['01']);
  payload += buildTagPayload('01', [poiMethod(cfg.dynamic, hasAmount)]);
  if (cfg.visaTemplate) payload += buildTagPayload('02', [cfg.visaTemplate]);
  if (cfg.mastercardTemplate) payload += buildTagPayload('04', [cfg.mastercardTemplate]);
  if (cfg.unionpayTemplate) payload += buildTagPayload('15', [cfg.unionpayTemplate]);
  payload += buildTagPayload('30', {
    '00': AID_DOMESTIC,
    '01': cfg.billerId,
    '02': cfg.merchantRef,
    '03': reference,
  });
  payload += buildTagPayload('31', {
    '00': cfg.innovationAid,
    '01': cfg.innovationSubId,
    '02': cfg.merchantRef,
    '04': reference,
  });
  if (cfg.cardScheme && Object.keys(cfg.cardScheme).length) {
    payload += buildTagPayload('51', cfg.cardScheme);
  }
  if (cfg.mcc) payload += buildTagPayload('52', [cfg.mcc]);
  payload += buildTagPayload('53', [cfg.currency]);
  // Tag 54 (amount) only when an amount is supplied — a no-amount KShop QR is a
  // valid static "payer enters amount" master.
  if (hasAmount) payload += buildTagPayload('54', [formatAmount(amount)]);
  payload += buildTagPayload('58', [cfg.countryCode]);
  payload += buildTagPayload('59', [cfg.merchantName]);
  payload += buildTagPayload('60', [cfg.merchantCity]);
  if (cfg.additionalData) payload += buildTagPayload('62', [cfg.additionalData]);

  // CRC tag 63 over payload + '6304', appended.
  payload += buildTagPayload('63', [crc16Hex(payload + '6304')]);
  return payload;
}

module.exports = {
  generateKShopQR,
  buildTagPayload,
  KSHOP_DEFAULTS,
  REQUIRED_FIELDS,
  // AIDs exported for callers who want to override tag 31 (e.g. BOT vs KShop).
  AID_PAYMENT_INNOVATION,
  AID_PAYMENT_INNOVATION_BOT,
  constants: {
    AID_MERCHANT_PRESENTED,
    AID_DOMESTIC,
    AID_PAYMENT_INNOVATION,
    AID_PAYMENT_INNOVATION_BOT,
    AID_CUSTOMER_PRESENTED,
    CURRENCY_THB,
    COUNTRY_CODE,
  },
};
