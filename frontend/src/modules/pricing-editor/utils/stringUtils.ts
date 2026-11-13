export function camelToTitle(str: string) {
  if (str === str.toUpperCase()) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .replace(/_/g, ' ');
}
