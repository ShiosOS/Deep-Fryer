import { computed, ref } from 'vue'
import { snapshotEdit, type EditState } from '../../shared/edit'

function same(left: EditState, right: EditState): boolean { return JSON.stringify(left) === JSON.stringify(right) }

export function useEditHistory(initial: EditState) {
  const edit = ref<EditState>(snapshotEdit(initial))
  const undoStack: EditState[] = []
  const redoStack: EditState[] = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  let start: EditState | null = null
  let confirmed: { edit: EditState; undo: EditState[]; redo: EditState[]; start: EditState | null } = {
    edit: snapshotEdit(initial), undo: [], redo: [], start: null
  }

  function confirm(): void {
    confirmed = { edit: snapshotEdit(edit.value), undo: [...undoStack], redo: [...redoStack], start: start && snapshotEdit(start) }
  }

  function refresh(): void {
    canUndo.value = undoStack.length > 0 || start !== null && !same(start, edit.value)
    canRedo.value = redoStack.length > 0
  }
  function begin(): void { if (start === null) start = snapshotEdit(edit.value) }
  function end(): void {
    if (start !== null && !same(start, edit.value)) {
      undoStack.push(start)
      redoStack.length = 0
    }
    start = null
    refresh()
  }
  function change(next: EditState): boolean {
    if (same(edit.value, next)) return false
    if (start === null) {
      undoStack.push(snapshotEdit(edit.value))
      redoStack.length = 0
    }
    edit.value = snapshotEdit(next)
    refresh()
    return true
  }
  function undo(): boolean {
    end()
    const prior = undoStack.pop()
    if (!prior) return false
    redoStack.push(snapshotEdit(edit.value))
    edit.value = prior
    refresh()
    return true
  }
  function redo(): boolean {
    end()
    const next = redoStack.pop()
    if (!next) return false
    undoStack.push(snapshotEdit(edit.value))
    edit.value = next
    refresh()
    return true
  }
  function reset(next: EditState): void {
    edit.value = snapshotEdit(next)
    undoStack.length = 0
    redoStack.length = 0
    start = null
    refresh()
    confirm()
  }
  function rollback(): void {
    edit.value = snapshotEdit(confirmed.edit)
    undoStack.splice(0, undoStack.length, ...confirmed.undo)
    redoStack.splice(0, redoStack.length, ...confirmed.redo)
    start = confirmed.start && snapshotEdit(confirmed.start)
    end()
  }
  return { edit, canUndo: computed(() => canUndo.value), canRedo: computed(() => canRedo.value), begin, end, change, undo, redo, reset, confirm, rollback }
}
