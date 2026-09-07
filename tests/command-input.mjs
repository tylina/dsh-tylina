import { TYLINA_COMMANDS } from '../plugin/node_modules/tylina-sdk/dist/tools.js'
export function commandInput(name, args = {}) {
  if (name === 'tylina') return { name, arguments: args }
  const command = Object.entries(TYLINA_COMMANDS).find(([, operation]) => operation === name)?.[0]
  if (!command) return { name, arguments: args }
  return { name: 'tylina', arguments: { command, args } }
}
