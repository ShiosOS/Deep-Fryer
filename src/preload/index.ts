import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { exportPngResult, openImageResult, type ImageBridge } from '../shared/image'
import { editableDocumentSchema, recoveryOfferSchema, type DocumentBridge } from '../shared/documents'
import { recipeSchema } from '../shared/recipe'

const bridge: ImageBridge = {
  openImage: async () => openImageResult.parse(await ipcRenderer.invoke('image:open')),
  pasteImage: async () => openImageResult.unwrap().parse(await ipcRenderer.invoke('image:paste')),
  dropImages: async (files) => openImageResult.unwrap().parse(await ipcRenderer.invoke('image:drop', files.map((file) => webUtils.getPathForFile(file)))),
  exportPng: async (bytes, suggestedName) =>
    exportPngResult.parse(await ipcRenderer.invoke('image:export-png', bytes, suggestedName))
}

contextBridge.exposeInMainWorld('imageBridge', bridge)

const documents: DocumentBridge = {
  openProject: async () => editableDocumentSchema.nullable().parse(await ipcRenderer.invoke('document:open-project')),
  saveProject: async (document) => exportPngResult.parse(await ipcRenderer.invoke('document:save-project', document)),
  openPreset: async () => recipeSchema.nullable().parse(await ipcRenderer.invoke('document:open-preset')),
  savePreset: async (recipe, name) => exportPngResult.parse(await ipcRenderer.invoke('document:save-preset', recipe, name)),
  recoveryOffer: async () => recoveryOfferSchema.parse(await ipcRenderer.invoke('recovery:offer')),
  restoreRecovery: async () => editableDocumentSchema.parse(await ipcRenderer.invoke('recovery:restore')),
  discardRecovery: async () => { await ipcRenderer.invoke('recovery:discard') },
  checkpoint: async (document) => { await ipcRenderer.invoke('recovery:checkpoint', document) }
}
contextBridge.exposeInMainWorld('documentBridge', documents)
