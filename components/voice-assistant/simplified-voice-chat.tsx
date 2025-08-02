"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import VoiceAgentSelector, { VoiceAgent } from './voice-agent-selector';
import TiptapEditor from '@/components/editor/tiptap-editor';
import { DeepgramService, DeepgramTranscriptData } from '@/lib/deepgram-service';
import { TranscriptService } from '@/lib/services/transcript-service';
import { useUnifiedVoiceProcessing } from '@/hooks/use-unified-voice-processing';
import { useAnalytics } from '@/hooks/use-analytics';
import { Editor } from '@tiptap/react';

// Type declarations for the Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export type LLMModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5-preview';

interface SimplifiedVoiceChatProps {
  onTranscriptSaved?: (transcript: string) => void;
  onUsageUpdated?: () => void;
  onTranscriptUpdate?: (transcript: string) => void;
}

const SimplifiedVoiceChat = ({ 
  onTranscriptSaved, 
  onUsageUpdated, 
  onTranscriptUpdate 
}: SimplifiedVoiceChatProps = {}) => {
  // Basic state
  const [isListening, setIsListening] = useState(false);
  const [selectedVoiceAgent, setSelectedVoiceAgent] = useState<VoiceAgent>('deepgram');
  const [selectedModel] = useState<LLMModel>('gpt-4o-mini');
  const [currentEditor, setCurrentEditor] = useState<Editor | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  
  // Analytics
  const analytics = useAnalytics();
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  
  // Services
  const recognitionRef = useRef<any>(null);
  const deepgramServiceRef = useRef<DeepgramService | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const transcriptService = useRef(new TranscriptService());
  
  // API keys
  const deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
  
  // Unified voice processing
  const voiceProcessing = useUnifiedVoiceProcessing({
    editor: currentEditor,
    onProcessed: (transcript, htmlInserted, wasCommand) => {
      if (wasCommand) {
        analytics.trackFeatureUsed('voice_command_executed', { command: transcript });
        console.log(`✅ Voice command executed: ${transcript}`);
      } else {
        console.log(`📝 Regular text processed: ${transcript}`);
      }
      
      // Update parent callback with current editor text
      if (onTranscriptUpdate && currentEditor) {
        const textContent = currentEditor.getText();
        onTranscriptUpdate(textContent);
      }
    }
  });

  // Check speech support on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSpeechSupported(!!SpeechRecognition);
    }
  }, []);

  // Clear voice context when editor is cleared
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
          const textLength = currentEditor?.getText().length || 0;
          analytics.trackVoiceRecordingEnd(duration, textLength, 'deepgram');
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
    if (!isSpeechSupported) {
      toast("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      // Stop listening
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      
      // Track recording end
      if (recordingStartTime) {
        const duration = (Date.now() - recordingStartTime) / 1000;
        const textLength = currentEditor?.getText().length || 0;
        analytics.trackVoiceRecordingEnd(duration, textLength, 'webspeech');
        setRecordingStartTime(null);
      }
    } else {
      // Start listening
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      recognition.onresult = async (event: any) => {
        // Only process final results, ignore interim
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            const newTranscript = result[0].transcript.trim();
            
            if (newTranscript) {
              // Convert WebSpeech result to DeepgramTranscriptData format
              const webSpeechData: DeepgramTranscriptData = {
                transcript: newTranscript,
                isFinal: true,
                speechFinal: true,
                utteranceEnd: false,
                confidence: result[0].confidence || 0.8,
              };
              
              // Process with unified voice processor
              await voiceProcessing.processTranscript(webSpeechData);
            }
          }
        }
        
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
      
      recognitionRef.current = recognition;
      
      // Track recording start
      analytics.trackVoiceRecordingStart('webspeech', selectedModel);
      setRecordingStartTime(Date.now());
      
      recognition.start();
      toast('Listening with WebSpeech...');
    }
  };

  // Handle voice agent change
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
    toast(`Switched to ${agent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech API'}`);
    
    // Track agent switch
    analytics.trackVoiceAgentSwitch(previousAgent, agent);
  };

  // Clear transcript
  const clearTranscript = () => {
    if (currentEditor) {
      currentEditor.commands.clearContent();
      voiceProcessing.clearContext();
      toast('Transcript cleared');
    }
  };

  // Save transcript
  const handleSaveTranscript = async () => {
    if (!currentEditor) return;
    
    const saveStartTime = Date.now();
    const contentToSave = currentEditor.getHTML();
    
    if (!contentToSave.trim()) {
      toast('No content to save');
      return;
    }
    
    try {
      const { error } = await transcriptService.current.saveTranscript({
        content: contentToSave,
        voice_agent: selectedVoiceAgent,
        model_used: selectedModel
      });

      if (error) {
        throw new Error(error);
      }

      // Track successful save
      const saveTime = (Date.now() - saveStartTime) / 1000;
      const textLength = currentEditor.getText().length;
      analytics.trackTranscriptSaved(textLength, saveTime);
      
      // Track engagement milestone for first save
      analytics.trackEngagementMilestone('first_transcript_save', 1);

      toast('Transcript saved successfully!');
      
      if (onTranscriptSaved) {
        onTranscriptSaved(contentToSave);
      }
    } catch (error) {
      console.error('Error saving transcript:', error);
      
      // Track save error
      const textLength = currentEditor.getText().length;
      analytics.trackError('transcript_save_error', error instanceof Error ? error.message : 'Unknown save error', {
        transcript_length: textLength,
        voice_agent: selectedVoiceAgent,
        model: selectedModel
      });
      
      toast('Failed to save transcript. Please try again.');
    }
  };

  // Handle editor ready callback
  const handleEditorReady = (editor: Editor) => {
    setCurrentEditor(editor);
    console.log('🎯 TipTap editor ready for voice processing');
  };

  // Handle editor content change
  const handleEditorChange = (content: string) => {
    // Sync with transcript updates if needed
    if (onTranscriptUpdate && currentEditor) {
      const textContent = currentEditor.getText();
      onTranscriptUpdate(textContent);
    }
  };

  // Show voice processing stats
  const showProcessingStats = () => {
    const stats = voiceProcessing.getStats();
    toast(`Voice Processing: ${stats.hasApiKey ? 'Ready' : 'API Key Missing'}`, { duration: 3000 });
  };

  return (
    <div className="fixed inset-x-0 top-16 bottom-0 flex items-center justify-center z-50 pointer-events-none p-4">
      <div className="floating-container relative w-full max-w-4xl h-full max-h-[75vh] pointer-events-auto">
        <div className="neo-blur rounded-xl border border-green-500 shadow-xl w-full h-full transition-all duration-300 ease-in-out overflow-hidden color-changing-border">
          <div className="flex flex-col h-full">
            {/* Header with controls */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-700/30 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-medium text-gray-300">Noteflux</h3>
                {/* Voice processing status indicator */}
                {isListening && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-green-500/20 rounded-md border border-green-500/30">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-xs text-green-300">
                      Listening...
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <VoiceAgentSelector 
                  selectedAgent={selectedVoiceAgent}
                  onAgentChange={handleVoiceAgentChange}
                />
                {/* Voice processing stats */}
                <button
                  onClick={showProcessingStats}
                  className="px-3 py-1 text-xs bg-gray-600/50 hover:bg-gray-600/70 rounded-md text-gray-300 hover:text-white transition-colors"
                  title="Show voice processing status"
                >
                  Stats
                </button>
              </div>
            </div>
            
            {/* Main content area */}
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
              {/* Center mic button */}
              <div className="flex flex-col items-center mb-4 sm:mb-6 flex-shrink-0">
                <button
                  onClick={toggleListening}
                  className={`mic-button-pro ${isListening ? 'active' : ''} mb-4 sm:mb-6`}
                  aria-label={isListening ? "Stop listening" : "Start listening"}
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
                    <span className="text-green-400">
                      🎤 Listening... Try saying "create a list" or "make this bold"
                    </span>
                  ) : (
                    <span>
                      Click the mic to start voice input with {selectedVoiceAgent === 'deepgram' ? 'Deepgram Nova 2' : 'WebSpeech API'}
                    </span>
                  )}
                </div>
              </div>
              
              {/* TipTap Editor */}
              <div className="flex-1 overflow-hidden">
                <TiptapEditor
                  content=""
                  onChange={handleEditorChange}
                  onEditorReady={handleEditorReady}
                  enableSaveFeatures={false} // We handle saving ourselves
                />
              </div>
              
              {/* Action buttons */}
              <div className="flex justify-center gap-3 mt-4 pt-4 border-t border-gray-700/30">
                <button
                  onClick={handleSaveTranscript}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
                  disabled={!currentEditor || currentEditor.isEmpty}
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
                <button
                  onClick={clearTranscript}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                  disabled={!currentEditor || currentEditor.isEmpty}
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimplifiedVoiceChat;