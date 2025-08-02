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

export interface CommandPattern {
  regex: RegExp;
  action: string;
  priority: number;
}

export type CommandState = 'idle' | 'list' | 'heading' | 'paragraph';

export class EnhancedVoiceCommandProcessor {
  private commandState: CommandState = 'idle';
  private listBuffer: string[] = [];
  private listType: 'bullet' | 'numbered' | 'task' = 'bullet'; // Track the type of list being created
  private commandTimeout: NodeJS.Timeout | null = null;
  private lastCommandTime: number = 0;
  private grokApiKey: string | null = null;
  
  // Command patterns with priority matching
  private commandPatterns: CommandPattern[] = [
    { 
      regex: /create\s+(?:a\s+)?list\b/i, 
      action: 'start-list',
      priority: 1 
    },
    { 
      regex: /make\s+(?:a\s+|this\s+(?:a\s+)?)?list\b/i, 
      action: 'start-list',
      priority: 1 
    },
    { 
      regex: /(?:start|begin)\s+(?:a\s+)?list\b/i, 
      action: 'start-list',
      priority: 1 
    },
    { 
      regex: /(?:next|new)\s+item\b/i, 
      action: 'next-item',
      priority: 2 
    },
    { 
      regex: /(?:end|finish|complete)\s+(?:the\s+)?list\b/i, 
      action: 'end-list',
      priority: 1 
    },
    {
      regex: /create\s+(h[1-6]|heading)\s+(\d+)?/i,
      action: 'create-heading',
      priority: 1
    },
    {
      regex: /new\s+paragraph\b/i,
      action: 'new-paragraph',
      priority: 1
    },
    {
      regex: /bullet\s+(?:list|points?)\b/i,
      action: 'start-list',
      priority: 1
    },
    {
      regex: /numbered?\s+list\b/i,
      action: 'start-numbered-list',
      priority: 1
    },
    {
      regex: /task\s+list\b/i,
      action: 'start-task-list',
      priority: 1
    },
    {
      regex: /(?:turn|convert)\s+(?:this\s+)?(?:into|to)\s+(?:a\s+)?list\b/i,
      action: 'start-list',
      priority: 1
    }
  ];

  // Enhanced Grok prompt for command handling
  private readonly GROK_PROMPT = `You are a voice command processor for a rich text editor. Follow these rules:

1. STRUCTURE COMMANDS:
- When you hear list commands: "create list", "next item", "end list"
  - Return <ul><li>items</li></ul> when list is complete
  - Omit the command words from output

2. FORMATTING RULES:
- For headings: "create heading 2" → <h2>content</h2>
- Paragraph breaks: "new paragraph" → </p><p>

3. CONTEXT HANDLING:
- When preceded by list command, format ALL following content as list items
- For mid-sentence corrections: "change that to X" → replace previous item

4. OUTPUT REQUIREMENTS:
- ALWAYS return valid HTML fragments
- NEVER include command phrases in output
- Preserve non-command content exactly

Current editor context:
{{PREVIOUS_CONTENT}}

Voice input to process:
"{{TRANSCRIPT}}"`;

  constructor() {
    // Get Grok API key from environment
    this.grokApiKey = typeof window !== 'undefined' 
      ? process.env.NEXT_PUBLIC_GROK_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || null
      : null;
    
    if (this.grokApiKey) {
      console.log('🔑 Enhanced voice command processor initialized with Grok API');
    } else {
      console.warn('⚠️ No Grok API key found - using pattern matching only');
    }
  }

  async processTranscript(rawText: string, editor: Editor): Promise<string> {
    console.log('🎯 Processing transcript:', rawText);
    
    // 1. Command Detection Phase
    const commandResult = this.detectCommands(rawText);
    
    // 2. State Processing
    if (commandResult.commandFound && commandResult.commandType) {
      await this.handleCommandState({
        commandType: commandResult.commandType,
        cleanText: commandResult.cleanText,
        extractedData: commandResult.extractedData
      }, editor);
      return commandResult.cleanText;
    }
    
    // 3. Normal Text Processing
    return await this.processNormalText(rawText, editor);
  }

