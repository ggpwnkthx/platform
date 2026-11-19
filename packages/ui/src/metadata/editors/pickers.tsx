import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { itemIcons } from '../../ui/icons.tsx'
import { type Family, palette, reservedFamilies, studioFamilies } from '../color.ts'

/**
 * The two things that are picked and not typed: an icon of the platform's set, and a colour
 * of its palette. An item picks them for its own mark, and a renderer that takes one as an
 * option is given the same picker — one set of icons and one palette, wherever they are chosen.
 *
 * A picker is a group of radio buttons that share a name, so the keyboard moves through it
 * as it does through any other, and choosing nothing is a choice like the rest.
 */

/** An icon of the platform's set, chosen by name; the first choice is none at all. */
export function IconPicker({
  name,
  value,
  disabled,
  none,
  noneTitle,
  onChoose,
}: {
  /** The name the radio buttons share. */
  name: string
  /** The icon chosen, by name; empty when none is. */
  value: string
  disabled: boolean
  /** What is drawn for choosing none. */
  none?: ComponentChildren
  /** What choosing none means, as a hint. */
  noneTitle: string
  onChoose: (icon: string) => void
}) {
  return (
    <div class="icon-grid">
      <label class={clsx('icon-choice', !value && 'is-chosen')} title={noneTitle}>
        <input
          type="radio"
          name={name}
          value=""
          checked={!value}
          disabled={disabled}
          aria-label={noneTitle}
          onChange={() => onChoose('')}
        />
        {none}
      </label>
      {Object.keys(itemIcons).map((choice) => {
        const Icon = itemIcons[choice]!
        return (
          <label
            key={choice}
            class={clsx('icon-choice', value === choice && 'is-chosen')}
            title={choice}
          >
            <input
              type="radio"
              name={name}
              value={choice}
              checked={value === choice}
              disabled={disabled}
              aria-label={choice}
              onChange={() => onChoose(choice)}
            />
            <Icon size={18} />
          </label>
        )
      })}
    </div>
  )
}

/** One colour of the palette, chosen by name: the family the mark is drawn as. */
function Swatch({
  family,
  name,
  chosen,
  disabled,
  onChoose,
}: {
  family: Family
  name: string
  chosen: boolean
  disabled: boolean
  onChoose: (value: string) => void
}) {
  return (
    <label
      class={clsx('swatch', `swatch-${family.name}`, chosen && 'is-chosen')}
      title={family.name}
    >
      <input
        type="radio"
        name={name}
        value={family.name}
        checked={chosen}
        disabled={disabled}
        aria-label={family.name}
        onChange={() => onChoose(family.name)}
      />
    </label>
  )
}

/**
 * A colour of the palette, chosen by the name of its family; the first choice is none at
 * all. The families kept for data come first, and the five the studio spends on meaning after.
 */
export function ColourPicker({
  name,
  chosen,
  disabled,
  onChoose,
}: {
  /** The name the radio buttons share. */
  name: string
  /** The family chosen, if one is. */
  chosen: Family | null
  disabled: boolean
  onChoose: (colour: string) => void
}) {
  const swatch = (family: Family) => (
    <Swatch
      key={family.name}
      family={family}
      name={name}
      chosen={chosen?.name === family.name}
      disabled={disabled}
      onChoose={onChoose}
    />
  )
  return (
    <div class="swatches">
      <label class={clsx('swatch', 'swatch-none', !chosen && 'is-chosen')} title="No colour">
        <input
          type="radio"
          name={name}
          value=""
          checked={!chosen}
          disabled={disabled}
          aria-label="No colour"
          onChange={() => onChoose('')}
        />
      </label>
      {reservedFamilies.map(swatch)}
      <span class="swatch-gap" aria-hidden="true" />
      {studioFamilies.map((family) => swatch(palette.find((one) => one.name === family)!))}
    </div>
  )
}
