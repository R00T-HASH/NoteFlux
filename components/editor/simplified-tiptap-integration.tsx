/**
 * Example integration of simplified voice processing with TipTap editor
 * 
 * This replaces the complex enhanced-voice-command-processor with a single,
 * reliable Grok-powered processing pipeline.
 */

"use client";

import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useUnifiedVoiceProcessing } from '@/hooks/use-unified-voice-processing';
import { DeepgramService, DeepgramTranscriptData } from '@/lib/deepgram-service';

interface SimplifiedTipTapEditorProps {
  initialContent?: string;
  onContentChange?: (html: string) => void;
  enableVoiceInput?: boolean;
}

export const SimplifiedTipTapEditor: React.FC<SimplifiedTipTapEditorProps> = ({
  initialContent = '',
  onContentChange,
  enableVoiceInput = true
}) => {
  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onContentChange?.(editor.getHTML());
    }
  });

  // Initialize unified voice processing
  const { 
    processTranscript, 
    clearContext, 
    isReady: voiceReady,
    getStats 
  } = useUnifiedVoiceProcessing({
    editor,
    onProcessed: (transcript, htmlInserted, wasCommand) => {
      console.log('Voice processed:', { transcript, htmlInserted, wasCommand });
    }
  });

  // Voice input state
  const [isListening, setIsListening] = React.useState(false);
  const [deepgramService, setDeepgramService] = React.useState<DeepgramService | null>(null);

  // Initialize Deepgram service
  useEffect(() => {
    if (enableVoiceInput && !deepgramService) {
      const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
      if (apiKey) {
        setDeepgramService(new DeepgramService(apiKey));
      }
    }
  }, [enableVoiceInput, deepgramService]);

  // Handle voice input toggle
  const toggleVoiceInput = async () => {
    if (!deepgramService || !voiceReady()) {
      console.warn('Voice services not ready');
      return;
    }

    if (isListening) {
      // Stop listening
      deepgramService.stopListening();
      setIsListening(false);
    } else {
      // Start listening
      await deepgramService.startListening(
        // onTranscript - main processing happens here
        async (data: DeepgramTranscriptData) => {
          // Single processing call - no complex state management
          await processTranscript(data);
        },
        // onError
        (error) => {
          console.error('Deepgram error:', error);
          setIsListening(false);
        },
        // onOpen
        () => {
          setIsListening(true);
          console.log('🎤 Voice input started');
        },
        // onClose
        () => {
          setIsListening(false);
          console.log('🔇 Voice input stopped');
        }
      );
    }
  };

  // Clear voice context when editor content is cleared
  useEffect(() => {
    if (editor?.isEmpty) {
      clearContext();
    }
  }, [editor?.isEmpty, clearContext]);

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      {/* Voice Control */}
      {enableVoiceInput && (
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={toggleVoiceInput}
            disabled={!voiceReady()}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              isListening 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400'
            }`}
          >
            {isListening ? '🔴 Stop Voice Input' : '🎤 Start Voice Input'}
          </button>
          
          {voiceReady() && (
            <span className="text-sm text-green-600">
              ✅ Voice processing ready
            </span>
          )}
          
          {!voiceReady() && (
            <span className="text-sm text-orange-600">
              ⚠️ Grok API key required for voice commands
            </span>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="border border-gray-300 rounded-lg p-4 min-h-[300px] focus-within:ring-2 focus-within:ring-blue-500">
        <EditorContent 
          editor={editor} 
          className="prose max-w-none focus:outline-none"
        />
      </div>

      {/* Status */}
      {isListening && (
        <div className="mt-2 text-sm text-blue-600">
          🎤 Listening... Try saying:
          <ul className="mt-1 text-xs text-gray-600">
            <li>• "Create a list: first item, second item, third item"</li>
            <li>• "Make this a heading: Project Update"</li>
            <li>• "Make that bold" (to modify previous text)</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default SimplifiedTipTapEditor;