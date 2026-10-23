import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { openImageResult, type ImageBridge } from '../shared/image'
import { exportImageInput, exportImageResult } from '../shared/output'
import { editableDocumentSchema, recoveryOfferSchema, type DocumentBridge } from '../shared/documents'
import { presetSchema } from '../shared/preset'
import { appearanceSchema, appearanceResultSchema, type AppearanceBridge } from '../shared/appearance'

const bridge: ImageBridge = {
  openImage: async () => openImageResult.parse(await ipcRenderer.invoke('image:open')),
  pasteImage: async () => openImageResult.unwrap().parse(await ipcRenderer.invoke('image:paste')),
  dropImages: async (files) => openImageResult.unwrap().parse(await ipcRenderer.invoke('image:drop', files.map((file) => webUtils.getPathForFile(file)))),
  exportImage: async (input) =>
    exportImageResult.parse(await ipcRenderer.invoke('image:export', exportImageInput.parse(input)))
}

contextBridge.exposeInMainWorld('imageBridge', bridge)

const documents: DocumentBridge = {
  openProject: async () => editableDocumentSchema.nullable().parse(await ipcRenderer.invoke('document:open-project')),
  saveProject: async (input) => exportImageResult.parse(await ipcRenderer.invoke('document:save-project', input)),
  openPreset: async () => presetSchema.nullable().parse(await ipcRenderer.invoke('document:open-preset')),
  savePreset: async (input) => exportImageResult.parse(await ipcRenderer.invoke('document:save-preset', input)),
  recoveryOffer: async () => recoveryOfferSchema.parse(await ipcRenderer.invoke('recovery:offer')),
  restoreRecovery: async () => editableDocumentSchema.parse(await ipcRenderer.invoke('recovery:restore')),
  discardRecovery: async () => { await ipcRenderer.invoke('recovery:discard') },
  checkpoint: async (document) => { await ipcRenderer.invoke('recovery:checkpoint', document) }
}
contextBridge.exposeInMainWorld('documentBridge', documents)

const appearance: AppearanceBridge = {
  load: async () => appearanceResultSchema.parse(await ipcRenderer.invoke('appearance:load')),
  save: async (input) => appearanceSchema.parse(await ipcRenderer.invoke('appearance:save', appearanceSchema.parse(input))),
  reset: async () => appearanceSchema.parse(await ipcRenderer.invoke('appearance:reset'))
}
contextBridge.exposeInMainWorld('appearanceBridge', appearance)
