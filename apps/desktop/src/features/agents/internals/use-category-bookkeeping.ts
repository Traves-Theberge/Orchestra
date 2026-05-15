import { useEffect, useRef } from 'react'
import { useAppStore } from '@core/store'
import type { CategoryDef, CategoryId, Provider } from '../types'

export function useCategoryBookkeeping(
  provider: Provider,
  category: CategoryId,
  categories: CategoryDef[],
  categoryCounts: Record<string, number>,
) {
  const setCategory = useAppStore(s => s.setActiveAgentCategory)
  const setAgentCategories = useAppStore(s => s.setAgentCategories)
  const setAgentCategoryCounts = useAppStore(s => s.setAgentCategoryCounts)

  // Set-during-render guards: intentional alternative to useEffect to avoid an extra render.
  const trackedProviderRef = useRef(provider)
  // eslint-disable-next-line react-hooks/refs
  if (trackedProviderRef.current !== provider) {
    // eslint-disable-next-line react-hooks/refs
    trackedProviderRef.current = provider
    setCategory('overview')
  } else if (!categories.some(item => item.id === category)) {
    setCategory('overview')
  }

  useEffect(() => {
    setAgentCategories(categories.map(c => ({ id: c.id, label: c.label, icon: c.icon })))
  }, [categories, setAgentCategories])

  const lastCategoryCountsKey = useRef<string>('')
  const categoryCountsKey = JSON.stringify(categoryCounts)
  // eslint-disable-next-line react-hooks/refs
  if (categoryCountsKey !== lastCategoryCountsKey.current) {
    // eslint-disable-next-line react-hooks/refs
    lastCategoryCountsKey.current = categoryCountsKey
    setAgentCategoryCounts(categoryCounts)
  }
}
