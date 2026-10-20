import type { Product } from '../types'

/**
 * How a product's stock reads in lists and details, whatever the way it is tracked:
 * "24" (direct), "18 servings" (batch), "12 can make" (recipe), "Not tracked".
 */
export function stockSummary(product: Product): { value: string; detail: string | null; tone: 'bad' | 'warn' | null } {
  const tone = product.stockStatus === 'Out of Stock' ? 'bad' : product.stockStatus === 'Low Stock' ? 'warn' : null
  switch (product.inventoryMode) {
    case 'none':
      return { value: '—', detail: 'Not tracked', tone: null }
    case 'recipe':
      return product.availableQuantity === null
        ? { value: '—', detail: 'Recipe', tone: null }
        : { value: String(product.availableQuantity), detail: tone ? (tone === 'bad' ? 'Out of ingredients' : 'Ingredients low') : 'can make', tone }
    case 'batch':
      return { value: String(product.stockQuantity), detail: tone ? product.stockStatus : 'servings ready', tone }
    default:
      return { value: String(product.stockQuantity), detail: tone ? product.stockStatus : null, tone }
  }
}
