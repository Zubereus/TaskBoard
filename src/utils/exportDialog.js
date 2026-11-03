export function isGroupByMemberDisabled(scope) {
  return scope === 'personal'
}

export function groupByMemberForScope(scope, enabled) {
  return isGroupByMemberDisabled(scope) ? false : enabled
}

export function exportButtonDisabled(count, exporting, counting) {
  return exporting || counting || count === 0
}
