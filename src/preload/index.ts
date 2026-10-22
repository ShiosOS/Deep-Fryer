import { contextBridge, ipcRenderer } from 'electron'
import { exportPngResult, openImageResult, type ImageBridge } from '../shared/image'

const bridge: ImageBridge = {
  openImage: async () => openImageResult.parse(await ipcRenderer.invoke('image:open')),
  exportPng: async (bytes, suggestedName) =>
    exportPngResult.parse(await ipcRenderer.invoke('image:export-png', bytes, suggestedName))
}

contextBridge.exposeInMainWorld('imageBridge', bridge)
