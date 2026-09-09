import { commandInput } from './command-input.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Deterministic model boundary; the installed Harness owns the actual loop, history and tools. */
export function createModelFixture(ctx) {
  const runs = new Map()
  let registered = false
  let sequence = 0
  class Adapter extends LlmAdapter {
    async listModels() { return [{ id: 'document-fixture', name: 'Document acceptance fixture' }] }
    async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } }
    async *stream(options) {
      if (options.purpose) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Document acceptance' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Document acceptance' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const run = runs.get(options.sessionId)
      try {
        assert.ok(run, 'the fixture accepts only explicitly admitted test conversations')
        options.signal?.throwIfAborted()
        if (run.seed) {
          run.complete = true
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Ready to edit the document.' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Ready to edit the document.' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const snapshot = options.messages.findLast((message) => message.source.kind === 'plugin' &&
          message.source.plugin === '@deepseek-ai/dsh-system-prompt')
        const cores = snapshot?.source.sections?.filter((section) => section.name === 'tylina') ?? []
        const tools = options.tools.filter((tool) => tool.name === 'tylina' || tool.name.startsWith('tylina_'))
        run.requests.push({ instructions: cores.length, tools: tools.length })
        assert.equal(cores.length, 1, 'the current runtime snapshot contains one Tylina authoring contract')
        assert.ok(cores[0].text.includes('one tool named `tylina`'))
        assert.deepEqual(tools.map((tool) => tool.name), ['tylina'])
        let prior
        if (run.lastCall) {
          prior = options.messages.flatMap((message) => message.content)
            .find((block) => block.type === 'tool-result' && block.toolCallId === run.lastCall)
          assert.ok(prior, 'the next model request contains the actual tool receipt')
          assert.ok(!prior.isError, JSON.stringify(prior.content))
        }
        const value = () => JSON.parse(prior.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'))
        let name, input
        switch (run.step++) {
          case 0: name = 'tylina_workspace_info'; input = {}; break
          case 1:
            run.file = join(value().root, 'Plugin.typ')
            name = 'read'; input = { file_path: run.file }; break
          case 2:
            // The Harness read receipt is line-numbered text; editing a unique literal
            // does not require reconstructing the file or carrying a model-facing hash.
            assert.ok(prior.content.some(block => block.type === 'text' && block.text.includes('External Harness edit')))
            name = 'edit'; input = { file_path: run.file,
              old_string: 'External Harness edit', new_string: `External Harness edit\r\n${run.marker}` }; break
          case 3: name = 'tylina_validate_document'; input = {}; break
          case 4:
            assert.equal(value().valid, true)
            name = 'tylina_export_document'; input = { format: 'pdf', destination: 'output/Agent.pdf', overwrite: true }; break
          case 5:
            assert.deepEqual(value().paths, ['output/Agent.pdf'])
            name = 'tylina_render_page'; input = { page: 1 }; break
          default:
            assert.ok(prior.content.some((block) => block.type === 'image' && block.attachment?.attachmentId))
            run.complete = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: 'The document was edited, validated, exported and rendered.' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: 'The document was edited, validated, exported and rendered.' } }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
        }
        run.lastCall = `tylina-model-${++sequence}`
        const request = commandInput(name, input)
        name = request.name; input = request.arguments
        const args = JSON.stringify(input)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: run.lastCall, name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: run.lastCall, name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } catch (error) { if (run) run.error = error.message; throw error }
    }
  }
  return {
    begin(sessionId, marker, { seed = false } = {}) {
      if (!registered) { ctx.llm.registerAdapter(['tylina-acceptance'], new Adapter()); registered = true }
      if (runs.get(sessionId)?.complete === false) throw new Error('The prior fixture turn is still running')
      runs.set(sessionId, { marker, seed, step: 0, requests: [], complete: false })
    },
    read(sessionId) { return runs.get(sessionId) ?? null }
  }
}
