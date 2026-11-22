import type { ColumnInfo } from '@platform/data'
import type { FieldRenderers } from '@platform/vocabulary'
import { describeField } from '../src/fields/resolve.ts'

/**
 * How a field's values are drawn. A value is not one thing drawn one way: the same field is
 * a cell in the records grid, a value in the record form and a value in the filter builder,
 * and each of those may want a different drawing.
 */

/** A column of the kind a test needs. */
function column(type: string, name = 'value'): ColumnInfo {
  return {
    schema: 'newsroom',
    table: 'articles',
    name,
    position: 1,
    type,
    required: false,
    default: null,
    comment: null,
    generated: null,
    identity: null,
    can_select: true,
    can_insert: true,
    can_update: true,
  }
}

/** A field of the kind a test needs, and what it says of how its values are drawn. */
export const field = (type: string, renderers?: FieldRenderers) =>
  describeField(column(type), { renderers })
