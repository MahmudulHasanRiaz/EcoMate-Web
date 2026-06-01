export interface WooCommerceCsvRow {
  ID?: string;
  Type?: string;
  SKU?: string;
  Name?: string;
  Slug?: string;
  Published?: string;
  'Is featured?'?: string;
  'Visibility in catalog'?: string;
  'Short description'?: string;
  Description?: string;
  'Date sale price starts'?: string;
  'Date sale price ends'?: string;
  'Tax status'?: string;
  'Tax class'?: string;
  'In stock?'?: string;
  Stock?: string;
  'Low stock amount'?: string;
  'Backorders allowed?'?: string;
  'Sold individually'?: string;
  'Weight (kg)'?: string;
  'Length (cm)'?: string;
  'Width (cm)'?: string;
  'Height (cm)'?: string;
  'Allow customer reviews?'?: string;
  'Purchase note'?: string;
  'Sale price'?: string;
  'Regular price'?: string;
  Categories?: string;
  Tags?: string;
  'Shipping class'?: string;
  Images?: string;
  Parent?: string;
  'Grouped products'?: string;
  Upsells?: string;
  'Cross-sells'?: string;
  'External URL'?: string;
  'Button text'?: string;
  Position?: string;
  'Attribute 1 name'?: string;
  'Attribute 1 value(s)'?: string;
  'Attribute 1 visible'?: string;
  'Attribute 1 global'?: string;
  'Attribute 2 name'?: string;
  'Attribute 2 value(s)'?: string;
  'Attribute 2 visible'?: string;
  'Attribute 2 global'?: string;
  'Attribute 3 name'?: string;
  'Attribute 3 value(s)'?: string;
  'Attribute 3 visible'?: string;
  'Attribute 3 global'?: string;
  'Attribute 4 name'?: string;
  'Attribute 4 value(s)'?: string;
  'Attribute 4 visible'?: string;
  'Attribute 4 global'?: string;
  [key: string]: string | undefined;
}

export interface ParsedCategory {
  name: string;
  slug: string;
  path: string;
}

export interface ImportError {
  rowNumber: number;
  sku: string;
  errorType: string;
  message: string;
}

export interface ImportSummary {
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  categoriesCreated: number;
  categoriesReused: number;
  tagsCreated: number;
  tagsReused: number;
  attributesImported: number;
  variantsImported: number;
  imagesDownloaded: number;
  imagesImported: number;
  imagesReused: number;
  imagesFailed: number;
  errors: number;
}
