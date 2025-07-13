"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Zap, ZapOff } from 'lucide-react';
import { toast } from 'sonner';
// import ModelSelector from './model-selector';
import VoiceAgentSelector, { VoiceAgent } from './voice-agent-selector';
import { DeepgramService } from '@/lib/deepgram-service';
import { TranscriptService } from '@/lib/services/transcript-service';
import { GrokService } from '@/lib/services/grok-service';
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
  const [currentTranscript, setCurrentTranscript] = useState(""); // Current interim transcript
  const [correctedTranscript, setCorrectedTranscript] = useState(""); // AI-corrected transcript
  const [selectedModel, setSelectedModel] = useState<LLMModel>('gpt-4o-mini');
  const [selectedVoiceAgent, setSelectedVoiceAgent] = useState<VoiceAgent>('deepgram');
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [isInListContext, setIsInListContext] = useState(false); // Track if we're expecting list items
  
  // Analytics tracking
  const analytics = useAnalytics();
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const deepgramServiceRef = useRef<DeepgramService | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const transcriptService = useRef(new TranscriptService());
  const grokService = useRef(new GrokService());
  
  // API keys from environment variables
  const openaiApiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  const deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

  // Get last 2-3 sentences from corrected transcript for context
  const getContextSentences = () => {
    if (!correctedTranscript) return [];
    
    // Split by sentence endings and get last 2-3 sentences
    const sentences = correctedTranscript.split(/[.!?]+/).filter(s => s.trim());
    return sentences.slice(-3).map(s => s.trim()).filter(s => s);
  };

  // Process text with Grok AI and add to corrected transcript
  const processWithGrok = async (text: string) => {
    if (!text.trim()) return;
    
    try {
      const context = getContextSentences();
      
      // Enhanced command detection - check for commands with content
      const hasFormattingCommand = /\b(make|create|bold|italic|heading|list|bullet|numbered|quote|center|align)\b/i.test(text);
      const hasListCommand = /\b(create|make|bullet|numbered)\s+(a\s+)?(list|listing)\b/i.test(text);
      const hasContentAfterCommand = text.split(/\b(create|make|bullet|numbered)\s+(a\s+)?(list|listing)\b/i).pop()?.trim();
      
      // Detect if text contains list items (comma-separated or "and" separated)
      const hasListItems = /\w+,\s*\w+|(\w+\s+and\s+\w+\s+and\s+\w+)|(\w+\s+and\s+\w+)/.test(text);
      
      // Check if this could be a single list item when in list context
      const couldBeListItem = isInListContext && text.trim().length > 0 && !hasFormattingCommand && !hasListCommand;
      
      // If it's just a list command without items, don't process yet - wait for items
      if (hasListCommand && (!hasContentAfterCommand || hasContentAfterCommand.length < 3)) {
        console.log('List command detected but no items yet, waiting...');
        // Set list context to true and don't show the command in the editor
        setIsInListContext(true);
        setCurrentTranscript("");
        return;
      }
      
      // If it's a formatting command with content OR contains list items OR could be a list item, process it
      if (hasFormattingCommand || hasListItems || couldBeListItem) {
        // For list commands, ensure we're in list context
        if (hasListCommand || hasListItems) {
          setIsInListContext(true);
        }
        
        // Process with full AI for formatting commands
        const result = await grokService.current.correctTranscript(text, context);
        
        // For formatting commands, replace or append based on AI decision
        setCorrectedTranscript(prev => {
          if (!prev) {
            return result.correctedText;
          }
          
          // Check if the AI result contains our previous content
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = result.correctedText;
          const aiTextContent = tempDiv.textContent || tempDiv.innerText || '';
          const prevTextContent = prev.replace(/<[^>]*>/g, '').trim();
          
          // If AI result contains our previous content, use it as the full content
          if (aiTextContent.includes(prevTextContent)) {
            return result.correctedText;
          } else {
            // Otherwise, append the AI result to existing content
            return prev + "\n\n" + result.correctedText;
          }
        });
      } else {
        // For continuous speech, get corrected HTML and append seamlessly
        const result = await grokService.current.correctTranscript(text, context);
        
        // Reset list context if we're processing continuous speech
        if (isInListContext) {
          setIsInListContext(false);
        }
        
        // Add corrected HTML to existing corrected transcript with seamless flow
        setCorrectedTranscript(prev => {
          if (!prev) {
            return result.correctedText;
          }
          
          // For continuous speech, combine without line breaks to maintain flow
          // Check if we need a space separator between HTML content
          const prevEndsWithSpace = prev.endsWith(' ');
          const currentStartsWithSpace = result.correctedText.startsWith(' ');
          
          if (prevEndsWithSpace || currentStartsWithSpace) {
            // No additional space needed
            return prev + result.correctedText;
          } else {
            // Add space for natural word flow
            return prev + ' ' + result.correctedText;
          }
        });
      }
      
      // Clear interim text only after corrected text is added
      setCurrentTranscript("");
      
    } catch (error) {
      console.error('Error processing with Grok:', error);
      // Fallback: add raw text as HTML content if processing fails
      setCorrectedTranscript(prev => {
        if (!prev) {
          return text;
        }
        
        // Add space for natural word flow, similar to successful processing
        const prevEndsWithSpace = prev.endsWith(' ');
        const currentStartsWithSpace = text.startsWith(' ');
        
        if (prevEndsWithSpace || currentStartsWithSpace) {
          return prev + text;
        } else {
          return prev + ' ' + text;
        }
      });
      
      // Clear interim text even on error
      setCurrentTranscript("");
    }
  };

  // Get combined text for editor: corrected + interim
  const getEditorContent = () => {
    // Return the corrected HTML content directly
    // For continuous speech, this will be seamless HTML without paragraph breaks
    // For formatting commands, this will include proper TipTap HTML formatting
    return correctedTranscript;
  };

  // Update parent when correctedTranscript changes
  useEffect(() => {
    if (onTranscriptUpdate) {
      onTranscriptUpdate(correctedTranscript);
    }
  }, [correctedTranscript, onTranscriptUpdate]);
  
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
        
        // Track recording end
        if (recordingStartTime) {
          const duration = (Date.now() - recordingStartTime) / 1000;
          analytics.trackVoiceRecordingEnd(duration, correctedTranscript.length, 'deepgram');
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
              // Process final text with Grok in background
              processWithGrok(transcriptText);
            } else {
              // Show interim results
              setCurrentTranscript(transcriptText);
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
            toast(`Listening `);
          },
          () => {
            setIsListening(false);
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

  // WebSpeech listening logic
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
              // Process final text with Grok in background
              // Don't clear currentTranscript here - let processWithGrok handle it
              // This prevents text flickering in the editor
              processWithGrok(result[0].transcript);
            } else {
              interimTranscript += result[0].transcript;
            }
          }
          
          // Show interim results
          setCurrentTranscript(interimTranscript);
          
          // Reset the timeout for auto-stopping
          if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
          
          timeoutRef.current = window.setTimeout(() => {
            if (isListening && recognitionRef.current) {
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
      } else {
        // Start listening
        console.log("Starting speech recognition");
        recognitionRef.current.start();
        setCurrentTranscript("");
        setIsListening(true);
        toast(`Listening with WebSpeech + AI Processing...`);
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
    setCorrectedTranscript("");
    setCurrentTranscript("");
    setIsInListContext(false); // Reset list context when clearing
  };

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
    }

    setSelectedVoiceAgent(agent);
    toast(`Switched to ${agent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech API'} + AI Processing`);
    
    // Track agent switch
    analytics.trackVoiceAgentSwitch(previousAgent, agent);
  };
  
  // Handle saving transcript
  const handleSaveTranscript = async (transcriptContent: string, voiceAgent: VoiceAgent, model: LLMModel): Promise<void> => {
    const saveStartTime = Date.now();
    
    try {
      const { data, error } = await transcriptService.current.saveTranscript({
        content: transcriptContent,
        voice_agent: voiceAgent,
        model_used: model
      });

      if (error) {
        throw new Error(error);
      }

      // Track successful save
      const saveTime = (Date.now() - saveStartTime) / 1000;
      analytics.trackTranscriptSaved(transcriptContent.length, saveTime);
      
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

  const handleEditorChange = (content: string) => {
    // Update corrected transcript when user manually edits
    setCorrectedTranscript(content);
    // Reset list context on manual edit since user is taking control
    setIsInListContext(false);
  };

  return (
    <div className="fixed inset-x-0 top-16 bottom-0 flex items-center justify-center z-50 pointer-events-none p-4">
      <div className="floating-container relative w-full max-w-4xl h-full max-h-[75vh] pointer-events-auto">
        <div className="neo-blur rounded-xl border border-green-500 shadow-xl w-full h-full transition-all duration-300 ease-in-out overflow-hidden color-changing-border">
          <div className="flex flex-col h-full">
            {/* Header with selectors */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-700/30 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-gray-300">Noteflux</h3>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <VoiceAgentSelector 
                  selectedAgent={selectedVoiceAgent}
                  onAgentChange={handleVoiceAgentChange}
                />
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
                        Listening with {selectedVoiceAgent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech'} + AI Processing...
                      </span>
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
                          selectedVoiceAgent === 'deepgram' 
                            ? 'bg-purple-500/70' 
                            : 'bg-purple-500/70'
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
              
              {/* Tiptap Editor - shows corrected + interim text */}
              <div className="flex-1 overflow-hidden">
                <TiptapEditor
                  content={getEditorContent()}
                  onChange={handleEditorChange}
                  transcript=""
                  isListening={false}
                  onVoiceCommand={(command) => {
                    console.log('Voice command received:', command);
                  }}
                  enableSaveFeatures={true}
                  onSave={async (content: string) => {
                    await handleSaveTranscript(content, selectedVoiceAgent, selectedModel);
                  }}
                  onClear={() => {
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