  private detectCommands(text: string): {
    commandFound: boolean;
    commandType: string | null;
    cleanText: string;
    extractedData?: any;
  } {
    let cleanText = text;
    let detectedCommand: string | null = null;
    let highestPriority = 0;
    let extractedData: any = {};

    console.log(`🔍 Detecting commands in: "${text}", current state: ${this.commandState}`);

    // If we're already in list mode, don't look for new commands - just treat everything as list content
    if (this.commandState === 'list') {
      console.log(`📋 Already in list mode - treating entire text as list content: "${text}"`);
      return {
        commandFound: false,
        commandType: null,
        cleanText: text,
        extractedData: {}
      };
    }

    // Check all patterns with priority handling
    this.commandPatterns.forEach(({ regex, action, priority }) => {
      const match = text.match(regex);
      if (match && priority >= highestPriority) {
        console.log(`✅ Found command: ${action} with pattern: ${regex} in text: "${text}"`);
        
        // For list commands, only use content that comes AFTER the command
        if (action.includes('list')) {
          // Find where the command ends and extract only the content after it
          const matchIndex = text.search(regex);
          const matchLength = match[0].length;
          const afterCommand = text.substring(matchIndex + matchLength).trim();
          
          console.log(`📝 List command detected - content after command: "${afterCommand}"`);
          
          // Only use content after the command, ignore everything before
          cleanText = afterCommand;
          console.log(`📋 Using only content after command: "${cleanText}"`);
        } else {
          // For non-list commands, use the original logic
          cleanText = text.replace(regex, '').trim();
        }
        
        detectedCommand = action;
        highestPriority = priority;
        
        // Extract additional data from regex groups
        if (action === 'create-heading' && match[2]) {
          extractedData.level = parseInt(match[2]);
        }
      }
    });

    const result = {
      commandFound: !!detectedCommand,
      commandType: detectedCommand,
      cleanText,
      extractedData
    };
    
    console.log(`🎯 Command detection result:`, result);
    return result;
  }

  // Helper method to determine if text looks like list content
  private isListContent(text: string): boolean {
    // Check if text contains common list indicators
    const listIndicators = [
      /,/,  // Contains commas
      /\d+\./,  // Contains numbered items (1. 2. etc)
      /^\s*[-•*]/m,  // Contains bullet points
      /\b(?:first|second|third|next|then|and|also)\b/i,  // Contains sequence words
      /\b(?:buy|schedule|go|pay|call|email|meeting|gym)\b/i,  // Contains action words
    ];
    
    return listIndicators.some(pattern => pattern.test(text));
  }

  private async handleCommandState(
    result: { commandType: string; cleanText: string; extractedData?: any },
    editor: Editor
  ) {
    this.resetCommandTimeout();
    
    console.log(`🎛️ Handling command: ${result.commandType}, state: ${this.commandState}`);
    
    switch (result.commandType) {
      case 'start-list':
        this.commandState = 'list';
        this.listType = 'bullet';
        this.listBuffer = [];
        if (result.cleanText) {
          // Parse the initial text for multiple items
          const initialItems = this.parseListItems(result.cleanText);
          this.listBuffer.push(...initialItems.filter(item => item.trim()));
        }
        this.showStatusMessage('🟢 Recording list items... Say "next item" for new items or "end list" to finish');
        break;
        
      case 'start-numbered-list':
        this.commandState = 'list';
        this.listType = 'numbered';
        this.listBuffer = [];
        if (result.cleanText) {
          const initialItems = this.parseListItems(result.cleanText);
          this.listBuffer.push(...initialItems.filter(item => item.trim()));
        }
        this.showStatusMessage('🟢 Recording numbered list items...');
        break;
        
      case 'start-task-list':
        this.commandState = 'list';
        this.listType = 'task';
        this.listBuffer = [];
        if (result.cleanText) {
          const initialItems = this.parseListItems(result.cleanText);
          this.listBuffer.push(...initialItems.filter(item => item.trim()));
        }
        this.showStatusMessage('🟢 Recording task list items...');
        break;
        
      case 'next-item':
        if (this.commandState === 'list' && result.cleanText) {
          const newItems = this.parseListItems(result.cleanText);
          this.listBuffer.push(...newItems.filter(item => item.trim()));
          this.showStatusMessage(`✅ Added ${newItems.length} item(s): "${newItems.join('", "')}"`);
        }
        break;
        
      case 'end-list':
        if (this.commandState === 'list' && this.listBuffer.length > 0) {
          await this.finalizeList(editor, this.listType);
          this.showStatusMessage(`✅ Created list with ${this.listBuffer.length} items`);
        }
        this.commandState = 'idle';
        break;
        
      case 'create-heading':
        this.commandState = 'heading';
        const level = result.extractedData?.level || 2;
        await this.applyHeading(result.cleanText, editor, level);
        break;
        
      case 'new-paragraph':
        this.commandState = 'paragraph';
        editor.chain().focus().createParagraphNear().run();
        break;
        
      default:
        this.commandState = 'idle';
    }
    
    this.lastCommandTime = Date.now();
    
    // Set timeout based on state - shorter for list items to auto-complete
    const timeoutDuration = this.commandState === 'list' ? 4000 : 3000; // 4 seconds for lists, 3 for others
    this.commandTimeout = setTimeout(() => {
      this.handleCommandTimeout(editor);
    }, timeoutDuration);
  }

