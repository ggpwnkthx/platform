/**
 * The list a form chooses its permissions from. The picker itself is in
 * the components: an island that holds one renders it as it is.
 */

import { PermissionPicker, type PermissionPickerProps } from '../components/permission-picker'

export default function PermissionPickerIsland(props: PermissionPickerProps) {
  return <PermissionPicker {...props} />
}
