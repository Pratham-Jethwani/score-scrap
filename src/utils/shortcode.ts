const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Converts a numeric Instagram Media ID into a shortcode
 */
export function mediaIdToShortcode(mediaId: bigint | number | string): string {
  let id = BigInt(mediaId);
  if (id === 0n) return '';
  
  let shortcode = '';
  const alphabetLen = BigInt(BASE64_ALPHABET.length);

  while (id > 0n) {
    const remainder = Number(id % alphabetLen);
    id = id / alphabetLen;
    shortcode = BASE64_ALPHABET[remainder] + shortcode;
  }

  return shortcode;
}

/**
 * Extracts numeric Media ID from an Instagram image URL `ig_cache_key` query param
 * Format in URL is often URL-encoded base64: e.g. `NDAwNjM3NzYwNjE4MTE1OTk2Ng%3D%3D.3-ccb7-5`
 */
export function extractShortcodeFromImageUrl(imageUrl: string): string | null {
  try {
    const match = imageUrl.match(/ig_cache_key=([^&.]+)/);
    if (!match || !match[1]) return null;

    const decodedParam = decodeURIComponent(match[1]);
    // The decoded param is base64 encoded string representing the decimal media id
    const decodedDecimalStr = Buffer.from(decodedParam, 'base64').toString('utf-8');
    if (/^\d+$/.test(decodedDecimalStr)) {
      return mediaIdToShortcode(decodedDecimalStr);
    }
  } catch {
    // If decoding fails, return null
  }
  return null;
}

/**
 * Parses numbers with suffixes like '564K', '17M', '8,620' into integer
 */
export function parseCompactNumber(input: string | number | undefined | null): number {
  if (typeof input === 'number') return input;
  if (!input) return 0;

  const clean = input.toString().replace(/,/g, '').trim().toUpperCase();
  const match = clean.match(/^([\d.]+)\s*([KMB])?$/);
  if (!match) {
    const digitsOnly = clean.replace(/[^\d]/g, '');
    return digitsOnly ? parseInt(digitsOnly, 10) : 0;
  }

  const base = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === 'K') return Math.round(base * 1000);
  if (suffix === 'M') return Math.round(base * 1000000);
  if (suffix === 'B') return Math.round(base * 1000000000);

  return Math.round(base);
}