  private async processNormalText(text: string, editor: Editor): Promise<string> {
    if (!text.trim()) return '';
    
    console.log(`📝 Processing text in ${this.commandState} state: "${text}"`);
    
    switch (this.commandState) {
      case 'list':
        // Parse text for multiple items (comma-separated, period-separated, etc.)
        const items = this.parseListItems(text);
        items.forEach(item => {
          if (item.trim()) {
            this.listBuffer.push(item.trim());
          }
        });
        
        console.log(`📋 Current list buffer:`, this.listBuffer);
        this.showStatusMessage(`📝 Added ${items.length} item(s): "${items.join('", "')}" (${this.listBuffer.length} total)`);
        
        // Reset the command timeout since we got new content
        this.resetCommandTimeout();
        this.lastCommandTime = Date.now();
        const timeoutDuration = 4000; // 4 seconds for lists
        this.commandTimeout = setTimeout(() => {
          console.log(`⏰ List timeout triggered - finalizing list`);
          this.handleCommandTimeout(editor);
        }, timeoutDuration);
        
        // CRITICAL: Return empty string and DO NOT insert anything into editor
        // The list will be inserted only when finalized
        return '';
        
      case 'heading':
        await this.applyHeading(text, editor);
        return ''; // Return empty string to indicate text was processed
        
      case 'paragraph':
        this.insertTextUnified(text, editor);
        this.commandState = 'idle';
        return ''; // Return empty string to indicate text was processed
        
      default:
        // If we have Grok API, enhance the text and insert it
        if (this.grokApiKey) {
          const enhanced = await this.enhanceWithGrok(text, editor);
          if (enhanced && enhanced !== text) {
            // Insert the enhanced text as unified text
            this.insertTextUnified(enhanced, editor);
            return ''; // Return empty string to indicate text was processed and inserted
          }
        }
        
        // Insert regular text as unified text (no separate paragraphs for chunks)
        this.insertTextUnified(text, editor);
        return ''; // Return empty string to indicate text was processed and inserted
    }
  }

  // Insert text in a unified way - append to current paragraph or create one if needed
  private insertTextUnified(text: string, editor: Editor): void {
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
  }

