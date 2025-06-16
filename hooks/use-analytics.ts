import { useCallback } from 'react'
import { trackEvent, identifyUser, setUserProperties } from '@/lib/posthog'

export const useAnalytics = () => {
  // Voice-related events
  const trackVoiceRecordingStart = useCallback((agent: string, model?: string) => {
    trackEvent('voice_recording_started', {
      voice_agent: agent,
      model: model,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackVoiceRecordingEnd = useCallback((duration: number, transcriptLength: number, agent: string) => {
    trackEvent('voice_recording_ended', {
      duration_seconds: duration,
      transcript_length: transcriptLength,
      voice_agent: agent,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackTranscriptSaved = useCallback((transcriptLength: number, editTime?: number) => {
    trackEvent('transcript_saved', {
      transcript_length: transcriptLength,
      edit_time_seconds: editTime,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackTranscriptEdited = useCallback((originalLength: number, finalLength: number) => {
    trackEvent('transcript_edited', {
      original_length: originalLength,
      final_length: finalLength,
      edit_ratio: finalLength / originalLength,
      timestamp: new Date().toISOString()
    })
  }, [])

  // User journey events
  const trackUserSignup = useCallback((method: string) => {
    trackEvent('user_signup', {
      signup_method: method,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackUserLogin = useCallback((method: string) => {
    trackEvent('user_login', {
      login_method: method,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackOnboardingStep = useCallback((step: number, stepName: string, completed: boolean) => {
    trackEvent('onboarding_step', {
      step_number: step,
      step_name: stepName,
      completed: completed,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackOnboardingCompleted = useCallback((totalTime: number) => {
    trackEvent('onboarding_completed', {
      total_time_seconds: totalTime,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackOnboardingSkipped = useCallback((atStep: number) => {
    trackEvent('onboarding_skipped', {
      skipped_at_step: atStep,
      timestamp: new Date().toISOString()
    })
  }, [])

  // Feature usage events
  const trackFeatureUsed = useCallback((featureName: string, context?: Record<string, any>) => {
    trackEvent('feature_used', {
      feature_name: featureName,
      ...context,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackPageVisit = useCallback((pageName: string, timeSpent?: number) => {
    trackEvent('page_visit', {
      page_name: pageName,
      time_spent_seconds: timeSpent,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackError = useCallback((errorType: string, errorMessage: string, context?: Record<string, any>) => {
    trackEvent('error_occurred', {
      error_type: errorType,
      error_message: errorMessage,
      ...context,
      timestamp: new Date().toISOString()
    })
  }, [])

  // AI/Model related events
  const trackModelSwitch = useCallback((fromModel: string, toModel: string) => {
    trackEvent('model_switched', {
      from_model: fromModel,
      to_model: toModel,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackIntelligentModeToggle = useCallback((enabled: boolean) => {
    trackEvent('intelligent_mode_toggled', {
      enabled: enabled,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackVoiceAgentSwitch = useCallback((fromAgent: string, toAgent: string) => {
    trackEvent('voice_agent_switched', {
      from_agent: fromAgent,
      to_agent: toAgent,
      timestamp: new Date().toISOString()
    })
  }, [])

  // Session and engagement events
  const trackSessionStart = useCallback(() => {
    trackEvent('session_started', {
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackSessionEnd = useCallback((duration: number, actionsCount: number) => {
    trackEvent('session_ended', {
      duration_seconds: duration,
      actions_count: actionsCount,
      timestamp: new Date().toISOString()
    })
  }, [])

  const trackEngagementMilestone = useCallback((milestone: string, value: number) => {
    trackEvent('engagement_milestone', {
      milestone_type: milestone,
      milestone_value: value,
      timestamp: new Date().toISOString()
    })
  }, [])

  // User identification and properties
  const identifyCurrentUser = useCallback((userId: string, properties?: Record<string, any>) => {
    identifyUser(userId, {
      ...properties,
      identified_at: new Date().toISOString()
    })
  }, [])

  const updateUserProperties = useCallback((properties: Record<string, any>) => {
    setUserProperties({
      ...properties,
      last_updated: new Date().toISOString()
    })
  }, [])

  return {
    // Voice events
    trackVoiceRecordingStart,
    trackVoiceRecordingEnd,
    trackTranscriptSaved,
    trackTranscriptEdited,
    
    // User journey
    trackUserSignup,
    trackUserLogin,
    trackOnboardingStep,
    trackOnboardingCompleted,
    trackOnboardingSkipped,
    
    // Feature usage
    trackFeatureUsed,
    trackPageVisit,
    trackError,
    
    // AI/Model events
    trackModelSwitch,
    trackIntelligentModeToggle,
    trackVoiceAgentSwitch,
    
    // Session events
    trackSessionStart,
    trackSessionEnd,
    trackEngagementMilestone,
    
    // User identification
    identifyCurrentUser,
    updateUserProperties,
    
    // Generic event tracking
    trackEvent
  }
} 