"use client";

import { useRef, useCallback, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { UnifiedVoiceProcessor } from '@/lib/services/unified-voice-processor';
import { DeepgramTranscriptData } from '@/lib/deepgram-service';
import { toast } from 'sonner';

interface UseUnifiedVoiceProcessingProps {
  editor?: Editor | null;
  onProcessed?: (transcript: string, htmlInserted: string, wasCommand: boolean) => void;
}

export const useUnifiedVoiceProcessing = ({ 
  editor, 
  onProcessed 
}: UseUnifiedVoiceProcessingProps = {}) => {
  const processorRef = useRef<UnifiedVoiceProcessor | null>(null);
  
  // Initialize processor lazily
  const getProcessor = useCallback(() => {
    if (!processorRef.current) {
      processorRef.current = new UnifiedVoiceProcessor();
      // console.log('🎯 Unified voice processor initialized');
    }
    return processorRef.current;
  }, []);

  // Set up auto-finalize callback when editor is available
  useEffect(() => {
    if (editor) {
      const processor = getProcessor();
      processor.setAutoFinalizeCallback((html: string) => {
        // console.log('⏰ Auto-finalizing list and inserting into editor:', html);
        try {
          editor.chain().focus().insertContent(html).run();
          
          // Trigger autoscroll for auto-finalized content
          setTimeout(() => {
            const docSize = editor.state.doc.content.size;
            editor.commands.focus('end');
            editor.commands.setTextSelection(docSize);
          }, 150);
          
          onProcessed?.('Auto-finalized list', html, true);
          // toast('✅ List completed automatically', { duration: 2000 });
        } catch (error) {
          // console.error('❌ Error inserting auto-finalized list:', error);
          // toast('⚠️ Error completing list automatically', { duration: 2000 });
        }
      });
    }
  }, [editor, getProcessor, onProcessed]);

  /**
   * Main processing method - handles Deepgram transcript data
   * Returns true if content was inserted into editor, false otherwise
   */
  const processTranscript = useCallback(async (data: DeepgramTranscriptData): Promise<boolean> => {
    if (!editor) {
      // console.warn('⚠️ Editor not available for voice processing');
      return false;
    }

    try {
      const processor = getProcessor();
      const htmlToInsert = await processor.processTranscript(data, editor);
      
      if (htmlToInsert) {
        try {
          // Insert the HTML into the editor
          editor.chain().focus().insertContent(htmlToInsert).run();
          
          // Trigger autoscroll after inserting content
          setTimeout(() => {
            // Move cursor to end and trigger editor update for autoscroll
            const docSize = editor.state.doc.content.size;
            editor.commands.focus('end');
            editor.commands.setTextSelection(docSize);
          }, 150);
          
          // Determine if this was a command based on HTML structure
          const wasCommand = htmlToInsert.includes('<ul>') || 
                            htmlToInsert.includes('<ol>') || 
                            htmlToInsert.includes('<h') ||
                            htmlToInsert.includes('<strong>') ||
                            htmlToInsert.includes('<em>');
          
          // Notify callback
          onProcessed?.(data.transcript, htmlToInsert, wasCommand);
          
          // Show status message for commands
          if (wasCommand) {
            // toast('✅ Voice command processed', { duration: 1500 });
          }
          
          return true;
        } catch (insertError) {
          // console.error('❌ Error inserting HTML into editor:', insertError);
          // console.log('🔍 Problematic HTML:', htmlToInsert);
          
          // Fallback: insert as plain text
          try {
            editor.chain().focus().insertContent(`<p>${data.transcript}</p>`).run();
            
            // Trigger autoscroll for fallback insertion
            setTimeout(() => {
              const docSize = editor.state.doc.content.size;
              editor.commands.focus('end');
              editor.commands.setTextSelection(docSize);
            }, 150);
            
            onProcessed?.(data.transcript, `<p>${data.transcript}</p>`, false);
            // toast('⚠️ Command processed as text due to formatting issue', { duration: 2000 });
            return true;
          } catch (fallbackError) {
            // console.error('❌ Even fallback insertion failed:', fallbackError);
            throw fallbackError;
          }
        }
      } else {
        // Check if we're in list mode - provide feedback to user
        const processor = getProcessor();
        const stats = processor.getStats();
        
        if (stats.listMode.active) {
          // console.log('📋 List mode active - collecting items:', stats.listMode.items);
          onProcessed?.(data.transcript, '', false); // Empty HTML but still processed
          
          // Show status message
          if (stats.listMode.itemCount === 1) {
            // toast('📋 Started list - keep adding items or say "end list"', { duration: 2000 });
          } else if (stats.listMode.itemCount > 1) {
            // toast(`📋 List: ${stats.listMode.itemCount} items - say "end list" to finish`, { duration: 2000 });
          }
          
          return true;
        } else if (stats.headingMode.active) {
          // console.log(`📝 Heading mode active (H${stats.headingMode.level}) - waiting for content`);
          onProcessed?.(data.transcript, '', false); // Empty HTML but still processed
          
          // Show status message
          // toast(`📝 H${stats.headingMode.level} heading mode - speak your heading text`, { duration: 2000 });
          
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      // console.error('❌ Error processing voice transcript:', error);
      // toast.error('Error processing voice input');
      return false;
    }
  }, [editor, onProcessed, getProcessor]);

  /**
   * Process raw text (for manual input or testing)
   */
  const processText = useCallback(async (text: string): Promise<boolean> => {
    if (!editor || !text.trim()) return false;
    
    // Convert text to DeepgramTranscriptData format
    const mockData: DeepgramTranscriptData = {
      transcript: text,
      isFinal: true,
      speechFinal: true,
      utteranceEnd: false,
      confidence: 1.0
    };
    
    return await processTranscript(mockData);
  }, [processTranscript]);

  /**
   * Clear processor context (useful when starting new document/session)
   */
  const clearContext = useCallback(() => {
    const processor = getProcessor();
    processor.clearContext();
    // console.log('🗑️ Voice processor context cleared');
  }, [getProcessor]);

  /**
   * Check if processor is ready (has API key)
   */
  const isReady = useCallback(() => {
    const processor = getProcessor();
    return processor.isReady();
  }, [getProcessor]);

  /**
   * Get processor statistics
   */
  const getStats = useCallback(() => {
    const processor = getProcessor();
    return processor.getStats();
  }, [getProcessor]);

  return {
    processTranscript,
    processText,
    clearContext,
    isReady,
    getStats
  };
};