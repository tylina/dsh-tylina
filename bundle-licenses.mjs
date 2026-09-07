import { cp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Preserve notices for the dependencies actually embedded by esbuild, including SDK transitive code. */
export async function copyBundledLicenses(metafile, destination) {
  const directories = new Map(), packages = new Map()
  const owner = (directory) => {
    if (!directories.has(directory)) directories.set(directory, (async () => {
      const parent = dirname(directory)
      try {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (manifest.name) return { directory, manifest }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      return parent === directory ? undefined : owner(parent)
    })())
    return directories.get(directory)
  }
  for (const input of Object.keys(metafile.inputs)) {
    const entry = await owner(dirname(resolve(input)))
    if (entry && !entry.manifest.name.startsWith('@tylina/')) packages.set(entry.directory, entry)
  }
  const notices = []
  for (const { directory, manifest } of packages.values()) {
    const licenses = []
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const name = file.name.toLowerCase()
      if (!file.isFile() || !(name.startsWith('license') || name.startsWith('licence') || name.startsWith('copying'))) continue
      const target = `${encodeURIComponent(manifest.name)}@${manifest.version}-${file.name}`
      await cp(join(directory, file.name), join(destination, target)); licenses.push(target)
    }
    notices.push({ name: manifest.name, version: manifest.version, license: manifest.license, notices: licenses })
  }
  await writeFile(join(destination, 'dependencies.json'), JSON.stringify(notices.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n')
}
