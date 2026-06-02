const _PH = (s: string) => s.replace(/\s+/g, ' ')
const PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  _PH(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="600" height="600" fill="#f0f4ff"/>
    <g transform="translate(300,240)">
      <rect x="-36" y="-27" width="72" height="54" rx="6" fill="#93c5fd" opacity="0.5"/>
      <circle cx="12" cy="-6" r="12" fill="#93c5fd" opacity="0.5"/>
      <rect x="-30" y="9" width="60" height="30" rx="3" fill="#93c5fd" opacity="0.5"/>
    </g>
    <text x="300" y="345" font-family="system-ui,sans-serif" font-size="21" fill="#3b82f6"
          text-anchor="middle" font-weight="500">No Image</text>
  </svg>`),
)

export const COMBOS = [
  { 
    id: 1, 
    name: 'EID Combo -1', 
    price: 1500, 
    originalPrice: 1640, 
    image: PLACEHOLDER,
    discount: '8.5%',
    items: [
      { sl: 1, name: 'Gawa Ghee 250gm', qty: 1 },
      { sl: 2, name: 'Shahi Masala 250gm', qty: 1 },
      { sl: 3, name: 'Chinigura Aromatic Rice 1kg', qty: 1 },
      { sl: 4, name: 'Masoor Dal 1 Kg', qty: 1 },
    ],
    description: 'A perfect combo for your EID celebration with essential items.'
  },
  { 
    id: 2, 
    name: 'EID Combo -2', 
    price: 2000, 
    originalPrice: 2230, 
    image: PLACEHOLDER, 
    discount: '10.3%',
    items: [
      { sl: 1, name: 'Gawa Ghee 250gm', qty: 1 },
      { sl: 2, name: 'Shahi Masala 250gm', qty: 1 },
      { sl: 3, name: 'Chinigura Aromatic Rice 1kg', qty: 2 },
      { sl: 4, name: 'Rice Flour (Chaler Gura) 2kg', qty: 1 },
      { sl: 5, name: 'Deshi Mustard Oil 1 liter', qty: 1 },
      { sl: 6, name: 'Masoor Dal 1 Kg', qty: 1 },
    ],
    description: 'Product Unit Qty\nGawa Ghee 250gm 1\nShahi Masala 250gm 1\nChinigura 1 KG 2\nRice Flour (Chaler Gura) 2KG 1\nMustard Oil 1 Ltr 1\nMasoor Dal 1 KG 1'
  },
  { 
    id: 3, 
    name: 'EID Combo -3', 
    price: 2500, 
    originalPrice: 2810, 
    image: PLACEHOLDER, 
    discount: '11%',
    items: [
      { sl: 1, name: 'Gawa Ghee 500gm', qty: 1 },
      { sl: 2, name: 'Shahi Masala 500gm', qty: 1 },
      { sl: 3, name: 'Chinigura Aromatic Rice 2kg', qty: 1 },
    ],
    description: 'Premium items in one pack.'
  },
  { 
    id: 4, 
    name: 'EID Combo -4', 
    price: 3000, 
    originalPrice: 3390, 
    image: PLACEHOLDER, 
    discount: '11.5%',
    items: [
      { sl: 1, name: 'Gawa Ghee 1kg', qty: 1 },
      { sl: 2, name: 'Honey Premium 500gm', qty: 1 },
    ],
    description: 'Grand combo for grand celebrations.'
  },
  { 
    id: 5, 
    name: 'EID Masala combo', 
    price: 500, 
    originalPrice: 600, 
    image: PLACEHOLDER, 
    discount: '1.1%',
    items: [
      { sl: 1, name: 'Chilli Powder 100gm', qty: 1 },
      { sl: 2, name: 'Turmeric Powder 100gm', qty: 1 },
    ],
    description: 'Essential spices for your kitchen.'
  },
];