  // Parse text into individual list items
  private parseListItems(text: string): string[] {
    if (!text || !text.trim()) return [];
    
    // Remove common trailing words that aren't part of the content
    let cleanText = text.replace(/\s*(?:and|then|next|also|plus)\s*$/i, '').trim();
    
    // Remove trailing punctuation that's not part of content
    cleanText = cleanText.replace(/[.,;]\s*$/, '');
    
    // If the text is very short, just return it as one item
    if (cleanText.length < 3) {
      return cleanText ? [cleanText] : [];
    }
    
    // Check if this looks like multiple items (contains separators)
    const hasMultipleItems = /[,;]|\s+(?:and|then|next|also|plus)\s+/i.test(cleanText);
    
    if (hasMultipleItems) {
      // Split by common separators: commas, semicolons, "and", "then", etc.
      const items = cleanText.split(/[,;]|\s+(?:and|then|next|also|plus)\s+/i)
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .map(item => item.replace(/^\s*(?:and|then|next|also|plus)\s+/i, '')) // Remove leading connectors
        .map(item => item.replace(/[.,;]\s*$/, '')) // Remove trailing punctuation
        .filter(item => item.length > 0 && !this.isContextualPhrase(item)); // Filter out non-list content
      
      console.log(`📝 Split multiple items: "${cleanText}" → `, items);
      return items.length > 0 ? items : [cleanText];
    } else {
      // Single item - just clean it up and return
      if (!this.isContextualPhrase(cleanText)) {
        console.log(`📝 Single item: "${cleanText}"`);
        return [cleanText];
      } else {
        console.log(`📝 Filtered out contextual phrase: "${cleanText}"`);
        return [];
      }
    }
  }

  // Check if text looks like it contains list items (more sophisticated than isListContent)
  private looksLikeListItems(text: string): boolean {
    // Don't treat long sentences about personal context as list items
    if (text.length > 100 && !text.includes(',') && !text.includes(';')) {
      return false;
    }
    
    // Check for list indicators
    const hasCommas = text.includes(',');
    const hasSemicolons = text.includes(';');
    const hasActionWords = /\b(?:buy|schedule|go|pay|call|email|meeting|gym|book|cancel|clean|update|fix|deploy|test)\b/i.test(text);
    const hasSequenceWords = /\b(?:first|second|third|next|then|and also|plus)\b/i.test(text);
    
    return hasCommas || hasSemicolons || (hasActionWords && hasSequenceWords);
  }

  // Check if a phrase is contextual information rather than a list item
  private isContextualPhrase(text: string): boolean {
    const contextualPatterns = [
      /^I\s+(?:have|am|was|will)/i,  // Personal statements
      /^(?:As|Since|Because|When)\s+/i,  // Contextual beginnings
      /\b(?:software engineer|developer|working|been)\b/i,  // Professional context
      /^(?:Currently|Recently|Today|Yesterday)\s+/i,  // Time context
    ];
    
    return contextualPatterns.some(pattern => pattern.test(text));
  }

  private async finalizeList(editor: Editor, type: 'bullet' | 'numbered' | 'task' = 'bullet') {
    if (this.listBuffer.length === 0) return;
    
    console.log(`📋 Finalizing ${type} list with ${this.listBuffer.length} items:`, this.listBuffer);
    
    let listHTML = '';
    const cleanItems = this.listBuffer.map(item => this.cleanListItem(item));
    
    // Filter out empty or invalid items
    const validItems = cleanItems.filter(item => item && item.trim().length > 0);
    
    if (validItems.length === 0) {
      console.warn('⚠️ No valid list items to create');
      return;
    }
    
    switch (type) {
      case 'bullet':
        listHTML = `<ul>${validItems.map(item => `<li>${item}</li>`).join('')}</ul>`;
        break;
      case 'numbered':
        listHTML = `<ol>${validItems.map(item => `<li>${item}</li>`).join('')}</ol>`;
        break;
      case 'task':
        listHTML = `<ul data-type="taskList">${validItems.map(item => 
          `<li data-type="taskItem" data-checked="false">${item}</li>`
        ).join('')}</ul>`;
        break;
    }
    
    console.log(`📝 Inserting list HTML:`, listHTML);
    editor.chain().focus().insertContent(listHTML).run();
    
    // Clear the buffer and reset state
    this.listBuffer = [];
    this.commandState = 'idle';
    this.listType = 'bullet';
    
    console.log('✅ List finalized and state reset');
  }

  private cleanListItem(item: string): string {
    // Remove command artifacts and trailing connectors
    return item
      .replace(/\b(?:and|then|next|item|also|plus)\s*$/i, '')
      .replace(/^(?:and|then|next|also|plus)\s+/i, '')
      .trim();
  }

