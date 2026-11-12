/**
 * The form of a workspace.
 *
 * The form names a workspace of the tenant: its slug — the name it is
 * known by inside the tenant, and the name that never changes — and the
 * name the people read.
 */

export function WorkspaceForm(props: { action: string }) {
  return (
    <form method="post" action={props.action} class="form">
      <div class="form-grid">
        <label class="field">
          <span>Slug</span>
          <input
            name="slug"
            required
            pattern="[a-z][a-z0-9_-]{0,62}"
            placeholder="acme"
            spellcheck={false}
          />
          <span class="hint">
            letters, digits, dashes and underscores; it starts with a letter, and it never changes
          </span>
        </label>
        <label class="field">
          <span>Name</span>
          <input name="displayName" required placeholder="Acme" />
          <span class="hint">the name the people read</span>
        </label>
      </div>
      <div class="row">
        <button type="submit" class="button">
          Create the workspace
        </button>
      </div>
    </form>
  )
}
