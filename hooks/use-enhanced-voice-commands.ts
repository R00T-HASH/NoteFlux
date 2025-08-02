"use client";

import { useRef, useCallback, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { EnhancedVoiceCommandProcessor, CommandState } from '@/components/editor/enhanced-voice-command-processor';
import { toast } from 'sonner';

interface UseEnhancedVoiceCommandsProps {
  editor?: Editor | null;
  onCommandExecuted?: (command: string, success: boolean) => void;
  enableAutoFinalization?: boolean;
}

// Insert text in a unified way - append to current paragraph or create one if needed
const insertTextUnified = (text: string, editor: Editor): void => {
  if (!text.trim()) return;
  
  const { selection } = editor.state;
  const { $from } = selection;
  
  // Get cursor position and context
  const currentNode = $from.parent;
  const isInParagraph = currentNode.type.name === 'paragraph';
  const cursorPosition = $from.parentOffset;
  
  // If we're in an empty document, create the first paragraph
  if (editor.isEmpty) {
    editor.chain().focus().insertContent(`<p>${text}</p>`).run();
    return;
  }
  
  // If we're in a paragraph, insert plain text at cursor position
  if (isInParagraph) {
    // Get the text before and after cursor
    const textBefore = currentNode.textContent.slice(0, cursorPosition);
    const textAfter = currentNode.textContent.slice(cursorPosition);
    
    // Determine if we need a space before the new text
    const needsSpaceBefore = textBefore && 
                            !textBefore.endsWith(' ') && 
                            !textBefore.endsWith('\n') && 
                            textBefore.length > 0;
    
    // Determine if we need a space after the new text
    const needsSpaceAfter = textAfter && 
                            !textAfter.startsWith(' ') && 
                            !textAfter.startsWith('\n') && 
                            textAfter.length > 0;
    
    // Build the text to insert with proper spacing (NO HTML TAGS)
    let textToInsert = text;
    if (needsSpaceBefore) {
      textToInsert = ` ${textToInsert}`;
    }
    if (needsSpaceAfter) {
      textToInsert = `${textToInsert} `;
    }
    
    // Insert plain text at current cursor position (this won't create line breaks)
    editor.chain().focus().insertContent(textToInsert).run();
  } 
  // If we're not in a paragraph (e.g., in a heading, list, etc.), create a new paragraph
  else {
    editor.chain().focus().insertContent(`<p>${text}</p>`).run();
  }
};

export const useEnhancedVoiceCommands = ({ 
  editor, 
  onCommandExecuted,
  enableAutoFinalization = true 
}: UseEnhancedVoiceCommandsProps = {}) => {
  const processorRef = useRef<EnhancedVoiceCommandProcessor | null>(null);
  const autoFinalizationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize processor
  useEffect(() => {
    if (!processorRef.current) {
      processorRef.current = new EnhancedVoiceCommandProcessor();
      console.log('🎯 Enhanced voice command processor initialized');
    }
  }, []);

  // Auto-finalization for pending lists
  useEffect(() => {
    if (enableAutoFinalization && processorRef.current && editor) {
      autoFinalizationIntervalRef.current = setInterval(() => {
        if (processorRef.current?.isListPending()) {
          console.log('⏰ Auto-finalizing pending list');
          processorRef.current.forceEndCommand(editor);
        }
      }, 5000); // Check every 5 seconds

      return () => {
        if (autoFinalizationIntervalRef.current) {
          clearInterval(autoFinalizationIntervalRef.current);
        }
      };
    }
  }, [enableAutoFinalization, editor]);

  // Process transcript with enhanced command handling
  const processTranscript = useCallback(async (transcript: string): Promise<boolean> => {
    if (!processorRef.current || !editor || !transcript.trim()) {
      return false;
    }

    try {
      console.log('🎤 Processing transcript with enhanced commands:', transcript);
      
      const result = await processorRef.current.processTranscript(transcript, editor);
      
      // Check if this was a command vs regular text processing
      // Commands return empty string or different text, regular text returns the same text
      const wasProcessed = result !== transcript;
      
      if (wasProcessed) {
        console.log('✅ Command processed successfully');
        onCommandExecuted?.(transcript, true);
        
        // Don't insert content here - the processor handles editor insertion internally
        // The processor manages its own state and inserts content when appropriate
        // If result has content that's different from input, it means it was enhanced text
        // But for commands like lists, result will be empty string
      } else {
        console.log('📝 No command detected, treating as regular text');
        // Only insert as regular text if no command was detected and we got the same text back
        if (transcript.trim()) {
          insertTextUnified(transcript, editor);
        }
        onCommandExecuted?.(transcript, false);
      }
      
      return wasProcessed;
    } catch (error) {
      console.error('❌ Error processing transcript:', error);
      toast.error('Error processing voice command');
      onCommandExecuted?.(transcript, false);
      return false;
    }
  }, [editor, onCommandExecuted]);

  // Process streaming transcript chunks (for real-time processing)
  const processStreamingChunk = useCallback(async (chunk: string, isFinal: boolean = false): Promise<boolean> => {
    if (!processorRef.current || !editor || !chunk.trim()) {
      return false;
    }

    // Only process final chunks to avoid interference
    if (!isFinal) {
      return false;
    }

    return await processTranscript(chunk);
  }, [processTranscript]);

  // Get current processor state
  const getProcessorState = useCallback((): {
    state: CommandState;
    listBuffer: string[];
    isListPending: boolean;
  } => {
    if (!processorRef.current) {
      return { state: 'idle' as CommandState, listBuffer: [], isListPending: false };
    }

    return {
      state: processorRef.current.getCurrentState(),
      listBuffer: processorRef.current.getListBuffer(),
      isListPending: processorRef.current.isListPending()
    };
  }, []);

  // Force end current command (useful for UI buttons)
  const forceEndCommand = useCallback(() => {
    if (processorRef.current && editor) {
      console.log('🛑 Force ending current command');
      processorRef.current.forceEndCommand(editor);
    }
  }, [editor]);

  // Get available commands for help/documentation
  const getAvailableCommands = useCallback(() => {
    return processorRef.current?.getAvailableCommands() || [];
  }, []);

  // Show help message with available commands
  const showCommandHelp = useCallback(() => {
    const commands = getAvailableCommands();
    const helpMessage = `Available voice commands:\n${commands.join('\n')}`;
    toast(helpMessage, { duration: 8000 });
  }, [getAvailableCommands]);

  return {
    processTranscript,
    processStreamingChunk,
    getProcessorState,
    forceEndCommand,
    getAvailableCommands,
    showCommandHelp,
    isReady: !!processorRef.current && !!editor
  };
}; 