"use client";

import { Editor } from '@tiptap/react';
import { toast } from 'sonner';

export interface VoiceCommand {
  patterns: string[];
  action: (editor: Editor) => void;
  description: string;
  requiresSelection?: boolean;
}

export interface StreamingChunk {
  text: string;
  timestamp: number;
  confidence?: number;
}

export class VoiceCommandProcessor {
  private commands: VoiceCommand[] = [
    // Bold commands - enhanced patterns
    {
      patterns: ['make this bold', 'bold this', 'make bold', 'bold', 'make it bold', 'bold text', 'make that bold'],
      action: (editor) => editor.chain().focus().toggleBold().run(),
      description: 'Make selected text bold',
      requiresSelection: true
    },
    
    // Italic commands - enhanced patterns
    {
      patterns: ['make this italic', 'italic this', 'make italic', 'italic', 'italicize this', 'make it italic', 'italic text'],
      action: (editor) => editor.chain().focus().toggleItalic().run(),
      description: 'Make selected text italic',
      requiresSelection: true
    },
    
    // Heading commands - enhanced patterns
    {
      patterns: ['heading one', 'heading 1', 'make heading one', 'h1', 'title', 'main heading', 'big heading'],
      action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      description: 'Convert to heading 1',
      requiresSelection: true
    },
    {
      patterns: ['heading two', 'heading 2', 'make heading two', 'h2', 'subtitle', 'subheading'],
      action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      description: 'Convert to heading 2',
      requiresSelection: true
    },
    {
      patterns: ['heading three', 'heading 3', 'make heading three', 'h3', 'small heading'],
      action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      description: 'Convert to heading 3',
      requiresSelection: true
    },
    
    // List commands - significantly enhanced
    {
      patterns: [
        'bullet list', 'bullet points', 'make bullet list', 'bulleted list', 'unordered list',
        'create list', 'make list', 'bullet', 'bullets', 'list items', 'itemize',
        'make this a list', 'convert to list', 'list format', 'bullet format'
      ],
      action: (editor) => editor.chain().focus().toggleBulletList().run(),
      description: 'Create bullet list',
      requiresSelection: true
    },
    {
      patterns: [
        'numbered list', 'number list', 'ordered list', 'make numbered list', 'numbered',
        'numbered points', 'number these', 'sequence', 'ordered points', 'numbered items',
        'make numbered', 'number format', 'sequential list'
      ],
      action: (editor) => editor.chain().focus().toggleOrderedList().run(),
      description: 'Create numbered list',
      requiresSelection: true
    },
    
    // Quote commands - enhanced
    {
      patterns: ['make quote', 'quote this', 'block quote', 'make this a quote', 'quotation', 'quote format', 'citation'],
      action: (editor) => editor.chain().focus().toggleBlockquote().run(),
      description: 'Convert to quote',
      requiresSelection: true
    },
    
    // Alignment commands - enhanced
    {
      patterns: ['center this', 'center align', 'align center', 'center text', 'make center'],
      action: (editor) => editor.chain().focus().setTextAlign('center').run(),
      description: 'Center align text',
      requiresSelection: true
    },
    {
      patterns: ['left align', 'align left', 'left text', 'make left'],
      action: (editor) => editor.chain().focus().setTextAlign('left').run(),
      description: 'Left align text',
      requiresSelection: true
    },
    {
      patterns: ['right align', 'align right', 'right text', 'make right'],
      action: (editor) => editor.chain().focus().setTextAlign('right').run(),
      description: 'Right align text',
      requiresSelection: true
    },
    
    // Paragraph commands - enhanced
    {
      patterns: ['normal text', 'make paragraph', 'regular text', 'paragraph', 'plain text', 'remove formatting'],
      action: (editor) => editor.chain().focus().setParagraph().run(),
      description: 'Convert to normal paragraph',
      requiresSelection: true
    },
    
    // Task list commands - enhanced
    {
      patterns: [
        'task list', 'todo list', 'checklist', 'make checklist', 'to do', 'tasks',
        'checkbox list', 'check list', 'action items', 'todo items', 'make tasks',
        'task format', 'checkbox format', 'checkable list'
      ],
      action: (editor) => editor.chain().focus().toggleTaskList().run(),
      description: 'Create task list',
      requiresSelection: true
    },

    // Additional formatting commands
    {
      patterns: ['underline', 'underline this', 'make underline', 'underlined'],
      action: (editor) => {
        // TipTap doesn't have built-in underline, use custom HTML mark or skip
        editor.chain().focus().run();
      },
      description: 'Make text underlined',
      requiresSelection: true
    },

    // Clear formatting
    {
      patterns: ['clear formatting', 'remove formatting', 'plain text', 'no formatting', 'reset format'],
      action: (editor) => editor.chain().focus().clearNodes().unsetAllMarks().run(),
      description: 'Clear all formatting',
      requiresSelection: true
    }
  ];

