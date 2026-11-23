import { Button, Group, Modal, Text } from '@mantine/core'
import { Problem } from '../bits/page.tsx'
/** The confirmation that a set of records is deleted, and what PostgreSQL said about it. */
export function DeleteRecords({
  count,
  opened,
  refusal,
  onCancel,
  onConfirm,
}: {
  count: number
  opened: boolean
  refusal: unknown
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={`Delete ${count} record${count === 1 ? '' : 's'}?`}
    >
      <Text fz="sm" c="dimmed">
        They are deleted in one transaction; a row policy that refuses one refuses all.
      </Text>
      <Problem error={refusal} />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="red" onClick={onConfirm}>
          Delete
        </Button>
      </Group>
    </Modal>
  )
}
