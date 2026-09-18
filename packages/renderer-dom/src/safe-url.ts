export function safeURL(value: unknown, image = false): string {
  if (typeof value !== 'string') return '';

  const source = value.trim();
  const normalized = [...source]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join('');

  if (!normalized) return '';
  if (image && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(normalized)) return source;
  if (/^(?:https?:|mailto:|tel:)/i.test(normalized)) return source;
  if (/^[A-Za-z][\w+.-]*:/.test(normalized) || normalized.startsWith('//') || normalized.startsWith('\\')) return '';
  return source;
}
