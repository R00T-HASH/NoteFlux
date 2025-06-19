"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from 'next/dynamic';
import Sidebar, { SidebarRef } from "@/components/sidebar";
import UsageTracker, { UsageTrackerRef } from "@/components/usage-tracker";
import { useAnalytics } from "@/hooks/use-analytics";

const DynamicVoiceChat = dynamic(() => import('@/components/voice-assistant/voice-chat'), {
  ssr: false,
  loading: () => <div className="h-screen w-full flex items-center justify-center">Loading...</div>,
});

export default function Home() {
  const sidebarRef = useRef<SidebarRef>(null);
  const usageTrackerRef = useRef<UsageTrackerRef>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [sessionStartTime] = useState(Date.now());
  const analytics = useAnalytics();
  const [correctedTranscript, setCorrectedTranscript] = useState("");

  useEffect(() => {
    // Track session start and page visit
    analytics.trackSessionStart();
    analytics.trackPageVisit('dashboard');

    // Track session end on unmount
    return () => {
      const sessionDuration = (Date.now() - sessionStartTime) / 1000;
      analytics.trackSessionEnd(sessionDuration, 0); // Actions count can be tracked separately
    };
  }, [analytics, sessionStartTime]);

  const handleSidebarToggle = () => {
    const newState = !isSidebarOpen;
    setSidebarOpen(newState);
    
    // Track sidebar interaction
    analytics.trackFeatureUsed('sidebar_toggle', {
      sidebar_opened: newState,
      action: newState ? 'open' : 'close'
    });
  };

  const handleUsageUpdated = () => {
    // Refresh usage data when Deepgram session ends
    usageTrackerRef.current?.refreshUsage();
    
    // Track usage update event
    analytics.trackFeatureUsed('usage_tracker_updated');
  };

  const handleTranscriptUpdate = (transcript: string) => {
    setCorrectedTranscript(transcript);
  };

  return (
    <main className="flex min-h-screen">
      <Sidebar ref={sidebarRef} isOpen={isSidebarOpen} onToggle={handleSidebarToggle} />
      <div className={`flex-1 flex flex-col items-center justify-center p-4 transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-16'}`}>
        {/* Usage Tracker - positioned at top */}
        <div className="absolute top-4 right-4 z-10">
          <UsageTracker ref={usageTrackerRef} />
        </div>
        
        {/* Voice Chat Modal with integrated Tiptap Editor */}
        <DynamicVoiceChat 
          onUsageUpdated={handleUsageUpdated} 
          onTranscriptUpdate={handleTranscriptUpdate}
        />
      </div>
    </main>
  );
}
