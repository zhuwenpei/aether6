export function parseCoords(input: string): { lat: number; lon: number } | null {
  if (!input || typeof input !== 'string') return null;

  // Normalize fullwidth punctuation, unicode quote/prime/degree symbols and Chinese cardinal directions
  const cleanInput = input
    .trim()
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/[′′’‘`´ʻ]/g, "'")
    .replace(/[″””"]/g, '"')
    .replace(/[°º]/g, '°')
    .replace(/北纬/g, 'N')
    .replace(/南纬/g, 'S')
    .replace(/东经/g, 'E')
    .replace(/西经/g, 'W')
    .replace(/北(?=\d)/g, 'N')
    .replace(/南(?=\d)/g, 'S')
    .replace(/东(?=\d)/g, 'E')
    .replace(/西(?=\d)/g, 'W');

  if (!cleanInput) return null;

  // Helper to parse a single coordinate string like "30°54.60'N", "121°43.25'E", "30.91N", "30.91", "-121.72"
  const parsePart = (str: string): { value: number; dir?: 'N' | 'S' | 'E' | 'W' } | null => {
    const s = str.trim().toUpperCase();
    if (!s) return null;

    // Detect direction letter N/S/E/W
    let dir: 'N' | 'S' | 'E' | 'W' | undefined = undefined;
    const dirMatch = s.match(/([NSEW])/);
    if (dirMatch) {
      dir = dirMatch[1] as 'N' | 'S' | 'E' | 'W';
    }

    // Extract all floating point numbers from string
    const numbers = s.match(/[-+]?\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length === 0) return null;

    const deg = Math.abs(parseFloat(numbers[0]));
    const min = numbers.length > 1 ? Math.abs(parseFloat(numbers[1])) : 0;
    const sec = numbers.length > 2 ? Math.abs(parseFloat(numbers[2])) : 0;

    if (isNaN(deg) || isNaN(min) || isNaN(sec)) return null;

    let val = deg + min / 60 + sec / 3600;

    // Check if the first number itself was negative
    if (parseFloat(numbers[0]) < 0) {
      val = -val;
    }

    // Apply directional sign override if N/S/E/W present
    if (dir === 'S' || dir === 'W') {
      val = -Math.abs(val);
    } else if (dir === 'N' || dir === 'E') {
      val = Math.abs(val);
    }

    return { value: val, dir };
  };

  // Split into 2 parts by comma or space
  let rawParts: string[] = [];
  if (cleanInput.includes(',')) {
    rawParts = cleanInput.split(',').map((p) => p.trim()).filter(Boolean);
  } else {
    // Try splitting between N/S/E/W and the following digit/letter
    const regexSplit = cleanInput.match(/^(.+?[NSEWnsew])\s+([+-]?\d+.+)$/);
    if (regexSplit) {
      rawParts = [regexSplit[1], regexSplit[2]];
    } else {
      rawParts = cleanInput.split(/\s+/).filter(Boolean);
    }
  }

  if (rawParts.length >= 2) {
    const p1 = parsePart(rawParts[0]);
    const p2 = parsePart(rawParts[1]);

    if (p1 && p2) {
      let lat: number | null = null;
      let lon: number | null = null;

      // Determine lat/lon based on N/S or E/W tags if present
      if (p1.dir && ['N', 'S'].includes(p1.dir)) lat = p1.value;
      if (p1.dir && ['E', 'W'].includes(p1.dir)) lon = p1.value;

      if (p2.dir && ['N', 'S'].includes(p2.dir)) lat = p2.value;
      if (p2.dir && ['E', 'W'].includes(p2.dir)) lon = p2.value;

      // Fallback if no tags provided (e.g., "30.91, 121.72")
      if (lat === null && lon === null) {
        lat = p1.value;
        lon = p2.value;
      } else if (lat === null && lon !== null) {
        lat = p1.value;
      } else if (lon === null && lat !== null) {
        lon = p2.value;
      }

      if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
        lat = Math.max(-90, Math.min(90, lat));
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        return { lat, lon };
      }
    }
  }

  return null;
}
