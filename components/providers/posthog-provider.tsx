'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { initPostHog, trackPageView } from '@/lib/posthog'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Initialize PostHog
    initPostHog()
  }, [])

  useEffect(() => {
    // Track page views on route changes
    if (pathname) {
      trackPageView(pathname)
    }
  }, [pathname, searchParams])

  return <>{children}</>
} 