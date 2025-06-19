"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Zap, ZapOff } from 'lucide-react';
import { toast } from 'sonner';
import VoiceTranscript from './voice-transcript';
// import ModelSelector from './model-selector';
import VoiceAgentSelector, { VoiceAgent } from './voice-agent-selector';
import { DeepgramService } from '@/lib/deepgram-service';
import { TranscriptService } from '@/lib/services/transcript-service';
import { RealtimeTranscriptManager, RealtimeTranscriptState } from '@/lib/services/realtime-transcript-manager';
import { useAnalytics } from '@/hooks/use-analytics';
import TiptapEditor from '@/components/editor/tiptap-editor';

// Type declarations for the Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export type LLMModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5-preview';

type VoiceChatProps = {
  onTranscriptSaved?: () => void;
  onUsageUpdated?: () => void;
  onTranscriptUpdate?: (transcript: string) => void;
};

const VoiceChat = ({ onTranscriptSaved, onUsageUpdated, onTranscriptUpdate }: VoiceChatProps = {}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<LLMModel>('gpt-4o-mini');
  const [selectedVoiceAgent, setSelectedVoiceAgent] = useState<VoiceAgent>('deepgram');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  
  // New state for intelligent processing
  const [isIntelligentMode, setIsIntelligentMode] = useState(true);
  const [transcriptState, setTranscriptState] = useState<RealtimeTranscriptState | null>(null);
  const [serviceAvailable, setServiceAvailable] = useState(false);
  
  // Analytics tracking
  const analytics = useAnalytics();
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  // Editor state
  const [editorContent, setEditorContent] = useState("");
  
  const recognitionRef = useRef<any>(null);
  const deepgramServiceRef = useRef<DeepgramService | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const transcriptService = useRef(new TranscriptService());
  const realtimeManager = useRef<RealtimeTranscriptManager | null>(null);
  
  // API keys from environment variables
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  const deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

  // Initialize realtime transcript manager
  useEffect(() => {
    realtimeManager.current = new RealtimeTranscriptManager();
    
    // Subscribe to transcript updates
    const unsubscribe = realtimeManager.current.onUpdate((state) => {
      setTranscriptState(state);
      setAccumulatedTranscript(state.processedTranscript);
      setIsProcessing(state.isProcessing);
      if (onTranscriptUpdate) {
        onTranscriptUpdate(state.processedTranscript);
      }
    });

    // Check service availability
    realtimeManager.current.isServiceAvailable().then(setServiceAvailable);

    return () => {
      unsubscribe();
      realtimeManager.current?.destroy();
    };
  }, []);
  
  // Toggle listening state
  const toggleListening = async () => {
    if (typeof window === 'undefined') return;
    
    if (selectedVoiceAgent === 'deepgram') {
      await toggleDeepgramListening();
    } else {
      toggleWebSpeechListening();
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
          (transcriptText: string, isFinal: boolean) => {
            if (isFinal) {
              setTranscript("");
              const newTranscript = transcriptText.trim();
              if (newTranscript) {
                if (isIntelligentMode && realtimeManager.current) {
                  // Add to intelligent processing
                  realtimeManager.current.addChunk(newTranscript, true);
                } else {
                  // Traditional mode
                  setAccumulatedTranscript(prev => {
                    const separator = prev ? " " : "";
                    return prev + separator + newTranscript;
                  });
                }
              }
            } else {
              setTranscript(transcriptText);
              if (isIntelligentMode && realtimeManager.current && transcriptText.length > 10) {
                // Add interim results for processing
                realtimeManager.current.addChunk(transcriptText, false);
              }
            }
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
              toast("🎯 Free Deepgram minutes used up! ✅ WebSpeech API is still available (free). Switch to WebSpeech to continue.", {
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

  // WebSpeech listening logic (existing)
  const toggleWebSpeechListening = () => {
    // Initialize speech recognition on first click if not already initialized
    if (!recognitionRef.current) {
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
          toast("Speech recognition is not supported in your browser. Try Chrome or Edge.");
          setIsSpeechSupported(false);
          return;
        }
        
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              setTranscript("");
              const newTranscript = result[0].transcript.trim();
              
              if (isIntelligentMode && realtimeManager.current) {
                // Add to intelligent processing
                realtimeManager.current.addChunk(newTranscript, true);
              } else {
                // Traditional mode
                setAccumulatedTranscript(prev => {
                  const separator = prev ? " " : "";
                  return prev + separator + newTranscript;
                });
              }
            } else {
              interimTranscript += result[0].transcript;
              if (isIntelligentMode && realtimeManager.current && interimTranscript.length > 10) {
                // Add interim results for processing
                realtimeManager.current.addChunk(interimTranscript, false);
              }
            }
          }
          
          setTranscript(interimTranscript);
          
          // Reset the timeout for auto-stopping
          if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
          
          timeoutRef.current = window.setTimeout(() => {
            if (isListening && recognitionRef.current) {
              setIsThinking(true);
              recognitionRef.current.stop();
            }
          }, 1500); // Stop after 1.5 seconds of silence
        };
        
        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event);
          setIsListening(false);
          toast("Error with voice recognition. Please try again.");
        };
        
        recognition.onend = () => {
          setIsListening(false);
          setIsThinking(false);
          console.log("Speech recognition ended");
        };
        
        // Store the recognition object
        recognitionRef.current = recognition;
      } catch (error) {
        console.error("Error initializing speech recognition:", error);
        setIsSpeechSupported(false);
        toast("Speech recognition failed to initialize. Try using Chrome or Edge browser.");
        return;
      }
    }
    
    try {
      if (isListening) {
        // Stop listening
        console.log("Stopping speech recognition");
        recognitionRef.current.stop();
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current);
        }
        setIsThinking(true);
      } else {
        // Start listening
        console.log("Starting speech recognition");
        recognitionRef.current.start();
        setTranscript("");
        setIsListening(true);
        toast(`Listening with WebSpeech${isIntelligentMode ? ' + AI Processing' : ''}...`);
      }
    } catch (error) {
      console.error("Error toggling speech recognition:", error);
      toast("Failed to start speech recognition. Please try reloading the page.");
    }
  };
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          console.error("Error aborting speech recognition:", e);
        }
      }
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
    if (realtimeManager.current) {
      realtimeManager.current.clear();
    }
  };
  
  // const handleModelChange = (model: LLMModel) => {
  //   setSelectedModel(model);
  //   toast(`Switched to ${model} model`);
  // };

  const handleVoiceAgentChange = (agent: VoiceAgent) => {
    const previousAgent = selectedVoiceAgent;
    
    // Stop current listening if active
    if (isListening) {
      if (selectedVoiceAgent === 'deepgram' && deepgramServiceRef.current) {
        deepgramServiceRef.current.stopListening();
      } else if (selectedVoiceAgent === 'webspeech' && recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      setIsThinking(false);
    }

    setSelectedVoiceAgent(agent);
    toast(`Switched to ${agent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech API'}`);
    
    // Track agent switch
    analytics.trackVoiceAgentSwitch(previousAgent, agent);
  };

  // Toggle intelligent processing mode
  const toggleIntelligentMode = () => {
    const newMode = !isIntelligentMode;
    setIsIntelligentMode(newMode);
    if (realtimeManager.current) {
      realtimeManager.current.setEnabled(newMode);
    }
    toast(
      newMode 
        ? "🧠 AI Processing enabled - Real-time corrections with Grok" 
        : "📝 Basic mode - Raw transcription only"
    );
    
    // Track intelligent mode toggle
    analytics.trackIntelligentModeToggle(newMode);
  };
  
  // Handle saving transcript
  const handleSaveTranscript = async (transcriptContent: string, voiceAgent: VoiceAgent, model: LLMModel): Promise<void> => {
    const saveStartTime = Date.now();
    
    try {
      // Use processed transcript if available
      const contentToSave = isIntelligentMode && transcriptState 
        ? transcriptState.processedTranscript 
        : transcriptContent;

      const { data, error } = await transcriptService.current.saveTranscript({
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
        onTranscriptSaved();
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

  // Get display transcript (processed or raw)
  const getDisplayTranscript = () => {
    if (isIntelligentMode && transcriptState) {
      return transcriptState.processedTranscript;
    }
    return accumulatedTranscript;
  };

  const handleEditorChange = (content: string) => {
    setEditorContent(content);
    // Sync with transcript updates if needed
    if (onTranscriptUpdate) {
      onTranscriptUpdate(content);
    }
  };

  return (
    <div className="fixed inset-x-0 top-16 bottom-0 flex items-center justify-center z-50 pointer-events-none p-4">
      <div className="floating-container relative w-full max-w-4xl h-full max-h-[75vh] pointer-events-auto">
        <div className="neo-blur rounded-xl border border-green-500 shadow-xl w-full h-full transition-all duration-300 ease-in-out overflow-hidden color-changing-border">
          <div className="flex flex-col h-full">
            {/* Header with selectors */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-700/30 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-300">Noteflux</h3>
              <div className="flex items-center gap-2 sm:gap-3">
                <VoiceAgentSelector 
                  selectedAgent={selectedVoiceAgent}
                  onAgentChange={handleVoiceAgentChange}
                />
                {/* <ModelSelector 
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
                /> */}
              </div>
            </div>
            
            {/* Main content area */}
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
              {/* Center mic button and visualization */}
              <div className="flex flex-col items-center mb-4 sm:mb-6 flex-shrink-0">
                {/* Mic button with pulsing effect */}
                <button
                  onClick={toggleListening}
                  className={`mic-button-pro ${isListening ? 'active' : ''} mb-4 sm:mb-6`}
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
                        Listening with {selectedVoiceAgent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech'}...
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
                  <div className="audio-visualizer mb-3 sm:mb-4 flex items-end justify-center h-8 sm:h-12 space-x-0.5 sm:space-x-1">
                    {[...Array(12)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-1 sm:w-1.5 rounded-full audio-bar ${
                          isIntelligentMode 
                            ? 'bg-purple-500/70' 
                            : selectedVoiceAgent === 'deepgram' 
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
              <div className="flex-1 overflow-hidden">
                <TiptapEditor
                  content={getDisplayTranscript()}
                  onChange={handleEditorChange}
                  transcript={transcript}
                  isListening={isListening}
                  onVoiceCommand={(command) => {
                    console.log('Voice command received:', command);
                  }}
                  enableSaveFeatures={true}
                  onSave={async (content: string) => {
                    // Save the corrected transcript content
                    await handleSaveTranscript(content, selectedVoiceAgent, selectedModel);
                  }}
                  onClear={() => {
                    // Clear the transcript and editor
                    clearTranscript();
                    setEditorContent('');
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