  // Streaming processing state
  private streamBuffer: string = '';
  private processingQueue: StreamingChunk[] = [];
  private isProcessingStream = false;
  private grokApiKey: string | null = null;

  constructor() {
    // Get Grok API key from environment (client-side)
    this.grokApiKey = typeof window !== 'undefined' 
      ? process.env.NEXT_PUBLIC_GROK_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || null
      : null;
    
    if (this.grokApiKey) {
      // console.log('🔑 Grok/OpenRouter API initialized for real-time voice processing');
      // console.log('🔍 API Key format check:', this.grokApiKey.substring(0, 10) + '...');
    } else {
      console.warn('⚠️ No API key found - set NEXT_PUBLIC_GROK_API_KEY or NEXT_PUBLIC_OPENROUTER_API_KEY');
      console.warn('📝 Falling back to pattern matching only');
    }
  }

  // Process streaming transcript chunks in real-time
  async processStreamingChunk(chunk: StreamingChunk, editor: Editor): Promise<boolean> {
    const startTime = performance.now();
    // console.log('🚀 Processing streaming chunk:', chunk);
    
    // Add to processing queue
    this.processingQueue.push(chunk);
    this.streamBuffer += chunk.text + ' ';

    // Process if we have enough content or if this seems like a complete phrase
    if (this.shouldProcessBuffer(chunk)) {
      const result = await this.processBufferedStream(editor);
      const endTime = performance.now();
      // console.log(`⚡ Streaming processing took ${endTime - startTime}ms`);
      return result;
    }

    return false;
  }

  private shouldProcessBuffer(chunk: StreamingChunk): boolean {
    // Optimized for speed - process more aggressively
    const wordCount = this.streamBuffer.trim().split(/\s+/).length;
    const endsWithPunctuation = /[.!?]$/.test(chunk.text.trim());
    const containsCommandKeywords = this.containsCommandKeywords(this.streamBuffer);
    const highConfidence = (chunk.confidence || 0) > 0.7; // Lowered threshold
    
    // More aggressive processing for speed
    const quickProcess = wordCount >= 2 && containsCommandKeywords;
    const standardProcess = wordCount >= 3;
    const immediateProcess = endsWithPunctuation || highConfidence;
    
    return quickProcess || standardProcess || immediateProcess;
  }

