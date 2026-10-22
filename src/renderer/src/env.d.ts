import type { ImageBridge } from '../../shared/image'

declare global {
  interface Window { imageBridge: ImageBridge }
}
