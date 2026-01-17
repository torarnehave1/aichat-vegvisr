import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import favicon16 from 'vegvisr-ui-kit/assets/favicon-16x16.png'
import favicon32 from 'vegvisr-ui-kit/assets/favicon-32x32.png'
import favicon512 from 'vegvisr-ui-kit/assets/favicon-512x512.png'
import appleTouchIcon from 'vegvisr-ui-kit/assets/apple-touch-icon.png'
import './index.css'
import App from './App.tsx'

const setIcon = ({
  rel,
  sizes,
  type,
  href
}: {
  rel: string
  sizes?: string
  type?: string
  href: string
}) => {
  const selector = sizes ? `link[rel="${rel}"][sizes="${sizes}"]` : `link[rel="${rel}"]`
  let link = document.querySelector(selector) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    if (sizes) link.sizes = sizes
    document.head.appendChild(link)
  }
  if (type) link.type = type
  link.href = href
}

setIcon({ rel: 'icon', sizes: '16x16', type: 'image/png', href: favicon16 })
setIcon({ rel: 'icon', sizes: '32x32', type: 'image/png', href: favicon32 })
setIcon({ rel: 'icon', sizes: '512x512', type: 'image/png', href: favicon512 })
setIcon({ rel: 'apple-touch-icon', sizes: '180x180', href: appleTouchIcon })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
