import posthog from 'posthog-js'

export const initPostHog = () => {
  if (typeof window !== 'undefined') {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'
    
    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        // Enable session recording
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: {
            password: true,
          },
        },
        // Capture pageviews automatically
        capture_pageview: true,
        // Capture performance metrics
        capture_performance: true,
        // Enable feature flags
        bootstrap: {
          featureFlags: {},
        },
        // Privacy settings
        respect_dnt: true,
        opt_out_capturing_by_default: false,
        // Development settings
        loaded: (posthog) => {
          // PostHog loaded successfully - removed console.log for cleaner output
        }
      })
    } else {
      console.warn('PostHog key not found. Add NEXT_PUBLIC_POSTHOG_KEY to your environment variables.')
    }
  }
}

// Custom event tracking functions
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (typeof window !== 'undefined' && posthog) {
    posthog.capture(eventName, properties)
  }
}

// User identification
export const identifyUser = (userId: string, properties?: Record<string, any>) => {
  if (typeof window !== 'undefined' && posthog) {
    posthog.identify(userId, properties)
  }
}

// Set user properties
export const setUserProperties = (properties: Record<string, any>) => {
  if (typeof window !== 'undefined' && posthog) {
    posthog.people.set(properties)
  }
}

// Track page views manually if needed
export const trackPageView = (pageName?: string) => {
  if (typeof window !== 'undefined' && posthog) {
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      page_name: pageName
    })
  }
}

// Feature flag functions
export const isFeatureEnabled = (flagKey: string): boolean => {
  if (typeof window !== 'undefined' && posthog) {
    return posthog.isFeatureEnabled(flagKey) || false
  }
  return false
}

export const getFeatureFlag = (flagKey: string) => {
  if (typeof window !== 'undefined' && posthog) {
    return posthog.getFeatureFlag(flagKey)
  }
  return null
}

export default posthog 