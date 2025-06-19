"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import { 
  Bold, 
  Italic, 
  Underline, 
  List, 
  ListOrdered, 
  Quote,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo,
  Redo,
  Sun,
  Moon,
  Copy,
  Save,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { TranscriptService } from '@/lib/services/transcript-service';

interface TiptapEditorProps {
  content: string;
  onChange: (content: string) => void;
  onTranscriptStream?: (chunks: string[]) => void;
  transcript?: string; // Current live transcript from voice input
  isListening?: boolean; // Whether voice input is currently active
  onVoiceCommand?: (command: string) => void; // Callback for voice commands
  onSave?: (content: string) => void; // Callback for save action
  onClear?: () => void; // Callback for clear action
  enableSaveFeatures?: boolean; // Whether to show save/clear buttons
}

const TiptapEditor: React.FC<TiptapEditorProps> = ({ 
  content, 
  onChange, 
  onTranscriptStream,
  transcript: externalTranscript,
  isListening: externalIsListening,
  onVoiceCommand,
  onSave,
  onClear,
  enableSaveFeatures = false
}) => {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showVoiceHelp, setShowVoiceHelp] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const transcriptService = new TranscriptService();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Typography,
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onCreate: ({ editor }) => {
      setTimeout(() => {
        setIsEditorReady(true);
      }, 100);
    },
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none min-h-[500px] p-4',
      },
    },
  });

  // Process external transcript for voice commands
  useEffect(() => {
    if (externalTranscript && externalTranscript.length > 0 && !externalIsListening && editor) {
      // When external listening stops and we have transcript, process it for voice commands
      import('@/components/editor/voice-command-processor').then(({ VoiceCommandProcessor }) => {
        const processor = new VoiceCommandProcessor();
        processor.processCommand(externalTranscript, editor).then((commandExecuted) => {
          if (commandExecuted) {
            console.log('Voice command executed from homepage mic:', externalTranscript);
            onVoiceCommand?.(externalTranscript);
          }
        }).catch(console.error);
      }).catch(console.error);
    }
  }, [externalTranscript, externalIsListening, editor, onVoiceCommand]);

  // Use external voice state if provided, otherwise use internal
  const isListening = externalIsListening ?? false;
  const transcript = externalTranscript ?? '';

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  // Log editor state changes
  useEffect(() => {
    setIsEditorReady(!!editor);
  }, [editor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup if needed
    };
  }, []);

  // Function to handle transcript streams from editor route - DISABLED since we only use homepage mic
  const handleTranscriptStream = useCallback(async (chunks: string[]) => {
    // Disabled - we only use homepage mic for voice commands
    console.log('Transcript stream disabled - use homepage mic instead');
      onTranscriptStream?.(chunks);
  }, [onTranscriptStream]);

  // Expose the transcript stream handler for external use
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).handleTranscriptStream = handleTranscriptStream;
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).handleTranscriptStream;
      }
    };
  }, [handleTranscriptStream]);

  // Handle saving the content as a transcript
  const handleSave = async () => {
    if (!editor || !editor.getText().trim()) {
      toast.error('No content to save');
      return;
    }

    setIsSaving(true);
    try {
      const plainText = editor.getText();
      const htmlContent = editor.getHTML();
      
      if (onSave) {
        // Use custom save callback if provided
        onSave(htmlContent);
        toast.success('Transcript saved successfully!');
      } else {
        // Default save to transcript service
        const { data, error } = await transcriptService.saveTranscript({
          content: htmlContent,
          title: `Editor Note ${new Date().toLocaleDateString()}`,
          voice_agent: 'editor',
          model_used: 'manual'
        });

        if (error) {
          throw new Error(error);
        }

        toast.success('Transcript saved successfully!');
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save content. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle clearing the editor content
  const handleClear = () => {
    if (!editor) return;

    const hasContent = editor.getText().trim().length > 0;
    if (hasContent && !confirm('Are you sure you want to clear all content?')) {
      return;
    }

    if (onClear) {
      // Use custom clear callback if provided
      onClear();
    } else {
      // Default clear behavior
      editor.commands.clearContent();
      onChange('');
    }
    
    toast.success('Content cleared');
  };

  if (!editor) {
    return null;
  }

  const ToolbarButton = ({ 
    onClick, 
    isActive = false, 
    children, 
    disabled = false,
    title,
    specialColor
  }: {
    onClick: () => void;
    isActive?: boolean;
    children: React.ReactNode;
    disabled?: boolean;
    title?: string;
    specialColor?: 'neon-green';
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        px-1.5 py-1 rounded transition-colors text-sm
        ${specialColor === 'neon-green' 
          ? 'text-green-400 hover:text-green-300 hover:bg-green-400/10' 
          : isActive 
            ? (isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white')
            : (isDarkMode 
                ? 'text-gray-300 hover:bg-gray-700 hover:text-white' 
                : 'text-gray-600 hover:bg-gray-200'
              )
        }
        ${disabled 
          ? (isDarkMode ? 'opacity-50 cursor-not-allowed' : 'opacity-50 cursor-not-allowed')
          : 'cursor-pointer'
        }
      `}
    >
      {children}
    </button>
  );

  const VoiceCommandHelp = () => {
    return (
      <div className={`absolute top-12 left-0 right-0 p-4 border rounded-lg max-h-96 overflow-y-auto z-50 ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-300' : 'bg-white border-gray-300 text-gray-700'
      }`}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          Voice Commands (Use Homepage Mic)
        </h3>
        
        {/* Info about using homepage mic */}
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-600/30 rounded-lg">
          <h4 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-1">
            🎤 Use Homepage Mic
            </h4>
          <div className="text-xs text-blue-300 space-y-1">
            <div>• Click the main mic button in center of page</div>
            <div>• Speak your content + command</div>
            <div>• Voice commands will format text automatically</div>
          </div>
        </div>
        
        {/* Quick Examples */}
        <div className="mb-3">
          <h4 className="text-sm font-medium text-yellow-400 mb-2">🎯 Quick Examples:</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            <div className="text-xs text-yellow-300">"make this bold"</div>
            <div className="text-xs text-yellow-300">"create list"</div>
            <div className="text-xs text-yellow-300">"make this a heading"</div>
            <div className="text-xs text-yellow-300">"bullet list"</div>
            <div className="text-xs text-yellow-300">"numbered list"</div>
            <div className="text-xs text-yellow-300">"task list"</div>
          </div>
        </div>
        
        <div className="pt-3 border-t border-gray-600 text-xs opacity-75">
          <div className="mb-1">🎯 <strong>Smart commands</strong> work on the entire document</div>
          <div className="mb-1">✋ <strong>Regular commands</strong> need text selected first</div>
          <div className="mb-1">📝 <strong>List commands</strong> convert text to proper lists</div>
        </div>
      </div>
    );
  };

  const themeClass = isDarkMode ? 'tiptap-editor-dark' : 'tiptap-editor-light';
  const borderColor = isDarkMode ? 'border-gray-800/50' : 'border-gray-300';
  const bgColor = isDarkMode ? 'bg-gray-900/30' : 'bg-white';
  const toolbarBg = isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50';
  const separatorColor = isDarkMode ? 'bg-gray-700' : 'bg-gray-300';

  return (
    <div className={`border ${borderColor} rounded-lg ${bgColor} overflow-hidden`}>
      {/* Toolbar */}
      <div className={`border-b ${borderColor} ${toolbarBg} py-1 px-2 relative`}>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {/* Theme Toggle */}
          <ToolbarButton
            onClick={() => setIsDarkMode(!isDarkMode)}
            title="Toggle theme"
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Text Formatting */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Headings */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive('taskList')}
            title="Task list"
          >
            <input type="checkbox" className="h-4 w-4" readOnly />
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Quote */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive('blockquote')}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>

          {/* Text Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
            title="Align left"
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
            title="Align center"
          >
            <AlignCenter className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            isActive={editor.isActive({ textAlign: 'right' })}
            title="Align right"
          >
            <AlignRight className="h-4 w-4" />
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Undo/Redo */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>

          <div className={`w-px h-4 ${separatorColor} mx-2`} />

          {/* Copy Button */}
          <ToolbarButton
            onClick={() => {
              // Get the HTML content and convert to clean text while preserving structure
              const htmlContent = editor.getHTML();
              
              // Create a temporary div to parse HTML and extract text with formatting
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = htmlContent;
              
              // Function to extract text while preserving structure
              const extractFormattedText = (element: Element): string => {
                let result = '';
                
                for (const node of Array.from(element.childNodes)) {
                  if (node.nodeType === Node.TEXT_NODE) {
                    result += node.textContent || '';
                  } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const elem = node as Element;
                    const tagName = elem.tagName.toLowerCase();
                    
                    switch (tagName) {
                      case 'p':
                        const pText = extractFormattedText(elem).trim();
                        if (pText) result += pText + '\n\n';
                        break;
                      case 'h1':
                      case 'h2':
                      case 'h3':
                      case 'h4':
                      case 'h5':
                      case 'h6':
                        const hText = extractFormattedText(elem).trim();
                        if (hText) result += hText + '\n\n';
                        break;
                      case 'ul':
                        for (const li of Array.from(elem.querySelectorAll('li'))) {
                          const liText = extractFormattedText(li).trim();
                          if (liText) result += '• ' + liText + '\n';
                        }
                        result += '\n';
                        break;
                      case 'ol':
                        const lis = Array.from(elem.querySelectorAll('li'));
                        lis.forEach((li, index) => {
                          const liText = extractFormattedText(li).trim();
                          if (liText) result += `${index + 1}. ${liText}\n`;
                        });
                        result += '\n';
                        break;
                      case 'blockquote':
                        const qText = extractFormattedText(elem).trim();
                        if (qText) result += '> ' + qText + '\n\n';
                        break;
                      case 'br':
                        result += '\n';
                        break;
                      default:
                        result += extractFormattedText(elem);
                        break;
                    }
                  }
                }
                
                return result;
              };
              
              const formattedText = extractFormattedText(tempDiv)
                .replace(/\n{3,}/g, '\n\n') // Clean up excessive line breaks
                .trim();
              
              navigator.clipboard.writeText(formattedText);
              toast.success('Text copied to clipboard');
            }}
            disabled={!editor.isEditable || !editor.getText().trim()}
            title="Copy corrected text"
          >
            <Copy className="h-4 w-4" />
          </ToolbarButton>

          {/* Save and Clear buttons - show if enableSaveFeatures is true */}
          {enableSaveFeatures && (
            <>
              {/* Save Button */}
              <ToolbarButton
                onClick={handleSave}
                disabled={!editor.isEditable || !editor.getText().trim() || isSaving}
                title={isSaving ? "Saving..." : "Save as transcript"}
                specialColor="neon-green"
              >
                <Save className="h-4 w-4" />
              </ToolbarButton>

              {/* Clear Button */}
              <ToolbarButton
                onClick={handleClear}
                disabled={!editor.isEditable}
                title="Clear all content"
              >
                <Trash2 className="h-4 w-4" />
              </ToolbarButton>
            </>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <EditorContent 
        editor={editor} 
        className={themeClass}
      />
    </div>
  );
};

export default TiptapEditor; 