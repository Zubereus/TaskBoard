const TAG_COLORS = ['rose', 'emerald', 'blue', 'amber']

export function tagColorFor(text, existingColor) {
  if (TAG_COLORS.includes(existingColor)) return existingColor
  const label = String(text || '').trim().toLocaleLowerCase()
  let hash = 0
  for (const character of label) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0
  }
  return TAG_COLORS[hash % TAG_COLORS.length]
}
