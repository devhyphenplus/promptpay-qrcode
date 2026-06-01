'use strict';

const { crc16Ccitt, crc16Hex } = require('./crc');
const { generatePromptPay, generateBillPayment, formatMobile } = require('./promptpay');
const { generateKShopQR, KSHOP_DEFAULTS, AID_PAYMENT_INNOVATION, AID_PAYMENT_INNOVATION_BOT } = require('./kshop');
const { decode, parseTLV, kshopParamsFrom, detach, detectType } = require('./decode');
const image = require('./image');

module.exports = {
  crc16Ccitt,
  crc16Hex,
  generatePromptPay,
  generateBillPayment,
  formatMobile,
  generateKShopQR,
  KSHOP_DEFAULTS,
  AID_PAYMENT_INNOVATION, // tag 31 AID — KBank/KShop (default)
  AID_PAYMENT_INNOVATION_BOT, // tag 31 AID — Bank of Thailand guideline
  // Decoding / parsing.
  decode,
  parseTLV,
  kshopParamsFrom,
  detach,
  detectType,
  // Optional image helpers (require the `qrcode` package).
  image,
  toFile: image.toFile,
  toDataURL: image.toDataURL,
  toBuffer: image.toBuffer,
  toSVG: image.toSVG,
  toTerminal: image.toTerminal,
};
