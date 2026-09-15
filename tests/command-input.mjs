import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TYLINA_COMMANDS as installedCommands } from '../plugin/node_modules/tylina-sdk/dist/tools.js'

const TYLINA_COMMANDS = process.env.TYLINA_DSH_SDK
  ? (await import(pathToFileURL(join(resolve(process.env.TYLINA_DSH_SDK), 'dist/tools.js')).href)).TYLINA_COMMANDS
  : installedCommands

export function commandInput(name, args = {}) {
  if (name === 'tylina') return { name, arguments: args }
  const command = Object.entries(TYLINA_COMMANDS).find(([, operation]) => operation === name)?.[0]
  if (!command) return { name, arguments: args }
  return { name: 'tylina', arguments: { command, args } }
}