  private containsCommandKeywords(text: string): boolean {
    const keywords = [
      // Formatting keywords
      'bold', 'italic', 'heading', 'quote', 'center', 'align', 'underline',
      
      // List keywords - significantly enhanced
      'list', 'bullet', 'bullets', 'numbered', 'number', 'items', 'item',
      'points', 'checklist', 'todo', 'task', 'tasks', 'checkbox',
      'itemize', 'organize', 'sequence', 'ordered', 'unordered',
      
      // Action words for lists
      'create', 'make', 'convert', 'turn', 'format', 'change',
      
      // Specific list phrases
      'bullet list', 'bullet points', 'numbered list', 'task list',
      'todo list', 'check list', 'action items',
      
      // General formatting
      'paragraph', 'normal', 'clear', 'remove', 'formatting'
    ];
    
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword)) || 
           lowerText.includes('make this') || 
           lowerText.includes('make it') ||
           lowerText.includes('convert to') ||
           lowerText.includes('turn into') ||
           lowerText.includes('change to');
  }

  private async processBufferedStream(editor: Editor): Promise<boolean> {
    if (this.isProcessingStream || !this.streamBuffer.trim()) {
      return false;
    }

    this.isProcessingStream = true;
    
    try {
      // First try pattern matching for quick response
      const patternResult = await this.processPatternMatching(this.streamBuffer, editor);
      
      if (patternResult) {
        // In streaming mode, don't clear buffer completely - keep some context
        this.partialClearBuffer();
        return true;
      }

      // If no pattern match and we have Grok API, use streaming AI processing
      if (this.grokApiKey) {
        // Use grok-2 for consistent processing
        const model = 'grok-2'; // Use grok-2 alias which should work with both APIs
        // console.log(`🚀 Using ${model} for ultra-fast streaming processing`);
        
        const useFastMode = this.processingQueue.some(chunk => chunk.confidence && chunk.confidence < 0.9);
        const aiResult = await this.processWithGrokStreaming(this.streamBuffer, editor, useFastMode);
        if (aiResult) {
          // In streaming mode, keep some context for better processing
          this.partialClearBuffer();
          return true;
        }
      }

      // If buffer is getting too long without matches, clear it
      if (this.streamBuffer.length > 300) {
        this.clearBuffer();
      }

      return false;
    } finally {
      this.isProcessingStream = false;
    }
  }

  private async processPatternMatching(text: string, editor: Editor): Promise<boolean> {
    const normalizedText = text.toLowerCase().trim();
    const hasSelection = editor.state.selection.from !== editor.state.selection.to;
    
    if (hasSelection) {
      for (const command of this.commands) {
        for (const pattern of command.patterns) {
          if (normalizedText.includes(pattern)) {
            try {
              if (!editor.isFocused) {
                editor.commands.focus();
              }
              command.action(editor);
              // console.log('Pattern match executed:', pattern);
              return true;
            } catch (error) {
              console.error('Error executing voice command:', error);
              return false;
            }
          }
        }
      }
    }
    return false;
  }

  private async processWithGrokStreaming(text: string, editor: Editor, useFastMode: boolean = false): Promise<boolean> {
    if (!this.grokApiKey) {
      console.warn('❌ Grok API key not available');
      return false;
    }

    try {
      const content = editor.getText();
      const htmlContent = editor.getHTML();
      
      // Use correct Grok model names - grok-2 is the alias that works
      const model = 'grok-2'; // Use grok-2 alias which should work with both APIs
      // console.log(`🚀 Using ${model} for ultra-fast streaming processing`);
      // console.log(`📝 Processing command: "${text}"`);
      // console.log(`📄 Current content length: ${htmlContent.length} chars`);
      
      // Determine if we're using OpenRouter or direct xAI API
      const isOpenRouter = this.grokApiKey.startsWith('sk-or-');
      const apiUrl = isOpenRouter 
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.x.ai/v1/chat/completions';
      
      // console.log(`🌐 Using API: ${isOpenRouter ? 'OpenRouter' : 'xAI Direct'}`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.grokApiKey}`,
      };
      
      // Add OpenRouter specific headers if needed
      if (isOpenRouter) {
        headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title'] = 'Voice Command Editor';
      }
      
      // Optimize content for speed - limit input size
      const maxContentLength = 2000; // Limit to 2000 chars for speed
      const truncatedContent = htmlContent.length > maxContentLength 
        ? htmlContent.substring(0, maxContentLength) + '...'
        : htmlContent;
      
      const requestBody: any = {
        model: model,
        messages: [
          {
            role: 'system',
            content: `Ultra-fast voice command processor for TipTap rich text editing. Return ONLY properly formatted HTML.

FORMATTING RULES - APPLY DIRECTLY:
- Bold: <strong>text</strong>
- Italic: <em>text</em>
- Underline: <u>text</u>
- H1: <h1>text</h1>, H2: <h2>text</h2>, H3: <h3>text</h3>
- Bullet list: <ul><li>item 1</li><li>item 2</li></ul>
- Numbered list: <ol><li>item 1</li><li>item 2</li></ol>
- Quote: <blockquote><p>text</p></blockquote>
- Center align: <p style="text-align: center">text</p>
- Task list: <ul data-type="taskList"><li data-type="taskItem" data-checked="false">task</li></ul>

CONTEXT AWARENESS - CRITICAL:
When users provide an introduction followed by enumerated points, format the POINTS as lists, preserve the introduction.
- Look for patterns: "here are my X", "top 5", "these are", "steps to", etc.
- Identify enumeration: "first", "second", "one", "two", "number one", "next", etc.
- Keep introduction as paragraph, convert enumerated items to list items

SMART COMMANDS (work on entire document):
- "make everything bold" → wrap ALL content in <strong>
- "make title bold" → wrap first heading/line in <strong>
- "make this a bullet list" → convert paragraphs to <ul><li>items</li></ul>
- "create list" / "make list" → convert content to bullet list format
- "numbered list" → convert content to <ol><li>items</li></ol>
- "make heading" → convert first line to <h1>, <h2>, or <h3>
- "task list" / "checklist" → convert to task list format

CONTEXT EXAMPLES:
Input: "I'm a software engineer here are my top 5 learnings debugging testing code review documentation teamwork" + Command: "put in list"
Output: <p>I'm a software engineer, here are my top 5 learnings:</p><ul><li>debugging</li><li>testing</li><li>code review</li><li>documentation</li><li>teamwork</li></ul>

Input: "These are project tasks clean database update API fix bugs deploy" + Command: "bullet list"  
Output: <p>These are project tasks:</p><ul><li>clean database</li><li>update API</li><li>fix bugs</li><li>deploy</li></ul>

Input: "Steps to deploy first build app second run tests third check staging fourth deploy production" + Command: "numbered list"
Output: <p>Steps to deploy:</p><ol><li>build app</li><li>run tests</li><li>check staging</li><li>deploy production</li></ol>

LIST CREATION INTELLIGENCE:
- When user says "create list", "make list", "bullet list", convert text to proper list format
- Split content by periods, commas, line breaks, enumeration words, or natural separators
- Each item becomes a separate <li> element
- Preserve logical grouping and structure
- Handle natural speech patterns and filler words

SIMPLE EXAMPLES:
Input: "buy milk, get groceries, call mom" + Command: "make this a list"
Output: <ul><li>buy milk</li><li>get groceries</li><li>call mom</li></ul>

Input: "First item. Second item. Third item." + Command: "bullet list"
Output: <ul><li>First item</li><li>Second item</li><li>Third item</li></ul>

CONTEXT AWARENESS:
- Understand user intent from voice commands
- Handle variations like "items", "bullet points", "numbered", "checklist"
- Preserve important content while applying formatting
- Be smart about splitting text into logical list items
- Distinguish between introductory text and content to be formatted

RESPONSE: Return ONLY the updated HTML, no explanations or markdown.`
          },
          {
            role: 'user',
            content: `Command: "${text}"\nHTML: ${truncatedContent}`
          }
        ],
        temperature: 0, // Deterministic for speed
        max_tokens: 300, // Reduced from 500 for speed
        stream: true,
        // Speed optimizations
        top_p: 0.1, // More focused responses
        frequency_penalty: 0,
        presence_penalty: 0
      };
      
      // Use Grok's streaming API for real-time processing
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      // console.log(`📡 API Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ${isOpenRouter ? 'OpenRouter' : 'xAI'} API error ${response.status}:`, errorText);
        
        // Try to parse error for better debugging
        try {
          const errorJson = JSON.parse(errorText);
          console.error('📋 Detailed error:', errorJson);
          
          if (errorJson.error?.message) {
            toast.error(`API Error: ${errorJson.error.message}`);
          }
        } catch (e) {
          console.error('📋 Raw error response:', errorText);
        }
        
        throw new Error(`${isOpenRouter ? 'OpenRouter' : 'xAI'} API error: ${response.status} - ${errorText}`);
      }

      // Process streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let accumulatedResponse = '';
      const decoder = new TextDecoder();

      // console.log('🔄 Starting to process streaming response...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                accumulatedResponse += content;
                
                // Try to apply partial updates for immediate feedback
                if (this.isValidPartialHTML(accumulatedResponse)) {
                  this.applyPartialUpdate(accumulatedResponse, editor, htmlContent);
                }
              }
            } catch (e) {
              // Skip invalid JSON chunks
            }
          }
        }
      }

      // console.log('✅ Final response length:', accumulatedResponse.length);
      // console.log('📝 Response preview:', accumulatedResponse.substring(0, 200) + '...');

      // Apply final result with better validation
      if (accumulatedResponse && accumulatedResponse.trim() !== htmlContent.trim()) {
        // Clean up the response - remove any non-HTML content
        const cleanedResponse = this.cleanGrokResponse(accumulatedResponse);
        
        if (cleanedResponse && cleanedResponse !== htmlContent) {
          // console.log('🚀 Applying final result to editor...');
          editor.commands.setContent(cleanedResponse);
          // console.log('✅ Streaming command executed successfully');
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ Error with streaming:', error);
      
      // Show user-friendly error message
      if (error instanceof Error) {
        if (error.message.includes('401')) {
          toast.error('API authentication failed - check your API key');
        } else if (error.message.includes('429')) {
          toast.error('Rate limit exceeded - please wait a moment');
        } else if (error.message.includes('500')) {
          toast.error('API server error - please try again');
        } else {
          toast.error('Voice command failed - falling back to pattern matching');
        }
      }
      
      return false;
    }
  }

  private isValidPartialHTML(html: string): boolean {
    // Simplified validation for speed
    return html.length > 10 && html.includes('<') && html.includes('>');
  }

  private applyPartialUpdate(newHtml: string, editor: Editor, originalHtml: string): void {
    // More aggressive partial updates for speed
    if (newHtml.length > 20 && newHtml !== originalHtml) {
      try {
        editor.commands.setContent(newHtml);
      } catch (e) {
        // Ignore errors in partial updates for speed
      }
    }
  }

  private clearBuffer(): void {
    this.streamBuffer = '';
    this.processingQueue = [];
  }

  private partialClearBuffer(): void {
    // Keep the last few words for context in streaming mode
    const words = this.streamBuffer.trim().split(/\s+/);
    if (words.length > 5) {
      // Keep last 3 words for context
      this.streamBuffer = words.slice(-3).join(' ') + ' ';
    } else {
      // If buffer is small, clear it completely
      this.streamBuffer = '';
    }
    
    // Keep only recent chunks in the queue
    if (this.processingQueue.length > 5) {
      this.processingQueue = this.processingQueue.slice(-3);
    } else {
      this.processingQueue = [];
    }
  }

  // Legacy method for backward compatibility
  async processCommand(transcript: string, editor: Editor): Promise<boolean> {
    const chunk: StreamingChunk = {
      text: transcript,
      timestamp: Date.now(),
      confidence: 1.0
    };
    
    return await this.processStreamingChunk(chunk, editor);
  }

  // Real-time transcript processing from editor route
  async processTranscriptStream(
    transcriptChunks: string[], 
    editor: Editor,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // console.log('Processing transcript stream with', transcriptChunks.length, 'chunks');
    
    for (let i = 0; i < transcriptChunks.length; i++) {
      const chunk: StreamingChunk = {
        text: transcriptChunks[i],
        timestamp: Date.now() + i,
        confidence: 0.9
      };

      await this.processStreamingChunk(chunk, editor);
      
      // Report progress
      if (onProgress) {
        onProgress((i + 1) / transcriptChunks.length);
      }

      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  getAvailableCommands(): VoiceCommand[] {
    return this.commands;
  }

  getSupportedPhrases(): string[] {
    const patterns = this.commands.flatMap(cmd => cmd.patterns);
    const smartCommands = [
      // Smart document-level commands
      'make the title bold',
      'make the introduction bold', 
      'make the first paragraph bold',
      'make the first line bold',
      'turn the title into a heading',
      'make the first line a heading',
      'make the title a heading one',
      'make the title a heading two',
      'add bullet points to the list',
      'make everything a bullet list',
      'make all paragraphs bullet points',
      'center the title',
      'center the first line',
      'make the whole thing a quote',
      'quote everything',
      'make it all italic',
      'make the document a task list',
      
      // Context-aware commands
      'bold the heading',
      'italicize the introduction',
      'center align the title',
      'make the conclusion bold',
      'turn this into a numbered list',
      'convert to bullet points',
      'make this a quote block',
      'format as heading',
      'align everything center',
      
      // Natural language commands
      'I want this bold',
      'can you make this italic',
      'please make this a heading',
      'turn this into a list',
      'make this look like a quote',
      'center this text',
      'format this as a title'
    ];
    return [...patterns, ...smartCommands];
  }

  // Get current buffer state for debugging
  getBufferState(): { buffer: string; queueLength: number; isProcessing: boolean } {
    return {
      buffer: this.streamBuffer,
      queueLength: this.processingQueue.length,
      isProcessing: this.isProcessingStream
    };
  }

  private cleanGrokResponse(html: string): string {
    // Clean up the Grok response
    let cleaned = html.trim();
    
    // Remove any markdown code blocks if present
    cleaned = cleaned.replace(/```html\n?/g, '').replace(/```\n?/g, '');
    
    // Remove any explanatory text before or after HTML
    const htmlStart = cleaned.indexOf('<');
    const htmlEnd = cleaned.lastIndexOf('>');
    
    if (htmlStart !== -1 && htmlEnd !== -1 && htmlEnd > htmlStart) {
      cleaned = cleaned.substring(htmlStart, htmlEnd + 1);
    }
    
    // Basic HTML validation
    if (!cleaned.includes('<') || !cleaned.includes('>')) {
      console.warn('⚠️ Response does not contain valid HTML');
      return '';
    }
    
    console.log('🧹 Cleaned response:', cleaned.substring(0, 100) + '...');
    return cleaned;
  }
} 