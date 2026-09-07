import { fileURLToPath } from 'node:url'
export const root = fileURLToPath(new URL('./', import.meta.url))
export const sourceRoot = fileURLToPath(new URL('./.tylina/', import.meta.url))
