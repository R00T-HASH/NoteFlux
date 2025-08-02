import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { UsageService } from './services/usage-service';

// Enhanced transcript data structure to handle native Deepgram features
export interface DeepgramTranscriptData {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
  utteranceEnd: boolean;
  confidence: number;
  words?: Array<{
    word: string;
    punctuated_word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export class DeepgramService {
  private deepgram: any;
  private connection: any;
  private isConnected: boolean = false;
  private onTranscriptCallback?: (data: DeepgramTranscriptData) => void;
  private onErrorCallback?: (error: any) => void;
  private onOpenCallback?: () => void;
  private onCloseCallback?: () => void;
  private mediaRecorder?: MediaRecorder;
  private mediaStream?: MediaStream;
  private audioContext?: AudioContext;
  private processor?: ScriptProcessorNode;
  
  // Usage tracking
  private sessionStartTime?: number;
  private sessionId: string;
  private usageService: UsageService;
  private usageRecorded: boolean = false;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Deepgram API key is required');
    }
    this.deepgram = createClient(apiKey);
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.usageService = new UsageService();
  }

  async startListening(
    onTranscript: (data: DeepgramTranscriptData) => void,
    onError?: (error: any) => void,
    onOpen?: () => void,
    onClose?: () => void
  ) {
    try {
      // Check if user can use the service
      const { canUse, secondsRemaining } = await this.usageService.canUseService();
      if (!canUse) {
        const error = new Error(`🎯 Free Deepgram minutes used up! ✅ WebSpeech API is still available (free). Switch to WebSpeech to continue transcribing.`);
        onError?.(error);
        return;
      }

      this.onTranscriptCallback = onTranscript;
      this.onErrorCallback = onError;
      this.onOpenCallback = onOpen;
      this.onCloseCallback = onClose;

      // Record session start time
      this.sessionStartTime = Date.now();
      this.usageRecorded = false; // Reset for new session

      // Enhanced Deepgram configuration leveraging native capabilities
      this.connection = this.deepgram.listen.live({
        model: "nova-2",
        language: "en-US",
        
        // Native formatting and correction features
        smart_format: true,        // Enhanced formatting for readability
        punctuate: true,          // Native punctuation handling
        numerals: true,           // Convert numbers automatically (3 -> three)
        
        // Real-time optimization
        interim_results: true,     // Get live updates
        utterance_end_ms: 1000,   // Faster utterance detection (reduced from 1500ms)
        
        // Audio quality optimization
        filler_words: false,      // Skip "uh", "um" for cleaner transcripts
        profanity_filter: false,  // Keep original content
        diarize: false,          // Single speaker optimization
        
        // Speech detection
        vad_events: true,        // Voice activity detection
        
        // Audio settings
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
        
        // Advanced features for better transcript quality
        replace: "",             // No content replacement
        search: "",              // No search terms
        tag: "voice-note-app",   // Tag for usage tracking
      });

      // Set up event listeners
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.isConnected = true;
        this.onOpenCallback?.();
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        this.isConnected = false;
        this.recordUsage(); // Record usage when connection closes
        this.onCloseCallback?.();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          // Extract enhanced data from Deepgram response
          const transcriptData: DeepgramTranscriptData = {
            transcript: transcript.trim(),
            isFinal: data.is_final || false,
            speechFinal: data.speech_final || false,
            utteranceEnd: data.type === 'UtteranceEnd',
            confidence: data.channel?.alternatives?.[0]?.confidence || 0,
            words: data.channel?.alternatives?.[0]?.words || undefined
          };
          
          this.onTranscriptCallback?.(transcriptData);
        }
      });

      // Handle utterance end events for better segmentation
      this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        // Signal utterance boundary to transcript handler
        this.onTranscriptCallback?.({
          transcript: "",
          isFinal: true,
          speechFinal: true,
          utteranceEnd: true,
          confidence: 1.0
        });
      });

      this.connection.on(LiveTranscriptionEvents.Error, (err: any) => {
        console.error("Deepgram error:", err);
        this.recordUsage(); // Record usage even on error
        this.onErrorCallback?.(err);
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
        // Metadata received - removed console.log for cleaner output
      });

      // Start capturing audio from microphone
      await this.startMicrophoneCapture();

    } catch (error) {
      console.error("Error starting Deepgram:", error);
      this.onErrorCallback?.(error);
    }
  }

  private async startMicrophoneCapture() {
    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        } 
      });

      // Create audio context for processing
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create a script processor to capture audio data
      // Note: ScriptProcessorNode is deprecated but AudioWorkletNode isn't widely supported yet
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (event) => {
        if (this.connection && this.isConnected) {
          const inputBuffer = event.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);
          
          // Convert float32 to int16
          const int16Array = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }
          
          // Send raw audio data to Deepgram
          this.connection.send(int16Array.buffer);
        }
      };

      // Connect the audio processing chain
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Microphone capture started - removed console.log for cleaner output

    } catch (error) {
      console.error("Error accessing microphone:", error);
      this.onErrorCallback?.(error);
    }
  }

  stopListening() {
    try {
      // Record usage before stopping
      this.recordUsage();

      // Disconnect audio processing
      if (this.processor) {
        this.processor.disconnect();
        this.processor = undefined;
      }

      // Close audio context
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
        this.audioContext = undefined;
      }

      // Stop media stream
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          track.stop();
        });
        this.mediaStream = undefined;
      }

      // Close Deepgram connection
      if (this.connection && this.isConnected) {
        this.connection.finish();
      }

      this.isConnected = false;
    } catch (error) {
      console.error("Error stopping Deepgram:", error);
    }
  }

  private async recordUsage() {
    if (!this.sessionStartTime || this.usageRecorded) return;

    const sessionEndTime = Date.now();
    const durationMs = sessionEndTime - this.sessionStartTime;
    const durationSeconds = Math.round(durationMs / 1000);
    // Calculate actual seconds used instead of rounding up to minutes
    const actualSecondsUsed = Math.max(1, durationSeconds); // Minimum 1 second

    // Only record if session was at least 5 seconds (to avoid accidental clicks)
    if (durationSeconds >= 5) {
      try {
        await this.usageService.recordUsage({
          session_id: this.sessionId,
          seconds_used: actualSecondsUsed, // Track actual seconds
          voice_agent: 'deepgram',
          model: 'nova-2'
        });
        // Usage recorded successfully - removed verbose console.log
        this.usageRecorded = true; // Mark as recorded
      } catch (error) {
        console.error('Error recording usage:', error);
      }
    }

    // Reset for potential reuse
    this.sessionStartTime = undefined;
  }

  isListening(): boolean {
    return this.isConnected;
  }
} 