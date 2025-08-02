import { DeepgramTranscriptData } from '../deepgram-service';
import { GrokService } from './grok-service';

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  isComplete: boolean;
  confidence: number;
  needsAICorrection: boolean;
  correctedText?: string;
  words?: Array<{
    word: string;
    punctuated_word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface EnhancedTranscriptState {
  segments: TranscriptSegment[];
  currentInterim: string;
  fullText: string;
  isProcessing: boolean;
  stats: {
    totalSegments: number;
    averageConfidence: number;
    needsAIProcessing: number;
  };
}

type TranscriptUpdateCallback = (state: EnhancedTranscriptState) => void;

export class EnhancedTranscriptManager {
  private segments: TranscriptSegment[] = [];
  private updateCallbacks: TranscriptUpdateCallback[] = [];
  private grokService: GrokService | null = null;
  private aiEnhancementEnabled: boolean = true;
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentSegmentId: string = "";
  
  // AI processing configuration
  private readonly CONFIDENCE_THRESHOLD = 0.85; // Only AI-enhance low confidence transcripts
  private readonly MIN_LENGTH_FOR_AI = 15; // Minimum characters to consider AI enhancement
  private readonly DEBOUNCE_DELAY = 300; // ms - delay for UI updates

  constructor(grokApiKey?: string) {
    if (grokApiKey) {
      this.grokService = new GrokService();
    } else {
      this.aiEnhancementEnabled = false;
    }
  }

  // Main entry point for Deepgram transcript data
  processDeepgramData(data: DeepgramTranscriptData): void {
    if (data.utteranceEnd) {
      // Handle utterance boundaries - finalize current segment
      this.finalizeCurrentSegment();
      return;
    }

    if (!data.transcript.trim()) return;

    // Only process final/speech final transcripts - ignore interim results
    if (data.isFinal || data.speechFinal) {
      // Final transcript - create/update segment
      this.handleFinalTranscript(data);
      this.debouncedUpdate();
    }
    // Ignore interim results completely - don't process or display them
  }

  private handleFinalTranscript(data: DeepgramTranscriptData): void {
    // Create new segment for final transcript
    const segment: TranscriptSegment = {
      id: `segment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: data.transcript,
      timestamp: Date.now(),
      isComplete: true,
      confidence: data.confidence,
      needsAICorrection: this.shouldUseAICorrection(data),
      words: data.words
    };

    this.segments.push(segment);
    this.currentSegmentId = segment.id;
    
    // Immediately notify UI of the new segment (before AI processing)
    this.notifyUpdate();

    // Process with AI if needed (this will trigger another update when complete)
    if (segment.needsAICorrection && this.aiEnhancementEnabled) {
      this.enhanceSegmentWithAI(segment.id);
    }
  }

  private handleInterimTranscript(data: DeepgramTranscriptData): void {
    // No longer handling interim transcripts - removed this functionality
    // Interim results are ignored to show only final, processed text
  }

  private finalizeCurrentSegment(): void {
    // Called on utterance end - ensures clean segment boundaries
    this.currentSegmentId = "";
  }

  private shouldUseAICorrection(data: DeepgramTranscriptData): boolean {
    if (!this.aiEnhancementEnabled) return false;
    
    // Use AI enhancement for:
    // 1. Low confidence transcripts
    // 2. Longer text segments (more likely to need grammar/style improvements)
    // 3. Text that might benefit from contextual understanding
    
    const lowConfidence = data.confidence < this.CONFIDENCE_THRESHOLD;
    const sufficientLength = data.transcript.length >= this.MIN_LENGTH_FOR_AI;
    const hasComplexContent = this.detectComplexContent(data.transcript);
    
    return lowConfidence || (sufficientLength && hasComplexContent);
  }

  private detectComplexContent(text: string): boolean {
    // Heuristics for content that might benefit from AI enhancement
    const indicators = [
      /\b(um|uh|like|you know)\b/gi, // Filler words that AI can clean up
      /[.!?]{2,}/g, // Multiple punctuation
      /\b\d+\b/g, // Numbers that might need context
      /[^\w\s.,!?;:]/g // Special characters that might indicate formatting issues
    ];
    
    return indicators.some(pattern => pattern.test(text));
  }

  private async enhanceSegmentWithAI(segmentId: string): Promise<void> {
    const segment = this.segments.find(s => s.id === segmentId);
    if (!segment || segment.correctedText || !this.grokService) return;

    try {
      // Get context from previous segments for better AI understanding
      const context = this.getContextForSegment(segmentId);
      
      const result = await this.grokService.correctTranscript(segment.text, context);
      
      // Only update if AI actually improved the text
      if (result && result.correctedText !== segment.text && result.confidence > 0.7) {
        
        segment.correctedText = result.correctedText;
        segment.confidence = Math.max(segment.confidence, result.confidence);
        
        // Force immediate update to refresh UI
        this.notifyUpdate();
      }
      
    } catch (error) {
      console.error('AI enhancement failed:', error);
      // Graceful degradation - use original Deepgram text
    }
  }

  private getContextForSegment(segmentId: string): string[] {
    const segmentIndex = this.segments.findIndex(s => s.id === segmentId);
    if (segmentIndex <= 0) return [];
    
    // Get previous 3 segments for context
    const contextSegments = this.segments.slice(Math.max(0, segmentIndex - 3), segmentIndex);
    return contextSegments.map(s => s.correctedText || s.text);
  }

  // Public API methods
  getState(): EnhancedTranscriptState {
    const fullText = this.getFullText();
    
    return {
      segments: [...this.segments],
      currentInterim: "", // Always empty since we don't show interim results
      fullText,
      isProcessing: this.segments.some(s => s.needsAICorrection && !s.correctedText),
      stats: {
        totalSegments: this.segments.length,
        averageConfidence: this.calculateAverageConfidence(),
        needsAIProcessing: this.segments.filter(s => s.needsAICorrection && !s.correctedText).length
      }
    };
  }

  private getFullText(): string {
    // Only show final, processed text - no interim results
    if (this.segments.length === 0) return "";
    
    // Map each segment to its best available text (corrected or original)
    const segmentTexts = this.segments.map(segment => {
      const text = segment.correctedText || segment.text;
      return text.trim();
    }).filter(text => text.length > 0); // Remove empty segments
    
    // Join with spaces and ensure proper spacing
    return segmentTexts.join(' ').trim();
  }

  private calculateAverageConfidence(): number {
    if (this.segments.length === 0) return 0;
    
    const totalConfidence = this.segments.reduce((sum, s) => sum + s.confidence, 0);
    return totalConfidence / this.segments.length;
  }

  // Configuration methods
  setAIEnhancement(enabled: boolean): void {
    this.aiEnhancementEnabled = enabled;
  }

  isAIEnhancementEnabled(): boolean {
    return this.aiEnhancementEnabled;
  }

  // Event handling
  onUpdate(callback: TranscriptUpdateCallback): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }

  private debouncedUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.notifyUpdate();
      this.debounceTimer = null;
    }, this.DEBOUNCE_DELAY);
  }

  private notifyUpdate(): void {
    const state = this.getState();
    this.updateCallbacks.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in transcript update callback:', error);
      }
    });
  }

  // Utility methods
  clear(): void {
    this.segments = [];
    this.currentSegmentId = "";
    this.notifyUpdate();
  }

  // Get final text for saving/export
  getFinalText(): string {
    return this.segments
      .map(s => s.correctedText || s.text)
      .join(' ')
      .trim();
  }

  // Debug/analytics methods
  getProcessingStats() {
    return {
      totalSegments: this.segments.length,
      aiEnhanced: this.segments.filter(s => s.correctedText).length,
      averageConfidence: this.calculateAverageConfidence(),
      lowConfidenceSegments: this.segments.filter(s => s.confidence < this.CONFIDENCE_THRESHOLD).length
    };
  }
} 