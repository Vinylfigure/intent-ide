import { Decoration } from 'prosemirror-view'
import type { AnnotationType } from '@/lib/annotations/types'

// Color classes for annotation types
const typeClasses: Record<AnnotationType, string> = {
  ask: 'bg-blue-100/60 border-b-2 border-annotation-ask',
  edit: 'bg-red-100/60 border-b-2 border-annotation-edit',
  dig: 'bg-purple-100/60 border-b-2 border-annotation-dig',
  flag: 'bg-amber-100/60 border-b-2 border-annotation-flag',
}

export function createAnnotationHighlight(
  from: number,
  to: number,
  id: string,
  type: AnnotationType,
): Decoration {
  return Decoration.inline(from, to, {
    class: `annotation-highlight ${typeClasses[type]} cursor-pointer transition-colors`,
    'data-annotation-id': id,
    'data-annotation-type': type,
  }, { annotationId: id })
}

export function createReadLineWidget(pos: number): Decoration {
  return Decoration.widget(pos, () => {
    const el = document.createElement('div')
    el.className = 'read-line-indicator w-full h-px bg-accent/30 my-1'
    return el
  }, { side: 1, key: 'read-line' })
}
