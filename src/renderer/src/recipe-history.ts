import { computed, ref } from 'vue'
import { type Recipe } from './recipe'

export function snapshotRecipe(recipe: Recipe): Recipe { return { ...recipe, effects: recipe.effects.map((effect) => ({ ...effect })) } }
function same(left: Recipe, right: Recipe): boolean { return JSON.stringify(left) === JSON.stringify(right) }

export function useRecipeHistory(initial: Recipe) {
  const recipe = ref<Recipe>(snapshotRecipe(initial))
  const undoStack: Recipe[] = []
  const redoStack: Recipe[] = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  let start: Recipe | null = null
  let confirmed: { recipe: Recipe; undo: Recipe[]; redo: Recipe[]; start: Recipe | null } = {
    recipe: snapshotRecipe(initial), undo: [], redo: [], start: null
  }

  function confirm(): void {
    confirmed = { recipe: snapshotRecipe(recipe.value), undo: [...undoStack], redo: [...redoStack], start: start && snapshotRecipe(start) }
  }

  function refresh(): void {
    canUndo.value = undoStack.length > 0 || start !== null && !same(start, recipe.value)
    canRedo.value = redoStack.length > 0
  }
  function begin(): void { if (start === null) start = snapshotRecipe(recipe.value) }
  function end(): void {
    if (start !== null && !same(start, recipe.value)) {
      undoStack.push(start)
      redoStack.length = 0
    }
    start = null
    refresh()
  }
  function change(next: Recipe): boolean {
    if (same(recipe.value, next)) return false
    if (start === null) {
      undoStack.push(snapshotRecipe(recipe.value))
      redoStack.length = 0
    }
    recipe.value = snapshotRecipe(next)
    refresh()
    return true
  }
  function undo(): boolean {
    end()
    const prior = undoStack.pop()
    if (!prior) return false
    redoStack.push(snapshotRecipe(recipe.value))
    recipe.value = prior
    refresh()
    return true
  }
  function redo(): boolean {
    end()
    const next = redoStack.pop()
    if (!next) return false
    undoStack.push(snapshotRecipe(recipe.value))
    recipe.value = next
    refresh()
    return true
  }
  function reset(next: Recipe): void {
    recipe.value = snapshotRecipe(next)
    undoStack.length = 0
    redoStack.length = 0
    start = null
    refresh()
    confirm()
  }
  function rollback(): void {
    recipe.value = snapshotRecipe(confirmed.recipe)
    undoStack.splice(0, undoStack.length, ...confirmed.undo)
    redoStack.splice(0, redoStack.length, ...confirmed.redo)
    start = confirmed.start && snapshotRecipe(confirmed.start)
    end()
  }
  return { recipe, canUndo: computed(() => canUndo.value), canRedo: computed(() => canRedo.value), begin, end, change, undo, redo, reset, confirm, rollback }
}