  private async applyHeading(text: string, editor: Editor, level: number = 2) {
    const levelMatch = text.match(/h(\d)/i);
    const headingLevel = levelMatch ? parseInt(levelMatch[1]) : level;
    const headingText = text.replace(/^h\d\s*/i, '').trim();
    
    if (headingText) {
      const clampedLevel = Math.max(1, Math.min(6, headingLevel)) as 1 | 2 | 3 | 4 | 5 | 6;
      editor.chain().focus().insertContent(`<h${clampedLevel}>${headingText}</h${clampedLevel}>`).run();
      console.log(`📝 Created heading level ${clampedLevel}: "${headingText}"`);
    }
    this.commandState = 'idle';
  }

  private async enhanceWithGrok(text: string, editor: Editor): Promise<string> {
    if (!this.grokApiKey) return text;
    
    try {
      const content = editor.getHTML();
      const prompt = this.GROK_PROMPT
        .replace('{{PREVIOUS_CONTENT}}', content)
        .replace('{{TRANSCRIPT}}', text);

      const isOpenRouter = this.grokApiKey.startsWith('sk-or-');
      const apiUrl = isOpenRouter 
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.x.ai/v1/chat/completions';
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.grokApiKey}`,
      };
      
      if (isOpenRouter) {
        headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title'] = 'Enhanced Voice Command Editor';
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'grok-2',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: text }
          ],
          temperature: 0.1,
          max_tokens: 200
        }),
      });

      if (!response.ok) {
        console.warn('Grok API error, falling back to plain text');
        return text;
      }

      const data = await response.json();
      const enhanced = data.choices?.[0]?.message?.content?.trim();
      
      // Only return enhanced text if it's actually different and not empty
      if (enhanced && enhanced !== text && enhanced.length > 0) {
        console.log('✨ Text enhanced by Grok');
        return enhanced;
      }
      
      return text;
    } catch (error) {
      console.warn('Error enhancing with Grok:', error);
      return text;
    }
  }

  private handleCommandTimeout(editor: Editor) {
    console.log(`⏰ Command timeout in state: ${this.commandState}`);
    
    if (this.commandState === 'list' && this.listBuffer.length > 0) {
      this.finalizeList(editor, this.listType);
      this.showStatusMessage(`⏰ Auto-completed list with ${this.listBuffer.length} items`);
    }
    this.commandState = 'idle';
  }

  private resetCommandTimeout() {
    if (this.commandTimeout) {
      clearTimeout(this.commandTimeout);
      this.commandTimeout = null;
    }
  }

  private showStatusMessage(message: string) {
    toast(message, { duration: 2000 });
  }

  // Fuzzy command matching for flexible voice recognition
  private fuzzyMatchCommand(transcript: string): string | null {
    const commands = ['list', 'heading', 'paragraph', 'item', 'end'];
    const words = transcript.toLowerCase().split(/\s+/);
    
    for (const word of words) {
      for (const cmd of commands) {
        if (this.levenshteinDistance(word, cmd) <= 2) {
          return cmd;
        }
      }
    }
    return null;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  // Public methods for external use
  public getCurrentState(): CommandState {
    return this.commandState;
  }

  public getListBuffer(): string[] {
    return [...this.listBuffer];
  }

  public forceEndCommand(editor: Editor) {
    this.handleCommandTimeout(editor);
  }

  public isListPending(): boolean {
    return this.commandState === 'list' && this.listBuffer.length > 0;
  }

  // Legacy method for backward compatibility
  async processCommand(transcript: string, editor: Editor): Promise<boolean> {
    const result = await this.processTranscript(transcript, editor);
    return result !== transcript; // Returns true if transcript was processed/modified
  }

  // Get available commands for help/documentation
  getAvailableCommands(): string[] {
    return [
      'create list - Start creating a bullet list',
      'next item - Add another item to the current list',
      'end list - Finish and insert the current list',
      'numbered list - Create a numbered list',
      'task list - Create a task/checklist',
      'create heading - Create a heading',
      'new paragraph - Start a new paragraph'
    ];
  }
} 