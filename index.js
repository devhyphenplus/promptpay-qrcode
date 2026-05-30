'use strict';

const { crc16Ccitt, crc16Hex } = require('./crc');
const { generatePromptPay, generateBillPayment, formatMobile } = require('./promptpay');
const { generateKShopQR, KSHOP_DEFAULTS } = require('./kshop');
const { decode, parseTLV, kshopParamsFrom } = require('./decode');
const image = require('./image');

module.exports = {
  crc16Ccitt,
  crc16Hex,
  generatePromptPay,
  generateBillPayment,
  formatMobile,
  generateKShopQR,
  KSHOP_DEFAULTS,
  // Decoding / parsing.
  decode,
  parseTLV,
  kshopParamsFrom,
  // Optional image helpers (require the `qrcode` package).
  image,
  toFile: image.toFile,
  toDataURL: image.toDataURL,
  toBuffer: image.toBuffer,
  toSVG: image.toSVG,
  toTerminal: image.toTerminal,
};
