/**
 * Renders the blocks of a documentation page.
 *
 * Every link is rewritten to its target's console url (see
 * `resolveOf`), headings get permalinks, quotes that open with a
 * GitHub-style marker (`> [!NOTE]`) become callouts, and code blocks get
 * a header with their language and a copy button.
 */

import type { Block, Inline } from '../../domains/documentation'
import { resolveOf, type Tree } from '../../domains/documentation'

/** What rendering a block needs to know. */
interface RenderProps {
  /** The documentation tree, to resolve links. */
  readonly tree: Tree
  /** The repository path of the document being rendered. */
  readonly from: string
}

/** The label of each callout kind. */
const ALERTS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

/** The blocks of a document. */
export function DocumentBlocks(props: { blocks: readonly Block[] } & RenderProps) {
  return (
    <>
      {props.blocks.map((block) => (
        <BlockOf block={block} tree={props.tree} from={props.from} />
      ))}
    </>
  )
}

/** One block of a document. */
function BlockOf(props: { block: Block } & RenderProps) {
  const { block } = props
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 6)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag id={block.id}>
          <Inlines inlines={block.inline} tree={props.tree} from={props.from} />
          {level >= 2 && level <= 4 ? (
            <a class="anchor" href={`#${block.id}`} aria-label="Link to this section">
              #
            </a>
          ) : null}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inlines inlines={block.inline} tree={props.tree} from={props.from} />
        </p>
      )
    case 'list': {
      const items = block.items.map((item) => (
        <li class={item.task === null ? undefined : 'task'}>
          {item.task === null ? null : (
            <input type="checkbox" checked={item.task} disabled readOnly />
          )}
          <Inlines inlines={item.inline} tree={props.tree} from={props.from} />
        </li>
      ))
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'code':
      return (
        <figure class="code-block">
          <figcaption>
            <span>{block.language ?? 'text'}</span>
            <button type="button" class="code-copy" data-copy hidden>
              Copy
            </button>
          </figcaption>
          <pre>
            <code>{block.text}</code>
          </pre>
        </figure>
      )
    case 'table':
      return (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th>
                    <Inlines inlines={cell} tree={props.tree} from={props.from} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr>
                  {row.map((cell) => (
                    <td>
                      <Inlines inlines={cell} tree={props.tree} from={props.from} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'quote':
      if (block.alert) {
        return (
          <aside class={`callout ${block.alert}`} aria-label={ALERTS[block.alert]}>
            <p class="callout-title">{ALERTS[block.alert]}</p>
            <DocumentBlocks blocks={block.blocks} tree={props.tree} from={props.from} />
          </aside>
        )
      }
      return (
        <blockquote>
          <DocumentBlocks blocks={block.blocks} tree={props.tree} from={props.from} />
        </blockquote>
      )
    case 'rule':
      return <hr />
    default:
      return null
  }
}

/** Inline text with its marks. */
export function Inlines(props: { inlines: readonly Inline[] } & RenderProps) {
  return (
    <>
      {props.inlines.map((inline) => {
        switch (inline.kind) {
          case 'text':
            return <>{inline.text}</>
          case 'code':
            return <code>{inline.text}</code>
          case 'strong':
            return (
              <strong>
                <Inlines inlines={inline.children} tree={props.tree} from={props.from} />
              </strong>
            )
          case 'emphasis':
            return (
              <em>
                <Inlines inlines={inline.children} tree={props.tree} from={props.from} />
              </em>
            )
          case 'link':
            return (
              <a href={resolveOf(props.tree, props.from, inline.href)}>
                <Inlines inlines={inline.children} tree={props.tree} from={props.from} />
              </a>
            )
          default:
            return null
        }
      })}
    </>
  )
}
