// Deterministic gzipped-tar writer.
//
// The archive is part of the release contract, so it has to be reproducible on
// any host. Host `tar` implementations disagree on flags, ordering, ownership
// and timestamps (GNU tar accepts `--mtime`/`--mode`, bsdtar does not), which
// makes "build it twice, compare the digest" fail for reasons that have nothing
// to do with the specification. Writing the ustar container here removes that
// dependency: every header field is fixed by this file, so the same inputs
// produce the same bytes on macOS, Linux, and CI.

import { gzipSync } from 'node:zlib';
import { fail } from './core.mjs';

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;

/** Earliest timestamp representable in the ustar/gzip formats. */
const FIXED_MTIME_SECONDS = 0;
const FIXED_MODE = 0o644;
const FIXED_UID = 0;
const FIXED_GID = 0;
const FIXED_UNAME = 'root';
const FIXED_GNAME = 'root';

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) fail('TAR_FIELD', `field value ${JSON.stringify(value)} exceeds ${length} bytes`);
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0');
  if (text.length > length - 1) fail('TAR_FIELD', `octal value ${value} does not fit in ${length - 1} digits`);
  header.write(text, offset, 'ascii');
  header[offset + length - 1] = 0;
}

function splitName(entryPath) {
  const bytes = Buffer.from(entryPath, 'utf8');
  if (bytes.length <= NAME_MAX) return { name: entryPath, prefix: '' };
  const slash = entryPath.lastIndexOf('/');
  if (slash === -1) fail('TAR_NAME', `archive entry path is too long for ustar: ${entryPath}`);
  const prefix = entryPath.slice(0, slash);
  const name = entryPath.slice(slash + 1);
  if (Buffer.byteLength(prefix, 'utf8') > PREFIX_MAX || Buffer.byteLength(name, 'utf8') > NAME_MAX) {
    fail('TAR_NAME', `archive entry path cannot be represented in ustar: ${entryPath}`);
  }
  return { name, prefix };
}

/** Directories whose entries are never part of a published package. */
const UNPACKED_DIRECTORIES = ['.git', 'node_modules', '.docpact'];

function headerFor(entryPath, size) {
  const header = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitName(entryPath);
  writeString(header, 0, NAME_MAX, name);
  writeOctal(header, 100, 8, FIXED_MODE);
  writeOctal(header, 108, 8, FIXED_UID);
  writeOctal(header, 116, 8, FIXED_GID);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, FIXED_MTIME_SECONDS);
  // The checksum field is filled with spaces while the checksum is computed.
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0); // typeflag: regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, FIXED_UNAME);
  writeString(header, 297, 32, FIXED_GNAME);
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, PREFIX_MAX, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0');
  header.write(checksumText, 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

/**
 * Parse a ustar archive into its entries.
 *
 * Entry names are validated against traversal before they are returned, and
 * non-regular entries (symlinks, devices) are refused: an archive that can place
 * a symbolic link is not a set of files, and the release archive contract is
 * about files.
 *
 * @param {Buffer} tar Uncompressed tar bytes.
 * @returns {{entry: string, content: Buffer}[]}
 */
export function readTarEntries(tar) {
  const entries = [];
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += BLOCK;
      if (zeroBlocks === 2) break;
      continue;
    }
    zeroBlocks = 0;
    const name = readCString(header, 0, NAME_MAX);
    const prefix = readCString(header, 345, PREFIX_MAX);
    const size = Number.parseInt(readCString(header, 124, 12).trim() || '0', 8);
    const typeflag = String.fromCharCode(header[156]);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (path.startsWith('/') || path.split('/').includes('..')) {
      fail('TAR_PATH', `archive entry escapes the archive root: ${path}`);
    }
    if (typeflag !== '0' && typeflag !== '\0') {
      fail('TAR_ENTRY_TYPE', `archive entry ${path} is not a regular file (typeflag ${JSON.stringify(typeflag)})`);
    }
    offset += BLOCK;
    entries.push({ entry: path, content: tar.subarray(offset, offset + size) });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

function readCString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

/**
 * Build a gzipped tar from an explicit ordered entry list.
 *
 * @param {{entry: string, content: Buffer}[]} entries Sorted by `entry`.
 * @returns {Buffer}
 */
export function createDeterministicTarGz(entries) {
  const chunks = [];
  const sorted = [...entries].sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  for (const item of sorted) {
    if (item.entry.startsWith('/') || item.entry.split('/').includes('..')) {
      fail('TAR_NAME', `archive entry must be a relative path inside the archive: ${item.entry}`);
    }
    chunks.push(headerFor(item.entry, item.content.length));
    chunks.push(item.content);
    const remainder = item.content.length % BLOCK;
    if (remainder !== 0) chunks.push(Buffer.alloc(BLOCK - remainder, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  const tar = Buffer.concat(chunks);
  // mtime and OS byte in the gzip header are fixed by Node's defaults (0 and
  // 0xff), so two runs over the same input produce identical bytes.
  return gzipSync(tar, { level: 9 });
}
