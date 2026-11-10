export function formatOverdueAge(totalMinutes) {
  const minutes = Math.max(0, Math.floor(Number(totalMinutes) || 0))
  if (minutes < 1) return 'vừa quá hạn'
  if (minutes < 60) return `quá hạn ${minutes} phút`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `quá hạn ${hours} giờ`
  return `quá hạn ${Math.floor(hours / 24)} ngày`
}
