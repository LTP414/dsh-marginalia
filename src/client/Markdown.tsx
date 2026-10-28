import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Answers are model text. Render GFM Markdown but never raw HTML, remote
 * images, or unsanitized embedded content. Links open outside the app.
 */
export function MarginaliaMarkdown({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }): React.JSX.Element {
  return (
    <div className={`mgl-md${streaming ? ' mgl-md-streaming' : ''}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
          img: () => null,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
