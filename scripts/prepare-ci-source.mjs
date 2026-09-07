import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from '../source.mjs'

const { TYLINA_SOURCE_SSH_KEY: key, ...environment } = process.env
if (!key) throw new Error('Configure TYLINA_SOURCE_SSH_KEY with read-only access to the pinned private Tylina core.')
const repository = JSON.parse(readFileSync(join(root, 'tylina-source.json'), 'utf8')).repository
const url = new URL(repository)
if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== '/OrangeX4/tylina.git') {
  throw new Error('The CI deploy key is scoped to OrangeX4/tylina only.')
}
const temporary = await mkdtemp(join(tmpdir(), 'dsh-tylina-source-'))
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
try {
  const identity = join(temporary, 'identity'), hosts = join(temporary, 'known_hosts')
  await writeFile(identity, key.trimEnd() + '\n', { mode: 0o600 })
  // Obtain GitHub's published host keys over verified HTTPS; never accept an unknown SSH host key.
  const response = await fetch('https://api.github.com/meta', { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GitHub host-key metadata: HTTP ${response.status}`)
  const { ssh_keys: keys } = await response.json()
  if (!Array.isArray(keys) || !keys.length || keys.some((item) => typeof item !== 'string' || item.includes('\n'))) {
    throw new Error('Invalid GitHub host-key metadata')
  }
  await writeFile(hosts, keys.map((item) => `github.com ${item}`).join('\n') + '\n', { mode: 0o600 })
  const result = spawnSync(process.execPath, ['scripts/prepare-source.mjs'], {
    cwd: root, stdio: 'inherit', env: { ...environment,
      GIT_SSH_COMMAND: `ssh -i ${quote(identity)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(hosts)}`,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.ssh://git@github.com/OrangeX4/tylina.git.insteadOf',
      GIT_CONFIG_VALUE_0: repository
    }
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Source preparation exited with ${result.status}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
