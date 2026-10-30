// Image pipeline: every upload becomes a set of WebP variants under /uploads/<key>/<width>.webp.
// Covers are cropped to 3:2 (the card and the story page use that ratio), avatars to 1:1.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads'));
const COVER_WIDTHS = [400, 640, 860, 1280];
const AVATAR_WIDTHS = [96, 256];
const PLACEHOLDER = '/images/placeholderImage.webp';
const MAX_INPUT_PIXELS = 60e6;

sharp.cache(false);

async function writeVariants(buffer, kind, id) {
  const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!meta.width || !meta.height) throw new Error('Not an image');
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const key = `${kind}/${id}-${hash}`;
  const dir = path.join(UPLOADS, key);
  fs.mkdirSync(dir, { recursive: true });
  const widths = kind === 'avatars' ? AVATAR_WIDTHS : COVER_WIDTHS;
  for (const w of widths) {
    const h = kind === 'avatars' ? w : Math.round((w * 2) / 3);
    await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(w, h, { fit: 'cover', position: sharp.strategy.attention, withoutEnlargement: false })
      .webp({ quality: kind === 'avatars' ? 80 : 74, effort: 4 })
      .toFile(path.join(dir, `${w}.webp`));
  }
  if (kind === 'covers') {
    // Open Graph image: JPEG 1200x630 for social networks that ignore WebP.
    await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
      .resize(1200, 630, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(dir, 'og.jpg'));
  }
  return key;
}

/** Validate an uploaded buffer: real JPEG/PNG/WEBP, within the size limit. */
async function assertImage(buffer, maxBytes) {
  if (!buffer || !buffer.length) throw Object.assign(new Error('File is required'), { status: 400 });
  if (buffer.length > maxBytes) throw Object.assign(new Error(`File is larger than ${maxBytes} bytes`), { status: 400 });
  let meta;
  try { meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata(); } catch { meta = null; }
  if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
    throw Object.assign(new Error('Unsupported or corrupted image'), { status: 400 });
  }
  return meta;
}

const processCover = (buffer, id) => writeVariants(buffer, 'covers', id);
const processAvatar = (buffer, id) => writeVariants(buffer, 'avatars', id);

function removeKey(key) {
  if (!key) return;
  const dir = path.join(UPLOADS, key);
  if (dir.startsWith(UPLOADS)) fs.rmSync(dir, { recursive: true, force: true });
}

const variantUrl = (key, w) => `/uploads/${key}/${w}.webp`;

/** Image descriptor for templates: src, srcset, width, height. Falls back to the external URL or the placeholder. */
function coverImage(row) {
  if (row.cover_key) {
    return {
      src: variantUrl(row.cover_key, 640),
      srcset: COVER_WIDTHS.map((w) => `${variantUrl(row.cover_key, w)} ${w}w`).join(', '),
      large: variantUrl(row.cover_key, 1280),
      og: `/uploads/${row.cover_key}/og.jpg`,
      width: 640,
      height: 427,
      local: true,
    };
  }
  if (row.img) return { src: row.img, srcset: '', large: row.img, og: row.img, width: 640, height: 427, local: false };
  return { src: PLACEHOLDER, srcset: '', large: PLACEHOLDER, og: PLACEHOLDER, width: 640, height: 427, placeholder: true };
}

function avatarImage(row) {
  if (row.avatar_key) {
    return {
      src: variantUrl(row.avatar_key, 96),
      srcset: AVATAR_WIDTHS.map((w) => `${variantUrl(row.avatar_key, w)} ${w}w`).join(', '),
      large: variantUrl(row.avatar_key, 256),
    };
  }
  if (row.avatar_url) return { src: row.avatar_url, srcset: '', large: row.avatar_url };
  return { src: '/images/default-avatar.svg', srcset: '', large: '/images/default-avatar.svg', placeholder: true };
}

module.exports = {
  UPLOADS, COVER_WIDTHS, AVATAR_WIDTHS, PLACEHOLDER,
  assertImage, processCover, processAvatar, removeKey, coverImage, avatarImage, variantUrl,
};
