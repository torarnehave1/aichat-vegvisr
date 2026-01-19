import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import aichatIcon from './assets/aichat-icon.png'
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

setIcon({ rel: 'icon', type: 'image/png', href: aichatIcon })
setIcon({ rel: 'apple-touch-icon', sizes: '180x180', href: appleTouchIcon })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
