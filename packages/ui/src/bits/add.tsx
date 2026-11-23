import { Button } from '@mantine/core'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

/** The button that adds something: the same mark wherever it is. */
export const AddButton = ({ children, onClick }: { children: ReactNode; onClick(): void }) => (
  <Button variant="default" leftSection={<Plus size={14} />} onClick={onClick}>
    {children}
  </Button>
)
