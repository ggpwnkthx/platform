/**
 * The documentation of the platform, as the console shows it.
 *
 * The console shows the documents of the documentation as they are
 * written: the headings, the paragraphs, the lists, the tables and the
 * code of a document. Every link of a document is rewritten to the
 * address of its target, so that the reader walks the documentation
 * the way the reader of the repository walks it.
 *
 * A quote that opens with a GitHub-style marker (`> [!NOTE]`) is a
 * callout: it carries its kind and the label of it.
 */

import type { Block, Inline } from '../../domains/documentation'
import { resolveOf, type Tree } from '../../domains/documentation'
/** What a rendering needs to know. */
interface RenderProps {
  /** The tree of the documentation. */
  readonly tree: Tree
  /** The path of the repository of the document the text is in. */
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

/** The blocks of a document, as the console shows them. */
export function DocumentBlocks(props: { blocks: readonly Block[] } & RenderProps) {
  return (
    <>
      {props.blocks.map((block) => (
        <BlockOf block={block} tree={props.tree} from={props.from} />
      ))}
    </>
  )
}

/** A block of a document, as the console shows it. */
function BlockOf(props: { block: Block } & RenderProps) {
  const { block } = props
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as
        | 'h1'
        | 'h2'
        | 'h3'
        | 'h4'
        | 'h5'
        | 'h6'
      return (
        <Tag id={block.id}>
          <Inlines inlines={block.inline} tree={props.tree} from={props.from} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inlines inlines={block.inline} tree={props.tree} from={props.from} />
        </p>
      )
    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item) => (
            <li class={item.task === null ? undefined : 'task'}>
              {item.task === null ? null : (
                <input type="checkbox" checked={item.task} disabled readOnly />
              )}
              <Inlines inlines={item.inline} tree={props.tree} from={props.from} />
            </li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item) => (
            <li class={item.task === null ? undefined : 'task'}>
              {item.task === null ? null : (
                <input type="checkbox" checked={item.task} disabled readOnly />
              )}
              <Inlines inlines={item.inline} tree={props.tree} from={props.from} />
            </li>
          ))}
        </ul>
      )
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
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

/** The marks of a text, as the console shows them. */
function Inlines(props: { inlines: readonly Inline[] } & RenderProps) {
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
