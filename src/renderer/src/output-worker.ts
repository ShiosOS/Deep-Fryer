import { prepareOutput, type OutputJob, type OutputResponse } from './output'

self.onmessage = async (event: MessageEvent<OutputJob>): Promise<void> => {
  try {
    const output = await prepareOutput(event.data)
    const response: OutputResponse = { kind: 'ready', output }
    self.postMessage(response, { transfer: [output.bytes.buffer, output.pixels.buffer] })
  } catch (error) {
    const response: OutputResponse = { kind: 'failed', message: error instanceof Error ? error.message : 'The output could not be prepared. Try again.' }
    self.postMessage(response)
  }
}
