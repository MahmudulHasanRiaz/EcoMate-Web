import Barcode from 'react-barcode'

type PriceMode = 'base' | 'sale' | 'smart' | 'both'

type Props = {
  sku: string
  basePrice: number | null
  salePrice: number | null
  priceMode: PriceMode
  attributes?: { name: string; value: string }[]
  widthMm: number
  heightMm: number
}

function fmtPrice(v: number | null | undefined): string {
  return v != null ? `৳${Number(v).toFixed(0)}` : ''
}

function getBarcodeWidth(sku: string, stickerWidthMm: number): number {
  const len = sku.length
  if (len <= 8) return 1.8
  if (len <= 12) return 1.4
  if (len <= 16) return 1.1
  return 0.8
}

export function PriceLabelTemplate({ sku, basePrice, salePrice, priceMode, attributes, widthMm, heightMm }: Props) {
  const barcodeWidth = getBarcodeWidth(sku, widthMm)
  const isNarrow = widthMm < 40
  const fontSize = isNarrow ? 7 : 8

  const renderPrice = () => {
    switch (priceMode) {
      case 'base':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(basePrice)}</div>
      case 'sale':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice)}</div>
      case 'smart':
        return <div className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice ?? basePrice)}</div>
      case 'both':
        return (
          <div style={{ fontSize }}>
            {salePrice != null ? (
              <>
                <span className='line-through text-muted-foreground' style={{ fontSize: fontSize - 1 }}>{fmtPrice(basePrice)}</span>
                {' '}
                <span className='font-bold' style={{ fontSize }}>{fmtPrice(salePrice)}</span>
              </>
            ) : (
              <span className='font-bold'>{fmtPrice(basePrice)}</span>
            )}
          </div>
        )
    }
  }

  return (
    <div className='price-label-sticker'>
      <div className='pl-barcode'>
        <Barcode
          value={sku}
          width={barcodeWidth}
          height={isNarrow ? 18 : 24}
          fontSize={isNarrow ? 6 : 7}
          margin={0}
          background='#fff'
          lineColor='#000'
        />
      </div>
      <div className='pl-price'>{renderPrice()}</div>
      {attributes && attributes.length > 0 && (
        <div className='pl-attrs' style={{ fontSize: fontSize - 1 }}>
          {attributes.map((a, i) => (
            <span key={i} className='text-muted-foreground'>
              {i > 0 ? ', ' : ''}{a.name}: {a.value}
            </span>
          ))}
        </div>
      )}
      <style>{`
        @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
        .price-label-sticker {
          width: ${widthMm}mm; height: ${heightMm}mm;
          padding: 1.5mm 2mm;
          font-family: 'Inter', sans-serif;
          color: #000;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1mm;
          overflow: hidden;
        }
        .price-label-sticker .pl-barcode {
          display: flex;
          justify-content: center;
        }
        .price-label-sticker .pl-barcode svg {
          max-width: 100%;
          height: auto;
        }
        .price-label-sticker .pl-price {
          text-align: center;
          line-height: 1.2;
        }
        .price-label-sticker .pl-price .line-through {
          text-decoration: line-through;
          opacity: 0.6;
        }
        .price-label-sticker .pl-attrs {
          text-align: center;
          line-height: 1.1;
          opacity: 0.7;
        }
      `}</style>
    </div>
  )
}
