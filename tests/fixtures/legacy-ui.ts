export const legacyPresetFilename = 'previous.fryrecipe'
export const legacyExportAction = 'Export PNG'
export function legacyAction(name: string): string {
  return name === 'Save preset as…' ? 'Save recipe as…' : name === 'Load preset' ? 'Load recipe' : name
}
