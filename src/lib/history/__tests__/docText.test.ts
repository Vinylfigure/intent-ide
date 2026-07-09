import { describe, expect, it } from 'vitest'
import { docJsonToText } from '../docText'

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }],
    },
    { type: 'paragraph' },
  ],
}

describe('docJsonToText', () => {
  it('joins textblocks with newlines and concatenates inline text', () => {
    expect(docJsonToText(doc)).toBe('Title\nHello world\nQuoted\n')
  })

  it('descends into wrapper nodes without duplicating their text', () => {
    expect(docJsonToText(doc).match(/Quoted/g)).toHaveLength(1)
  })

  it('accepts a JSON string (the API stores docJson as a string)', () => {
    expect(docJsonToText(JSON.stringify(doc))).toBe(docJsonToText(doc))
  })

  it('is defensive about malformed input', () => {
    expect(docJsonToText('not json')).toBe('')
    expect(docJsonToText(null)).toBe('')
    expect(docJsonToText({})).toBe('')
  })
})
