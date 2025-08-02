"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
// import ModelSelector from './model-selector';
import VoiceAgentSelector, { VoiceAgent } from './voice-agent-selector';
import { DeepgramService, DeepgramTranscriptData } from '@/lib/deepgram-service';
import { TranscriptService } from '@/lib/services/transcript-service';
// Removed: EnhancedTranscriptManager - replaced with UnifiedVoiceProcessor
import { useAnalytics } from '@/hooks/use-analytics';
import { useUnifiedVoiceProcessing } from '@/hooks/use-unified-voice-processing';
import TiptapEditor from '@/components/editor/tiptap-editor';
import { Editor } from '@tiptap/react';

// Type declarations for the Web Speech API (commented out for Deepgram-only mode)
/*
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
*/

export type LLMModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5-preview';

interface VoiceChatProps {
  onTranscriptSaved?: (transcript: string) => void;
  onUsageUpdated?: () => void;
  onTranscriptUpdate?: (transcript: string) => void;
}

const VoiceChat = ({ onTranscriptSaved, onUsageUpdated, onTranscriptUpdate }: VoiceChatProps = {}) => {
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState<string>("");
  const [selectedModel] = useState<LLMModel>('gpt-4o-mini');
  const [selectedVoiceAgent, setSelectedVoiceAgent] = useState<VoiceAgent>('deepgram');
  const [, setIsSpeechSupported] = useState(true);
  
  
  // Analytics tracking
  const analytics = useAnalytics();
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  // Editor state
  const [currentEditor, setCurrentEditor] = useState<Editor | null>(null);
  
  // const recognitionRef = useRef<any>(null); // Commented out for Deepgram-only mode
  const deepgramServiceRef = useRef<DeepgramService | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const transcriptService = useRef(new TranscriptService());
  const onTranscriptUpdateRef = useRef(onTranscriptUpdate);
  
  // Unified voice processing integration
  const voiceProcessing = useUnifiedVoiceProcessing({
    editor: currentEditor,
    onProcessed: (transcript, _, wasCommand) => {
      if (wasCommand) {
        analytics.trackFeatureUsed('voice_command_executed', { command: transcript });
        console.log(`✅ Voice command executed: ${transcript}`);
      } else {
        console.log(`📝 Regular text processed: ${transcript}`);
      }
      
      // Update accumulated transcript for display
      const textContent = currentEditor?.getText() || '';
      setAccumulatedTranscript(textContent);
      
      // Call parent callback
      if (onTranscriptUpdateRef.current) {
        onTranscriptUpdateRef.current(textContent);
      }
    }
  });
  
  // Update the callback ref when it changes
  useEffect(() => {
    onTranscriptUpdateRef.current = onTranscriptUpdate;
  }, [onTranscriptUpdate]);

  // API keys from environment variables
  const deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

  // Clear voice processing context when editor is cleared
  useEffect(() => {
    if (currentEditor?.isEmpty) {
      voiceProcessing.clearContext();
    }
  }, [currentEditor?.isEmpty, voiceProcessing]);
  
  // Toggle listening state
  const toggleListening = async () => {
    if (typeof window === 'undefined') return;
    
    if (selectedVoiceAgent === 'deepgram') {
      await toggleDeepgramListening();
    } else {
      // WebSpeech fallback commented out - Deepgram only
      toast('🔴 Usage limit reached. Please try again later.', { duration: 4000 });
    }
  };

  // Deepgram listening logic
  const toggleDeepgramListening = async () => {
    try {
      if (!deepgramApiKey) {
        toast("Deepgram API key not configured. Please add NEXT_PUBLIC_DEEPGRAM_API_KEY to your environment variables.");
        analytics.trackError('deepgram_api_key_missing', 'Deepgram API key not configured');
        return;
      }

      if (isListening) {
        // Stop listening
        if (deepgramServiceRef.current) {
          deepgramServiceRef.current.stopListening();
        }
        setIsListening(false);
        setIsThinking(true);
        
        // Track recording end
        if (recordingStartTime) {
          const duration = (Date.now() - recordingStartTime) / 1000;
          analytics.trackVoiceRecordingEnd(duration, accumulatedTranscript.length, 'deepgram');
          setRecordingStartTime(null);
        }
      } else {
        // Start listening
        if (!deepgramServiceRef.current) {
          deepgramServiceRef.current = new DeepgramService(deepgramApiKey);
        }

        // Track recording start
        analytics.trackVoiceRecordingStart('deepgram', selectedModel);
        setRecordingStartTime(Date.now());

        await deepgramServiceRef.current.startListening(
          async (data: DeepgramTranscriptData) => {
            // Process transcript with unified voice processor
            await voiceProcessing.processTranscript(data);
          },
          (error: any) => {
            console.error('Deepgram error:', error);
            setIsListening(false);
            
            // Track error
            analytics.trackError('deepgram_transcription_error', error.message || 'Unknown Deepgram error', {
              voice_agent: 'deepgram',
              model: selectedModel
            });
            
            // Check if it's a usage limit error
            if (error.message && error.message.includes('Free Deepgram minutes used up')) {
              toast("🔴 Usage limit reached (90 minutes). Please try again later.", {
                duration: 6000,
              });
              analytics.trackEngagementMilestone('deepgram_limit_reached', 1);
            } else {
              toast("Error with Deepgram transcription. Please try again.");
            }
          },
          () => {
            setIsListening(true);
            toast(`Listening with Deepgram Nova 2...`);
          },
          () => {
            setIsListening(false);
            setIsThinking(false);
            // Notify parent that usage data should be refreshed
            onUsageUpdated?.();
          }
        );
      }
    } catch (error) {
      console.error("Error with Deepgram:", error);
      toast("Failed to start Deepgram transcription. Please check your API key.");
      analytics.trackError('deepgram_initialization_error', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  // WebSpeech listening logic (commented out for Deepgram-only mode)
  /*
  const toggleWebSpeechListening = () => {
    // WebSpeech implementation commented out
    // Only Deepgram service is used now
    toast('🔴 WebSpeech fallback disabled. Using Deepgram only.', { duration: 3000 });
  };
  */
  
  // Clean up on unmount (WebSpeech cleanup commented out for Deepgram-only mode)
  useEffect(() => {
    return () => {
      /*
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          console.error("Error aborting speech recognition:", e);
        }
      }
      */
      if (deepgramServiceRef.current) {
        deepgramServiceRef.current.stopListening();
      }
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  const clearTranscript = () => {
    setAccumulatedTranscript("");
    if (currentEditor) {
      currentEditor.commands.clearContent();
      voiceProcessing.clearContext();
    }
  };
  
  // const handleModelChange = (model: LLMModel) => {
  //   setSelectedModel(model);
  //   toast(`Switched to ${model} model`);
  // };

  // Voice agent change handler (commented out for Deepgram-only mode)
  /*
  const handleVoiceAgentChange = (agent: VoiceAgent) => {
    const previousAgent = selectedVoiceAgent;
    
    // Stop current listening if active
    if (isListening) {
      if (selectedVoiceAgent === 'deepgram' && deepgramServiceRef.current) {
        deepgramServiceRef.current.stopListening();
      }
      setIsListening(false);
      setIsThinking(false);
    }

    setSelectedVoiceAgent(agent);
    toast(`Switched to Deepgram Nova 2`);
    
    // Track agent switch
    analytics.trackVoiceAgentSwitch(previousAgent, agent);
  };
  */

  
  // Handle saving transcript
  const handleSaveTranscript = async (transcriptContent: string, voiceAgent: VoiceAgent, model: LLMModel): Promise<void> => {
    const saveStartTime = Date.now();
    
    try {
      // Use current editor content
      const contentToSave = currentEditor?.getHTML() || transcriptContent;

      const { error } = await transcriptService.current.saveTranscript({
        content: contentToSave,
        voice_agent: voiceAgent,
        model_used: model
      });

      if (error) {
        throw new Error(error);
      }

      // Track successful save
      const saveTime = (Date.now() - saveStartTime) / 1000;
      analytics.trackTranscriptSaved(contentToSave.length, saveTime);
      
      // Track engagement milestone for first save
      analytics.trackEngagementMilestone('first_transcript_save', 1);

      // Clear the transcript after successful save
      clearTranscript();
      if (onTranscriptSaved) {
        onTranscriptSaved(contentToSave);
      }
    } catch (error) {
      console.error('Error saving transcript:', error);
      
      // Track save error
      analytics.trackError('transcript_save_error', error instanceof Error ? error.message : 'Unknown save error', {
        transcript_length: transcriptContent.length,
        voice_agent: voiceAgent,
        model: model
      });
      
      throw error;
    }
  };

  // Get display transcript (simplified)
  const getDisplayTranscript = () => {
    // Use editor content if available, otherwise fall back to accumulated transcript
    if (currentEditor) {
      const editorHTML = currentEditor.getHTML();
      const editorText = currentEditor.getText().trim();
      
      if (editorText.length > 0) {
        return editorHTML;
      }
    }
    
    return accumulatedTranscript;
  };

  const handleEditorChange = () => {
    // Update editor content normally
    
    // Update editor content and sync with transcript updates
    if (onTranscriptUpdate && currentEditor) {
      const textContent = currentEditor.getText();
      onTranscriptUpdate(textContent);
    }
  };

  // Handle editor ready callback to get editor instance
  const handleEditorReady = (editor: Editor) => {
    setCurrentEditor(editor);
    console.log('🎯 TipTap editor ready for voice commands');
  };


  return (
    <div className="fixed inset-x-0 top-16 bottom-0 flex items-center justify-center z-50 pointer-events-none p-4">
      <div className="floating-container relative w-full max-w-4xl h-full max-h-[75vh] pointer-events-auto">
        <div className="neo-blur rounded-xl border border-green-500 shadow-xl w-full h-full transition-all duration-300 ease-in-out overflow-hidden color-changing-border">
          <div className="flex flex-col h-full">
            {/* Header with selectors */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-700/30 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-medium text-gray-300">Noteflux</h3>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Right side space for future components if needed */}
              </div>
            </div>
            
            {/* Main content area */}
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
              {/* Center mic button and visualization */}
              <div className="flex flex-col items-center mb-2 sm:mb-3 flex-shrink-0">
                {/* Mic button with pulsing effect */}
                <button
                  onClick={toggleListening}
                  className={`mic-button-pro ${isListening ? 'active' : ''} mb-2 sm:mb-3`}
                  aria-label={isListening ? "Stop listening" : "Start listening"}
                  id="voice-mic-button"
                  name="voice-mic-button"
                >
                  {isListening ? (
                    <MicOff className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  ) : (
                    <Mic className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  )}
                </button>

                {/* Status text */}
                <div className="text-xs sm:text-sm text-gray-400 mb-3 sm:mb-4 text-center px-2">
                  {isListening ? (
                    <div className="flex items-center justify-center">
                      <div className="pulse-ring mr-2"></div>
                      <span>
                        Listening with {selectedVoiceAgent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech'}
                      </span>
                    </div>
                  ) : isThinking ? (
                    <div className="flex items-center justify-center">
                      <span>Processing your input...</span>
                    </div>
                  ) : (
                    <span>
                      Tap the mic and start speaking
                    </span>
                  )}
                </div>
                
                
                {/* Audio visualization - only show when listening */}
                {isListening && (
                  <div className="audio-visualizer mb-2 sm:mb-3 flex items-end justify-center h-6 sm:h-8 space-x-0.5 sm:space-x-1">
                    {[...Array(12)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-1 sm:w-1.5 rounded-full audio-bar ${
                          selectedVoiceAgent === 'deepgram' 
                            ? 'bg-blue-500/70' 
                            : 'bg-green-500/70'
                        }`}
                        style={{ 
                          animationDelay: `${i * 0.05}s`,
                          height: `${Math.random() * 20 + 3}px`
                        }}
                      ></div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Tiptap Editor - positioned below mic */}
              <div className="flex-1 overflow-y-auto mt-1">
                
                <TiptapEditor
                  content={getDisplayTranscript()}
                  onChange={handleEditorChange}
                  onEditorReady={handleEditorReady}
                  isListening={isListening}
                  onVoiceCommand={(command) => {
                    console.log('Voice command received:', command);
                    // Voice commands are now handled through the enhanced processor
                  }}
                  enableSaveFeatures={true}
                  onSave={async (content: string) => {
                    // Save the corrected transcript content
                    await handleSaveTranscript(content, selectedVoiceAgent, selectedModel);
                  }}
                  onClear={() => {
                    // Clear the transcript and editor
                    clearTranscript();
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceChat; 