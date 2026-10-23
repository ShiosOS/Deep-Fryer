import { computed, ref } from 'vue'
import { type Preset } from '../../shared/preset'

export function snapshotPreset(preset: Preset): Preset { return { ...preset, effects: preset.effects.map((effect) => ({ ...effect })) } }
function same(left: Preset, right: Preset): boolean { return JSON.stringify(left) === JSON.stringify(right) }

export function usePresetHistory(initial: Preset) {
  const preset = ref<Preset>(snapshotPreset(initial))
  const undoStack: Preset[] = []
  const redoStack: Preset[] = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  let start: Preset | null = null
  let confirmed: { preset: Preset; undo: Preset[]; redo: Preset[]; start: Preset | null } = {
    preset: snapshotPreset(initial), undo: [], redo: [], start: null
  }

  function confirm(): void {
    confirmed = { preset: snapshotPreset(preset.value), undo: [...undoStack], redo: [...redoStack], start: start && snapshotPreset(start) }
  }

  function refresh(): void {
    canUndo.value = undoStack.length > 0 || start !== null && !same(start, preset.value)
    canRedo.value = redoStack.length > 0
  }
  function begin(): void { if (start === null) start = snapshotPreset(preset.value) }
  function end(): void {
    if (start !== null && !same(start, preset.value)) {
      undoStack.push(start)
      redoStack.length = 0
    }
    start = null
    refresh()
  }
  function change(next: Preset): boolean {
    if (same(preset.value, next)) return false
    if (start === null) {
      undoStack.push(snapshotPreset(preset.value))
      redoStack.length = 0
    }
    preset.value = snapshotPreset(next)
    refresh()
    return true
  }
  function undo(): boolean {
    end()
    const prior = undoStack.pop()
    if (!prior) return false
    redoStack.push(snapshotPreset(preset.value))
    preset.value = prior
    refresh()
    return true
  }
  function redo(): boolean {
    end()
    const next = redoStack.pop()
    if (!next) return false
    undoStack.push(snapshotPreset(preset.value))
    preset.value = next
    refresh()
    return true
  }
  function reset(next: Preset): void {
    preset.value = snapshotPreset(next)
    undoStack.length = 0
    redoStack.length = 0
    start = null
    refresh()
    confirm()
  }
  function rollback(): void {
    preset.value = snapshotPreset(confirmed.preset)
    undoStack.splice(0, undoStack.length, ...confirmed.undo)
    redoStack.splice(0, redoStack.length, ...confirmed.redo)
    start = confirmed.start && snapshotPreset(confirmed.start)
    end()
  }
  return { preset, canUndo: computed(() => canUndo.value), canRedo: computed(() => canRedo.value), begin, end, change, undo, redo, reset, confirm, rollback }
}
