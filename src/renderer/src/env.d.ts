import type { ImageBridge } from '../../shared/image'
import type { DocumentBridge } from '../../shared/documents'

declare global {
  const __APP_VERSION__: string
  interface Window { imageBridge: ImageBridge; documentBridge: DocumentBridge }
}
