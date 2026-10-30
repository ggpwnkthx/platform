/**
 * A list of values chosen by searching: the members of a group, the
 * permissions of a role, the holder of a right. The picker itself is in
 * the components: an island that holds one renders it as it is.
 */

import { Picker, type PickerProps } from '../components/picker'

export default function ChipPicker(props: PickerProps) {
  return <Picker {...props} />
}
