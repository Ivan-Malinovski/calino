export function extractLocation(input: string): string | undefined {
  const patterns = [
    /\bat\s+([a-zA-Z][^onfor]+?)(?:\s+(?:on|for)\b|$)/i,
    /\b@\s*([a-zA-Z][a-zA-Z\s]+?)(?:\s+(?:on|for)\b|$)/i,
    /\bin\s+([a-zA-Z][^onfor]+?)(?:\s+(?:on|for)\b|$)/i,
    /\blocation\s*:\s*([a-zA-Z].+)$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      let location = match[1].trim();
      location = location.replace(/\s+/g, ' ').replace(/^[,\-\s]+|[,\-\s]+$/g, '');
      if (location.length >= 2) {
        return location;
      }
    }
  }

  const atTheMatch = input.match(/\bat\s+the\s+([a-zA-Z][a-zA-Z\s]+?)(?:\s+(?:on|for)\b|$)/i);
  if (atTheMatch && atTheMatch[1]) {
    const location = atTheMatch[1].trim().replace(/\s+/g, ' ');
    if (location.length >= 2) {
      return location;
    }
  }

  const simpleAtMatch = input.match(/\bat\s+([a-zA-Z][a-zA-Z\s]+)$/i);
  if (simpleAtMatch && simpleAtMatch[1]) {
    const location = simpleAtMatch[1].trim();
    if (location.length >= 2) {
      return location;
    }
  }

  return undefined;
}
