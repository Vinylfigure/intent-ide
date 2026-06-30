import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Intent IDE',
  description: 'Edit as you read. Not after.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  )
}
