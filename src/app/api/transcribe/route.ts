import { NextRequest, NextResponse } from 'next/server'

// Whisper transcription of longer recordings can exceed Vercel's default timeout.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key provided' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as Blob
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Proxy to OpenAI Whisper API
    const whisperFormData = new FormData()
    whisperFormData.append('file', file, 'recording.webm')
    whisperFormData.append('model', 'whisper-1')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: whisperFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json({ error: `Whisper API error: ${errorText}` }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json({ text: data.text })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Transcription failed' },
      { status: 500 }
    )
  }
}
