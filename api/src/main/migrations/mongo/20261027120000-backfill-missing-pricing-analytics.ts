/**
 * Used to recompute the analytics of every version without them, which ran
 * MiniZinc once per version before the API could start. Pricings now work
 * without analytics, so it does nothing. It is kept, empty, because databases
 * that already registered it would fail to migrate without its file.
 */
export async function up(): Promise<void> {
  // Nothing to do.
}

export async function down(): Promise<void> {
  // Nothing to undo.
}
