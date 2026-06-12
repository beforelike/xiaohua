import type { NewLayer } from '../project/model'

function svgData(content: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
}

export interface PresetDefinition {
  id: 'grass' | 'tree' | 'sun' | 'cloud'
  label: string
  layer: NewLayer
}

export const presets: PresetDefinition[] = [
  {
    id: 'grass',
    label: '草地',
    layer: {
      name: '草地',
      type: 'preset',
      source: 'preset',
      width: 900,
      height: 250,
      createdBy: 'voice',
      assetUrl: svgData(
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="250"><path d="M0 120Q180 20 360 110T720 90T1000 130V250H0Z" fill="#8fa67d"/><path d="M0 175Q220 80 430 160T900 130V250H0Z" fill="#506f4b"/></svg>',
      ),
    },
  },
  {
    id: 'tree',
    label: '树',
    layer: {
      name: '树',
      type: 'preset',
      source: 'preset',
      width: 220,
      height: 360,
      createdBy: 'voice',
      assetUrl: svgData(
        '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="360"><path d="M92 170h38l20 190H70Z" fill="#815f43"/><circle cx="110" cy="110" r="88" fill="#506f4b"/><circle cx="62" cy="142" r="56" fill="#66845d"/><circle cx="160" cy="145" r="58" fill="#78936c"/></svg>',
      ),
    },
  },
  {
    id: 'sun',
    label: '太阳',
    layer: {
      name: '太阳',
      type: 'preset',
      source: 'preset',
      width: 180,
      height: 180,
      createdBy: 'voice',
      assetUrl: svgData(
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><circle cx="90" cy="90" r="58" fill="#e0a44a"/><circle cx="90" cy="90" r="78" fill="none" stroke="#e0a44a" stroke-width="8" stroke-dasharray="5 15"/></svg>',
      ),
    },
  },
  {
    id: 'cloud',
    label: '云朵',
    layer: {
      name: '云朵',
      type: 'preset',
      source: 'preset',
      width: 240,
      height: 130,
      createdBy: 'voice',
      assetUrl: svgData(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="130"><path d="M38 116a38 38 0 0 1 9-75 55 55 0 0 1 103-7 42 42 0 1 1 35 82Z" fill="#fffdf7" stroke="#d8d3c6" stroke-width="4"/></svg>',
      ),
    },
  },
]
