'use strict';

/**
 * CRC16-CCITT (False) checksum — the standard used for Thai QR codes.
 *
 * Initial value 0xFFFF, polynomial 0x1021, no final XOR.
 * Port of the PHP `crc16_ccitt` implementation.
 *
 * @param {string} data Input string (treated as Latin-1 / single-byte chars).
 * @returns {number} The CRC16 checksum (0..0xFFFF).
 */
function crc16Ccitt(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff; // keep it 16-bit (JS uses 32-bit bitwise ops)
    }
  }
  return crc & 0xffff;
}

/**
 * CRC as the uppercase 4-char hex string appended to QR payloads.
 * @param {string} data
 * @returns {string}
 */
function crc16Hex(data) {
  return crc16Ccitt(data).toString(16).toUpperCase().padStart(4, '0');
}

module.exports = { crc16Ccitt, crc16Hex };
