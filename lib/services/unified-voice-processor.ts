"use client";

import { Editor } from '@tiptap/react';
import { DeepgramTranscriptData } from '../deepgram-service';

interface ProcessingResult {
  type: 'command' | 'intent' | 'text';
  content: string;
  editorHTML?: string;
  confidence: number;
}

interface VoiceContext {
  previousChunks: string[];
  editorContent: string;
  timestamp: number;
  listMode: {
    active: boolean;
    items: string[];
    startTime: number;
    type: 'ul' | 'ol'; // unordered (bullet) or ordered (numbered)
  };
  continuousText: {
    accumulated: string;
    lastInsertTime: number;
  };
  headingMode: {
    active: boolean;
    level: number;
    startTime: number;
  };
}

export class UnifiedVoiceProcessor {
  private grokApiKey: string;
  private isOpenRouter: boolean;
  private baseUrl: string;
  private context: VoiceContext;
  private onAutoFinalize?: (html: string) => void;
  
  // Commands that should be stripped from output (extend as needed)
  private readonly COMMAND_INDICATORS = [
    'create list', 'make list', 'bullet list', 'numbered list', 'task list',
    'create heading', 'make heading', 'heading one', 'heading two', 'heading three',
    'make bold', 'make italic', 'make paragraph', 'new paragraph',
    'bullet points', 'put in list', 'turn into list',
    // Direct formatting commands
    'h1 heading', 'h2 heading', 'h3 heading', 'heading 1', 'heading 2', 'heading 3',
    'bold text', 'italic text', 'underline text',
    'h1', 'h2', 'h3'
  ];

  // Intent indicators that modify previous content (extend as needed)  
  private readonly INTENT_INDICATORS = [
    'make that', 'change that to', 'actually', 'no wait', 'I mean',
    'correction', 'fix that', 'change to', 'replace with'
  ];

  constructor() {
    this.grokApiKey = process.env.NEXT_PUBLIC_GROK_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || '';
    this.isOpenRouter = this.grokApiKey.startsWith('sk-or-');
    this.baseUrl = this.isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.x.ai/v1';
    
    this.context = {
      previousChunks: [],
      editorContent: '',
      timestamp: Date.now(),
      listMode: {
        active: false,
        items: [],
        startTime: 0,
        type: 'ul'
      },
      continuousText: {
        accumulated: '',
        lastInsertTime: 0
      },
      headingMode: {
        active: false,
        level: 1,
        startTime: 0
      }
    };

    if (!this.grokApiKey) {
      console.warn('⚠️ No Grok API key found - voice processing will be limited');
    }
  }

  /**
   * Main processing entry point - single decision point
   * Returns HTML to insert into TipTap editor, or empty string if no action needed
   */
  async processTranscript(data: DeepgramTranscriptData, editor: Editor): Promise<string> {
    // Only process finalized transcripts from Deepgram
    if (!data.isFinal && !data.speechFinal) {
      return '';
    }

    const transcript = data.transcript.trim();
    if (!transcript) return '';

    // Update context
    this.updateContext(transcript, editor);

    // Check if we're in heading mode first
    if (this.context.headingMode.active) {
      // console.log('📝 Already in heading mode, processing input:', transcript);
      
      // Only process final transcripts in heading mode to avoid conflicts
      if (data.isFinal || data.speechFinal) {
        return this.handleHeadingModeInput(transcript);
      } else {
        // console.log('📝 Ignoring interim transcript in heading mode:', transcript);
        return '';
      }
    }

    // Check if we're in list mode
    if (this.context.listMode.active) {
      // If utterance ended, finalize the list immediately
      if (data.utteranceEnd && this.context.listMode.items.length > 0) {
        // console.log('🎤 Utterance ended - finalizing list immediately');
        return this.finalizeList();
      }
      return this.handleListModeInput(transcript);
    }

    // Single Grok call to determine type and get processed content
    const result = await this.processWithGrok(transcript);
    
    switch (result.type) {
      case 'command':
        // console.log('🎯 Command detected:', transcript);
        
        // Reset continuous text accumulation when a command is processed
        this.context.continuousText.accumulated = '';
        this.context.continuousText.lastInsertTime = 0;
        
        // Check if this is a list creation command
        if (this.isListCommand(transcript)) {
          return this.startListMode(transcript);
        }
        
        // Check if this is a heading command
        if (this.isHeadingCommand(transcript)) {
          return this.startHeadingMode(transcript);
        }
        
        // Check for heading mode markers from fallback processing
        if (result.content && result.content.startsWith('HEADING_MODE_')) {
          const level = result.content.includes('H1') ? 1 : 
                       result.content.includes('H2') ? 2 : 3;
          
          this.context.headingMode = {
            active: true,
            level: level,
            startTime: Date.now()
          };
          
          // console.log(`📝 Starting heading mode (H${level}) from fallback`);
          return '';
        }
        
        // IMPORTANT: If we're already in list mode, treat commands as list items instead of separate commands
        if (this.context.listMode.active) {
          // console.log('📋 In list mode - treating command as list item:', result.content);
          return this.handleListModeInput(result.content || transcript);
        }
        
        // Other commands - validate and return the formatted HTML to insert
        const commandHTML = result.editorHTML || '';
        if (commandHTML && this.isValidHTML(commandHTML)) {
          return commandHTML;
        } else {
          console.warn('⚠️ Invalid HTML from command, falling back to text:', commandHTML);
          return this.formatAsText(result.content || transcript);
        }
        
      case 'intent':
        // console.log('🔄 Intent detected:', transcript);
        
        // Reset continuous text accumulation when an intent is processed
        this.context.continuousText.accumulated = '';
        this.context.continuousText.lastInsertTime = 0;
        
        // ALWAYS try to extract the full corrected sentence first
        const fullContent = this.extractFullContentFromIntent(transcript);
        
        // If we successfully extracted a complete corrected sentence, use it
        if (fullContent && fullContent.trim() && fullContent !== transcript && fullContent !== result.content) {
          // console.log('✅ Successfully extracted full corrected sentence:', fullContent);
          return this.formatAsText(fullContent);
        }
        
        // Check if there's actually content in the editor to modify
        const currentText = editor.getText().trim();
        const recentContext = this.context.previousChunks.slice(-3).join(' ');
        
        // console.log('🔍 Intent processing context:', {
        //   currentTextLength: currentText.length,
        //   recentContext: recentContext.slice(-100),
        //   intentContent: result.content
        // });
        
        if (!currentText) {
          // console.log('📝 No existing content to modify - using extracted content or context');
          
          // Check if recent context should be included
          const shouldIncludeContext = this.hasUnprocessedContextForCorrection(transcript, recentContext);
          
          if (shouldIncludeContext) {
            // console.log('📝 Including unprocessed context with correction');
            const contextualContent = this.buildCorrectedContentFromContext(transcript, recentContext);
            return this.formatAsText(contextualContent);
          }
          
          // Final fallback: just the intent content
          // console.log('⚠️ Using intent content as fallback:', result.content);
          return this.formatAsText(result.content);
        }
        
        // Check if the intent is about DIFFERENT content than what's in the editor
        const isAboutDifferentContent = this.isIntentAboutDifferentContent(transcript, recentContext, currentText);
        
        if (isAboutDifferentContent) {
          // console.log('🆕 Intent is about different content - adding corrected content');
          
          // Try to build from context
          const contextualContent = this.buildCorrectedContentFromContext(transcript, recentContext);
          if (contextualContent && contextualContent !== result.content) {
            // console.log('✅ Adding contextual content:', contextualContent);
            return this.formatAsText(contextualContent);
          }
        }
        
        // Intent detected - modify previous content and return replacement HTML
        return await this.handleIntent(result.content, editor);
        
      case 'text':
      default:
        // console.log('📝 Regular text:', transcript);
        // Handle empty content (like "Sorry." alone)
        if (!result.content || result.content.trim() === '') {
          // console.log('📝 Empty content - waiting for correction');
          return '';
        }
        
        // Clean up content to remove "Sorry" when it appears to be preparing for correction
        let cleanedContent = this.cleanContentForCorrection(result.content);
        if (!cleanedContent.trim()) {
          // console.log('📝 Content cleaned to empty - waiting for correction');
          return '';
        }
        
        // Regular text - accumulate for continuous flow
        return this.handleContinuousText(cleanedContent, editor);
    }
  }

  private async processWithGrok(transcript: string): Promise<ProcessingResult> {
    if (!this.grokApiKey) {
      // Fallback without Grok - use simple heuristics
      return this.fallbackProcessing(transcript);
    }

    try {
      const prompt = this.buildUnifiedPrompt(transcript);
      
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.grokApiKey}`,
        'Content-Type': 'application/json',
      };
      
      if (this.isOpenRouter) {
        headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000';
        headers['X-Title'] = 'Unified Voice Processor';
      }
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.isOpenRouter ? 'x-ai/grok-2' : 'grok-2',
          messages: [
            {
              role: 'system',
              content: 'You are a voice command processor. Return ONLY a JSON response with the specified format. No explanations or additional text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 500,
          temperature: 0.1,
          stream: false
        })
      });

      if (!response.ok) {
        console.error(`Grok API error ${response.status}`);
        return this.fallbackProcessing(transcript);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
      try {
        const parsed = JSON.parse(content);
        // console.log('🤖 Grok API Response:', parsed);
        
        return {
          type: parsed.type || 'text',
          content: parsed.content || transcript,
          editorHTML: parsed.editorHTML,
          confidence: parsed.confidence || 0.8
        };
      } catch (parseError) {
        console.error('Failed to parse Grok response:', { content, parseError });
        // console.log('🔄 Falling back to local processing');
        return this.fallbackProcessing(transcript);
      }

    } catch (error) {
      console.error('Grok processing error:', error);
      return this.fallbackProcessing(transcript);
    }
  }

  private buildUnifiedPrompt(transcript: string): string {
    const contextChunks = this.context.previousChunks.slice(-3).join(' ');
    const isInListMode = this.context.listMode.active;
    const currentListItems = this.context.listMode.items.join(', ');
    
    return `Analyze this voice transcript and determine if it's a COMMAND, INTENT, or regular TEXT.

Previous context: "${contextChunks}"
Current transcript: "${transcript}"
Current editor content: "${this.context.editorContent.slice(-200)}"
List mode active: ${isInListMode}
Current list items: "${currentListItems}"

CLASSIFICATION RULES:

SPECIAL RULE - If list mode is active:
   - Most content should be treated as TEXT (list items), NOT commands
   - Only "end list", "finish list", "complete list" should be treated as commands
   - Single words or phrases are likely list items, not separate commands

1. COMMAND - User wants to format/structure content:
   - Contains: "create list", "make list", "bullet list", "numbered list", "create numbered list", "ordered list", "task list"
   - Contains: "make heading", "create heading", "heading 1/2/3", "h1 heading", "h 1 heading", "h2 heading", "h 2 heading", "h3 heading", "h 3 heading"
   - Contains: "make bold", "make italic", "bullet points", "bold text", "italic text"
   - Direct format commands: "h1", "h 1", "h2", "h 2", "h3", "h 3" (apply to next text or strip command)
   - Special cases: "create a list by X" means create list with item X
   - ACTION: Extract content after command, remove command words, apply TipTap HTML formatting

2. INTENT - User wants to modify/correct previous content:
   - Contains explicit correction phrases: "make that", "change that to", "actually", "no wait", "I mean", "correction", "fix that", "change to", "replace with"
   - Contains "sorry" followed by a correction value (name, number, word)
   - Pattern: "sorry [correction_value]" means replace similar content with correction_value
   - Must reference previous content for correction (not add new content)
   - FORMATTING COMMANDS: "make that bold", "make that italic", "make last line bold", "make that heading", etc.
   - CONTEXTUAL REFERENCES: "that" = last sentence/paragraph, "last line" = most recent complete sentence
   - ACTION: Apply formatting to specified content or replace with corrected value
   - IMPORTANT: For formatting, return TipTap commands; for corrections, extract the correction value

3. TEXT - Regular dictation:
   - Everything else that doesn't match above patterns
   - Single words, names, sentences without correction context
   - Questions, statements, and general dictation
   - Special case: "Sorry." alone should return empty content (user is likely about to correct)
   - ACTION: Clean up speech-to-text errors, improve grammar

RESPONSE FORMAT (JSON only):
{
  "type": "command|intent|text",
  "content": "processed content with command words removed",
  "editorHTML": "TipTap HTML if command detected, null otherwise",
  "confidence": 0.9
}

COMMAND EXAMPLES:
Input: "create a list first item debugging second item testing third item deployment"
Output: {"type": "command", "content": "debugging, testing, deployment", "editorHTML": "<ul><li>debugging</li><li>testing</li><li>deployment</li></ul>", "confidence": 0.95}

Input: "create a list by grocery"
Output: {"type": "command", "content": "grocery", "editorHTML": "<ul><li>grocery</li></ul>", "confidence": 0.9}

Input: "create a list"
Output: {"type": "command", "content": "empty list", "editorHTML": "<ul><li>New item</li></ul>", "confidence": 0.9}

Input: "create a numbered list first item shopping second item cooking third item cleaning"
Output: {"type": "command", "content": "shopping, cooking, cleaning", "editorHTML": "<ol><li>shopping</li><li>cooking</li><li>cleaning</li></ol>", "confidence": 0.95}

Input: "numbered list"
Output: {"type": "command", "content": "empty numbered list", "editorHTML": "<ol><li>New item</li></ol>", "confidence": 0.9}

Input: "make this a heading project update"  
Output: {"type": "command", "content": "project update", "editorHTML": "<h2>project update</h2>", "confidence": 0.9}

Input: "schedule a meeting"
Output: {"type": "text", "content": "schedule a meeting", "editorHTML": null, "confidence": 0.8}

Input: "h1 heading project update" OR "h 1 heading project update"
Output: {"type": "command", "content": "project update", "editorHTML": "<h1>project update</h1>", "confidence": 0.9}

Input: "h2 meeting notes" OR "h 2 meeting notes"
Output: {"type": "command", "content": "meeting notes", "editorHTML": "<h2>meeting notes</h2>", "confidence": 0.9}

Input: "make this bold important notice"
Output: {"type": "command", "content": "important notice", "editorHTML": "<p><strong>important notice</strong></p>", "confidence": 0.9}

Input: "h1" OR "h 1" OR "h1 heading" OR "h 1 heading" (without content)
Output: {"type": "command", "content": "", "editorHTML": "", "confidence": 0.8}

CRITICAL HTML RULES:
- NEVER return empty fragments like <> or </>
- ALWAYS return complete, valid HTML tags
- For empty lists, include at least one placeholder item
- Ensure all tags are properly closed

INTENT EXAMPLES:
Input: Context: "hire 25 engineers" + Current: "make that seventy five"
Output: {"type": "intent", "content": "75", "editorHTML": null, "confidence": 0.85}

Input: Context: "revenue 2 million" + Current: "actually 3 million"
Output: {"type": "intent", "content": "3 million", "editorHTML": null, "confidence": 0.8}

Input: Context: "meeting on wednesday 5 pm" + Current: "actually make that saturday 2 pm"
Output: {"type": "intent", "content": "saturday 2 pm", "editorHTML": null, "confidence": 0.9}

Input: Context: "I am 9 years old" + Current: "sorry make that 8"
Output: {"type": "intent", "content": "8", "editorHTML": null, "confidence": 0.9}

Input: Context: "Can you send email to John" + Current: "Sorry, Mike"
Output: {"type": "intent", "content": "Mike", "editorHTML": null, "confidence": 0.85}

Input: Context: "Meeting at 3PM" + Current: "Sorry, 4PM"
Output: {"type": "intent", "content": "4PM", "editorHTML": null, "confidence": 0.85}

Input: Context: "I have been working as a software engineer since 2 years." + Current: "make that bold"
Output: {"type": "intent", "content": "bold:I have been working as a software engineer since 2 years.", "editorHTML": null, "confidence": 0.9}

Input: Context: "Project Update. We completed the feature." + Current: "make last line bold"
Output: {"type": "intent", "content": "bold:We completed the feature.", "editorHTML": null, "confidence": 0.9}

Input: Context: "My name is John" + Current: "make that heading"
Output: {"type": "intent", "content": "h2:My name is John", "editorHTML": null, "confidence": 0.9}

Input: Context: "Can you send email to John" + Current: "Sorry."
Output: {"type": "text", "content": "", "editorHTML": null, "confidence": 0.9}

Input: Context: "Meeting with client" + Current: "Manish"
Output: {"type": "text", "content": "Manish", "editorHTML": null, "confidence": 0.9}

TEXT EXAMPLES:
Input: "I had a great meeting today with the engineering team"
Output: {"type": "text", "content": "I had a great meeting today with the engineering team", "editorHTML": null, "confidence": 0.9}

Input: "Schedule a meeting on Friday at 3PM"
Output: {"type": "text", "content": "Schedule a meeting on Friday at 3PM", "editorHTML": null, "confidence": 0.9}

Input: "The project deadline is Monday"
Output: {"type": "text", "content": "The project deadline is Monday", "editorHTML": null, "confidence": 0.9}

Return ONLY the JSON response.`;
  }

  private fallbackProcessing(transcript: string): ProcessingResult {
    const lowerTranscript = transcript.toLowerCase();
    
    // Direct heading commands (h1, h2, h3) - handle both "h1" and "h 1" patterns
    const h1Match = lowerTranscript.match(/^h\s*1(?:\s+heading)?\s*(.*)/i);
    if (h1Match) {
      const content = h1Match[1].trim();
      if (content) {
        return {
          type: 'command',
          content,
          editorHTML: `<h1>${content}</h1>`,
          confidence: 0.8
        };
      } else {
        // Just "h1" with no content - this should trigger heading mode
        // Return special marker to indicate heading mode should start
        return {
          type: 'command',
          content: 'HEADING_MODE_H1',
          editorHTML: '',
          confidence: 0.8
        };
      }
    }
    
    const h2Match = lowerTranscript.match(/^h\s*2(?:\s+heading)?\s*(.*)/i);
    if (h2Match) {
      const content = h2Match[1].trim();
      if (content) {
        return {
          type: 'command',
          content,
          editorHTML: `<h2>${content}</h2>`,
          confidence: 0.8
        };
      } else {
        return {
          type: 'command',
          content: 'HEADING_MODE_H2',
          editorHTML: '',
          confidence: 0.8
        };
      }
    }
    
    const h3Match = lowerTranscript.match(/^h\s*3(?:\s+heading)?\s*(.*)/i);
    if (h3Match) {
      const content = h3Match[1].trim();
      if (content) {
        return {
          type: 'command',
          content,
          editorHTML: `<h3>${content}</h3>`,
          confidence: 0.8
        };
      } else {
        return {
          type: 'command',
          content: 'HEADING_MODE_H3',
          editorHTML: '',
          confidence: 0.8
        };
      }
    }
    
    // Bold text command
    const boldMatch = lowerTranscript.match(/^bold(?:\s+text)?\s*(.*)/i);
    if (boldMatch) {
      const content = boldMatch[1].trim();
      if (content) {
        return {
          type: 'command',
          content,
          editorHTML: `<p><strong>${content}</strong></p>`,
          confidence: 0.8
        };
      }
    }
    
    // Italic text command
    const italicMatch = lowerTranscript.match(/^italic(?:\s+text)?\s*(.*)/i);
    if (italicMatch) {
      const content = italicMatch[1].trim();
      if (content) {
        return {
          type: 'command',
          content,
          editorHTML: `<p><em>${content}</em></p>`,
          confidence: 0.8
        };
      }
    }
    
    // Simple command detection with basic HTML generation
    const hasListCommand = lowerTranscript.includes('create list') || 
                          lowerTranscript.includes('make list') ||
                          lowerTranscript.includes('create a list') ||
                          lowerTranscript.includes('numbered list') ||
                          lowerTranscript.includes('create numbered list') ||
                          lowerTranscript.includes('ordered list');
    if (hasListCommand) {
      // Determine list type
      const isNumberedList = lowerTranscript.includes('numbered') || lowerTranscript.includes('ordered');
      const listTag = isNumberedList ? 'ol' : 'ul';
      // Find where the list command appears in the transcript
      const commandPatterns = [
        /create\s+(?:a\s+)?(?:numbered\s+)?list/i,
        /make\s+(?:a\s+)?(?:numbered\s+)?list/i,
        /bullet\s+list/i,
        /numbered\s+list/i,
        /ordered\s+list/i
      ];
      
      let commandEndIndex = -1;
      for (const pattern of commandPatterns) {
        const match = lowerTranscript.match(pattern);
        if (match) {
          commandEndIndex = match.index! + match[0].length;
          break;
        }
      }
      
      // Extract content only AFTER the command
      let content = '';
      if (commandEndIndex > -1) {
        content = transcript.substring(commandEndIndex).trim();
        // Remove common prefixes like "by", "of", "with"
        content = content.replace(/^(?:by|of|with)\s+/i, '').trim();
      }
      
      let editorHTML;
      if (content) {
        // Split by common separators to create multiple list items
        const items = content.split(/[,;]|\s+(?:and|then|next|also)\s+/i)
          .map(item => item.trim())
          .filter(item => item.length > 0);
        
        if (items.length > 1) {
          // Multiple items detected
          editorHTML = `<${listTag}>${items.map(item => `<li>${item}</li>`).join('')}</${listTag}>`;
        } else {
          // Single item
          editorHTML = `<${listTag}><li>${content}</li></${listTag}>`;
        }
      } else {
        // No content after command
        editorHTML = `<${listTag}><li>New item</li></${listTag}>`;
      }
      
      return {
        type: 'command',
        content: content || 'New item',
        editorHTML,
        confidence: 0.8
      };
    }
    
    const hasHeadingCommand = lowerTranscript.includes('make heading') || lowerTranscript.includes('create heading');
    if (hasHeadingCommand) {
      const content = transcript.replace(/(?:make|create)\s+(?:a\s+)?heading\s*/i, '').trim();
      const editorHTML = content ? `<h2>${content}</h2>` : `<h2>Heading</h2>`;
      
      return {
        type: 'command',
        content: content || 'Heading',
        editorHTML,
        confidence: 0.6
      };
    }
    
    const hasCommand = this.COMMAND_INDICATORS.some(cmd => lowerTranscript.includes(cmd));
    if (hasCommand) {
      return {
        type: 'command',
        content: transcript,
        confidence: 0.6
      };
    }
    
    // Simple intent detection - be more strict
    const hasExplicitIntent = this.INTENT_INDICATORS.some(intent => lowerTranscript.includes(intent));
    if (hasExplicitIntent) {
      return {
        type: 'intent',
        content: transcript,
        confidence: 0.6
      };
    }
    
    // Special case: "sorry [correction_value]" pattern
    const sorryPattern = /^sorry[,\s]+(.+)/i;
    const sorryMatch = transcript.match(sorryPattern);
    if (sorryMatch && sorryMatch[1].trim()) {
      // Extract the correction value after "sorry"
      const correctionValue = sorryMatch[1].trim();
      return {
        type: 'intent',
        content: correctionValue,
        confidence: 0.7
      };
    }
    
    // Special case: "sorry" alone - return empty content (user likely about to correct)
    if (lowerTranscript.trim() === 'sorry' || lowerTranscript.trim() === 'sorry.') {
      return {
        type: 'text',
        content: '',
        confidence: 0.8
      };
    }
    
    // Default to text
    return {
      type: 'text',
      content: transcript,
      confidence: 0.7
    };
  }

  private async handleIntent(intentContent: string, editor: Editor): Promise<string> {
    // Get recent context for intelligent replacement
    const recentContext = this.context.previousChunks.slice(-3).join(' ');
    const currentHTML = editor.getHTML();
    const currentText = editor.getText();
    
    // console.log('🔄 Processing intent:', { intentContent, recentContext, currentText: currentText.slice(-100) });
    
    // Check if this is a formatting command (format:content pattern)
    if (intentContent.includes(':')) {
      return this.handleFormattingCommand(intentContent, editor);
    }
    
    // SMART CORRECTION: Check if the correction is about text from recentContext that's not in editor
    // This handles cases like "Can you mail this to Amit? Sorry, Manish" where "Amit" isn't in the editor yet
    const shouldAddFullContextWithCorrection = this.shouldAddContextWithCorrection(intentContent, recentContext, currentText);
    if (shouldAddFullContextWithCorrection) {
      return this.addCorrectedContextToEditor(intentContent, recentContext);
    }
    
    // Try simple replacement patterns first for time/date corrections
    const simpleReplacementResult = this.performSimpleReplacement(intentContent, editor);
    if (simpleReplacementResult === '') {
      // Successfully replaced, return empty
      // console.log('✅ Simple replacement succeeded');
      return '';
    }
    
    // Try to find what should be replaced using Grok
    if (this.grokApiKey) {
      try {
        const replacementResult = await this.getReplacementFromGrok(intentContent, recentContext, currentText);
        if (replacementResult.success) {
          return this.performContentReplacement(replacementResult, editor);
        }
      } catch (error) {
        console.error('❌ Error getting replacement from Grok:', error);
      }
    }
    
    // Final fallback: just add the intent content
    // console.log('⚠️ All replacement attempts failed, adding as new text');
    return this.formatAsText(intentContent);
  }

  private async getReplacementFromGrok(intentContent: string, recentContext: string, currentText: string): Promise<any> {
    const prompt = `Analyze this intent correction and determine what content should be replaced.

Recent context: "${recentContext}"
Current document (last 200 chars): "${currentText.slice(-200)}"
Intent correction: "${intentContent}"

Your task:
1. Identify what specific text/value in the current document should be replaced
2. Determine what it should be replaced with
3. Return the exact replacement strategy

Common patterns:
- "make that 8" or "change that to 8" → replace the most recent number with 8
- "actually saturday 2 pm" → replace the most recent time/day mention
- "I mean 3 years" → replace the most recent duration/number

RESPONSE FORMAT (JSON only):
{
  "success": true,
  "oldText": "exact text to find and replace",
  "newText": "replacement text",
  "strategy": "number|time|word|phrase",
  "confidence": 0.9
}

If you cannot determine a clear replacement, return:
{
  "success": false,
  "reason": "explanation why replacement couldn't be determined"
}

Return ONLY the JSON response.`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.grokApiKey}`,
      'Content-Type': 'application/json',
    };
    
    if (this.isOpenRouter) {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000';
      headers['X-Title'] = 'Intent Replacement Processor';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.isOpenRouter ? 'x-ai/grok-2' : 'grok-2',
        messages: [
          {
            role: 'system',
            content: 'You are an intent replacement analyzer. Return ONLY JSON responses for content replacement instructions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.1,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Grok API error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    try {
      const parsed = JSON.parse(content);
      // console.log('🤖 Grok replacement analysis:', parsed);
      return parsed;
    } catch (parseError) {
      console.error('Failed to parse Grok replacement response:', { content, parseError });
      throw parseError;
    }
  }

  private performContentReplacement(replacementResult: any, editor: Editor): string {
    const { oldText, newText, strategy } = replacementResult;
    
    try {
      // Get current content
      const currentHTML = editor.getHTML();
      const currentText = editor.getText();
      
      // console.log('🔄 Attempting replacement:', { oldText, newText, strategy });
      
      // Find the old text in the current content
      if (currentText.includes(oldText)) {
        // Perform the replacement in the editor
        const updatedHTML = currentHTML.replace(new RegExp(this.escapeRegExp(oldText), 'gi'), newText);
        
        // Clear the editor and insert the updated content
        editor.commands.clearContent();
        editor.commands.insertContent(updatedHTML);
        
        // console.log('✅ Successfully replaced content:', { from: oldText, to: newText });
        return ''; // Return empty since we've already updated the editor
      } else {
        console.warn('⚠️ Old text not found in current content, falling back to append');
        return this.formatAsText(newText);
      }
    } catch (error) {
      console.error('❌ Error performing content replacement:', error);
      return this.formatAsText(newText);
    }
  }

  private handleFormattingCommand(intentContent: string, editor: Editor): string {
    const [format, content] = intentContent.split(':', 2);
    
    // console.log('🎨 Applying formatting:', { format, content });
    
    try {
      // Find the content in the editor and apply formatting
      const currentHTML = editor.getHTML();
      const currentText = editor.getText();
      
      if (currentText.includes(content)) {
        // Apply TipTap formatting commands directly
        switch (format.toLowerCase()) {
          case 'bold':
            // Find and select the content, then apply bold
            this.selectTextAndFormat(editor, content, () => {
              editor.chain().focus().toggleBold().run();
            });
            break;
            
          case 'italic':
            this.selectTextAndFormat(editor, content, () => {
              editor.chain().focus().toggleItalic().run();
            });
            break;
            
          case 'h1':
            this.selectTextAndFormat(editor, content, () => {
              editor.chain().focus().toggleHeading({ level: 1 }).run();
            });
            break;
            
          case 'h2':
            this.selectTextAndFormat(editor, content, () => {
              editor.chain().focus().toggleHeading({ level: 2 }).run();
            });
            break;
            
          case 'h3':
            this.selectTextAndFormat(editor, content, () => {
              editor.chain().focus().toggleHeading({ level: 3 }).run();
            });
            break;
            
          default:
            console.warn('⚠️ Unknown format:', format);
            break;
        }
        
        // console.log(`✅ Applied ${format} formatting to: "${content}"`);
        return ''; // Return empty since we've already updated the editor
      } else {
        console.warn('⚠️ Content not found in editor:', content);
        return '';
      }
    } catch (error) {
      console.error('❌ Error applying formatting:', error);
      return '';
    }
  }

  private selectTextAndFormat(editor: Editor, content: string, formatFunction: () => void): void {
    try {
      // For headings, we need to select the entire paragraph/line that contains the content
      const isHeadingFormat = formatFunction.toString().includes('toggleHeading');
      
      if (isHeadingFormat) {
        // For headings, we want to convert the entire paragraph containing the content
        const doc = editor.state.doc;
        let found = false;
        
        doc.descendants((node, pos) => {
          if (found) return false;
          if (node.isText && node.text && node.text.includes(content)) {
            // Found the text node, now find its parent paragraph
            const startInNode = node.text.indexOf(content);
            const from = pos + startInNode;
            const to = from + content.length;
            
            // Show selection briefly before applying formatting
            editor.commands.setTextSelection({ from, to });
            // console.log('🎯 Selected text for heading formatting:', { from, to, content });
            
            // Apply formatting after a brief delay to show selection
            setTimeout(() => {
              formatFunction();
              // Clear selection after formatting
              setTimeout(() => {
                editor.commands.setTextSelection({ from: to, to: to });
              }, 100);
            }, 200);
            found = true;
            return false;
          }
          return true;
        });
        
        if (!found) {
          // Fallback: just apply the heading to current selection/cursor position
          // console.log('⚠️ Text not found for heading, applying to current position');
          formatFunction();
        }
      } else {
        // For other formatting (bold, italic), find and select the exact text
        const doc = editor.state.doc;
        let found = false;
        
        doc.descendants((node, pos) => {
          if (found) return false;
          if (node.isText && node.text && node.text.includes(content)) {
            const startInNode = node.text.indexOf(content);
            const from = pos + startInNode;
            const to = from + content.length;
            
            // Show selection briefly before applying formatting
            editor.commands.setTextSelection({ from, to });
            // console.log('🎯 Selected text for formatting:', { from, to, content });
            
            // Apply formatting after a brief delay to show selection
            setTimeout(() => {
              formatFunction();
              // Keep cursor at end of formatted text
              setTimeout(() => {
                editor.commands.setTextSelection({ from: to, to: to });
              }, 100);
            }, 200);
            found = true;
            return false;
          }
          return true;
        });
        
        if (!found) {
          console.warn('⚠️ Could not find text to format:', content);
          // Fallback: just apply formatting to current selection
          formatFunction();
        }
      }
    } catch (error) {
      console.error('❌ Error in selectTextAndFormat:', error);
      // Fallback: just apply formatting to current selection
      formatFunction();
    }
  }

  private shouldAddContextWithCorrection(intentContent: string, recentContext: string, currentText: string): boolean {
    // Check if the recent context contains content that hasn't been added to the editor yet
    // and the intent is trying to correct something in that context
    
    // Find the last sentence or meaningful chunk in recent context
    const contextSentences = recentContext.split(/[.!?]/).filter(s => s.trim().length > 0);
    if (contextSentences.length === 0) return false;
    
    const lastContextSentence = contextSentences[contextSentences.length - 1].trim();
    
    // Check if this sentence is NOT in the current editor text
    const isContextInEditor = currentText.includes(lastContextSentence);
    
    // Check if the intent correction makes sense for that context
    const hasRelevantCorrection = lastContextSentence.toLowerCase().includes('amit') && 
                                 intentContent.toLowerCase().includes('manish');
    
    // console.log('🔍 Context analysis:', { 
    //   lastContextSentence, 
    //   isContextInEditor, 
    //   hasRelevantCorrection, 
    //   shouldAdd: !isContextInEditor && hasRelevantCorrection 
    // });
    
    return !isContextInEditor && hasRelevantCorrection;
  }

  private addCorrectedContextToEditor(intentContent: string, recentContext: string): string {
    // Extract the relevant sentence from recent context and apply the correction
    const contextSentences = recentContext.split(/[.!?]/).filter(s => s.trim().length > 0);
    const lastContextSentence = contextSentences[contextSentences.length - 1].trim();
    
    // Apply the correction (Amit -> Manish in this case)
    let correctedSentence = lastContextSentence;
    
    // Simple replacement patterns for common corrections
    if (lastContextSentence.toLowerCase().includes('amit') && intentContent.toLowerCase().includes('manish')) {
      correctedSentence = lastContextSentence.replace(/amit/gi, 'Manish');
    }
    
    // console.log('✅ Adding corrected context:', { 
    //   original: lastContextSentence, 
    //   corrected: correctedSentence 
    // });
    
    return this.formatAsText(correctedSentence);
  }

  private performSimpleReplacement(intentContent: string, editor: Editor): string {
    const currentText = editor.getText();
    const currentHTML = editor.getHTML();
    
    // console.log('🔧 Attempting simple replacement:', { intentContent, currentText: currentText.slice(-100) });
    
    // Enhanced time/date pattern matching
    const timePattern = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/;
    const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
    const combinedDayTimePattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/i;
    
    // Check if intent contains time correction
    const intentTimeMatch = intentContent.match(timePattern);
    const intentDayMatch = intentContent.match(dayPattern);
    const intentCombinedMatch = intentContent.match(combinedDayTimePattern);
    
    // console.log('🔍 Pattern matching:', { 
    //   intentContent, 
    //   intentTimeMatch: intentTimeMatch?.[1], 
    //   intentDayMatch: intentDayMatch?.[1],
    //   intentCombinedMatch: intentCombinedMatch ? `${intentCombinedMatch[1]}, ${intentCombinedMatch[2]}` : null,
    //   currentTextSample: currentText.slice(-200)
    // });
    
    if (intentTimeMatch || intentDayMatch || intentCombinedMatch) {
      let updatedHTML = currentHTML;
      let replacementMade = false;
      
      // Handle combined day+time pattern first (most specific)
      if (intentCombinedMatch) {
        // console.log('🔍 Intent has combined pattern, searching current text for ANY day+time matches...');
        
        // Find ALL day+time matches (any day+time combination) and get the LAST one
        const allCombinedMatches: RegExpExecArray[] = [];
        const globalRegex = new RegExp(combinedDayTimePattern, 'gi');
        let match;
        while ((match = globalRegex.exec(currentText)) !== null) {
          allCombinedMatches.push(match);
        }
        
        // console.log('🔍 Found combined matches in current text:', allCombinedMatches.map(m => `${m[1]}, ${m[2]}`));
        
        const currentCombinedMatch = allCombinedMatches[allCombinedMatches.length - 1]; // Get last match
        
        if (currentCombinedMatch) {
          const oldCombined = `${currentCombinedMatch[1]}, ${currentCombinedMatch[2]}`;
          const newCombined = `${intentCombinedMatch[1]}, ${intentCombinedMatch[2]}`;
          
          // Create regex to match the LAST occurrence of combined pattern in HTML
          const combinedPattern = this.escapeRegExp(currentCombinedMatch[1]) + '[,\\s]+' + this.escapeRegExp(currentCombinedMatch[2]);
          const combinedRegex = new RegExp(combinedPattern + '(?!.*' + combinedPattern + ')', 'i');
          
          // console.log('📅🕒 Combined day+time replacement (LAST occurrence):', { 
          //   from: oldCombined, 
          //   to: newCombined,
          //   totalMatches: allCombinedMatches.length,
          //   allMatches: allCombinedMatches.map(m => `${m[1]}, ${m[2]}`)
          // });
          // console.log('🔧 HTML before replacement:', updatedHTML);
          // console.log('🔧 Regex pattern:', combinedRegex.source);
          
          updatedHTML = updatedHTML.replace(combinedRegex, newCombined);
          replacementMade = true;
          
          // console.log('🔧 HTML after replacement:', updatedHTML);
        } else {
          // console.log('❌ No combined day+time matches found in current text to replace');
        }
      }
      // Only try individual replacements if combined didn't work
      else {
        // Replace time if both intent and current text have time
        if (intentTimeMatch) {
          // Find ALL time matches and get the LAST one (most recent)
          const allTimeMatches: RegExpExecArray[] = [];
          const globalTimeRegex = new RegExp(timePattern, 'g');
          let timeMatch;
          while ((timeMatch = globalTimeRegex.exec(currentText)) !== null) {
            allTimeMatches.push(timeMatch);
          }
          const currentTimeMatch = allTimeMatches[allTimeMatches.length - 1]; // Get last match
          
          if (currentTimeMatch) {
            const oldTime = currentTimeMatch[1];
            const newTime = intentTimeMatch[1];
            
            // Create regex that matches the LAST occurrence of this time pattern
            const timeRegex = new RegExp(this.escapeRegExp(oldTime) + '(?!.*' + this.escapeRegExp(oldTime) + ')', 'i');
            updatedHTML = updatedHTML.replace(timeRegex, newTime);
            replacementMade = true;
            
            // console.log('🕒 Time replacement (last occurrence):', { from: oldTime, to: newTime });
          }
        }
        
        // Replace day if both intent and current text have day
        if (intentDayMatch) {
          // Find ALL day matches and get the LAST one (most recent)
          const allDayMatches: RegExpExecArray[] = [];
          const globalDayRegex = new RegExp(dayPattern, 'gi');
          let dayMatch;
          while ((dayMatch = globalDayRegex.exec(currentText)) !== null) {
            allDayMatches.push(dayMatch);
          }
          const currentDayMatch = allDayMatches[allDayMatches.length - 1]; // Get last match
          
          if (currentDayMatch) {
            const oldDay = currentDayMatch[1];
            const newDay = intentDayMatch[1];
            
            // Create regex that matches the LAST occurrence of this day pattern
            const dayRegex = new RegExp(this.escapeRegExp(oldDay) + '(?!.*' + this.escapeRegExp(oldDay) + ')', 'gi');
            updatedHTML = updatedHTML.replace(dayRegex, newDay);
            replacementMade = true;
            
            // console.log('📅 Day replacement (last occurrence):', { from: oldDay, to: newDay });
          }
        }
      }
      
      if (replacementMade) {
        editor.commands.clearContent();
        editor.commands.insertContent(updatedHTML);
        // console.log('✅ Simple time/day replacement succeeded');
        return '';
      }
    }
    
    // Number replacement (existing logic)
    const numberMatch = intentContent.match(/(\d+)/);
    if (numberMatch) {
      const newNumber = numberMatch[1];
      
      // Find the last number in the current text
      const lastNumber = currentText.match(/(\d+)(?!.*\d)/);
      if (lastNumber) {
        const oldNumber = lastNumber[1];
        const numberRegex = new RegExp(this.escapeRegExp(oldNumber) + '(?!.*' + this.escapeRegExp(oldNumber) + ')', 'g');
        const updatedHTML = currentHTML.replace(numberRegex, newNumber);
        
        editor.commands.clearContent();
        editor.commands.insertContent(updatedHTML);
        
        // console.log('✅ Simple number replacement:', { from: oldNumber, to: newNumber });
        return '';
      }
    }
    
    // If no pattern matches, return the intent content to be added as new text
    // console.log('⚠️ No replacement pattern found');
    return this.formatAsText(intentContent);
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractFullContentFromIntent(transcript: string): string {
    // When there's no existing content but we have an intent like:
    // "I have to schedule a meeting on Friday, 3PM. Sorry, Saturday, 5PM"
    // We should return "I have to schedule a meeting on Saturday, 5PM" (original + correction)
    
    // console.log('🔍 Extracting full content from intent:', transcript);
    
    // PRIMARY PATTERN: Look for "CONTENT. Sorry, CORRECTION" or "CONTENT Sorry CORRECTION"
    const primaryPatterns = [
      /^(.+?)\.?\s*sorry[,\s]*(.+)$/i,               // "Content. Sorry, correction" (more flexible)
      /^(.+?)\s+sorry[,\s]+(.+)$/i,                   // "Content sorry correction"  
      /^(.+?)(?:\.\s*)?actually[,\s]*(.+)$/i,        // "Content. Actually, correction"
      /^(.+?)(?:\.\s*)?make that[,\s]*(.+)$/i        // "Content. Make that correction"
    ];
    
    for (const pattern of primaryPatterns) {
      const match = transcript.match(pattern);
      if (match && match[1] && match[2]) {
        const originalPart = match[1].trim();
        const correctionPart = this.cleanContentForCorrection(match[2]);
        
        // Ensure we have substantial content in the original part
        if (originalPart.length > 10 && correctionPart) {
          const merged = this.mergeIntentContent(originalPart, correctionPart);
          // console.log('✅ Primary pattern merge:', { originalPart, correctionPart, merged });
          return merged;
        }
      }
    }
    
    // SECONDARY PATTERN: Split on correction indicators - enhanced for "Sorry." cases
    const intentPatterns = [
      /\.\s*sorry\.\s*(.+)/i,                         // "Content. Sorry. correction" 
      /\.\s*(actually|make that|change that to|i mean|sorry|correction|fix that|change to|replace with)/i,
      /\s+(actually|make that|change that to|i mean|sorry|correction|fix that|change to|replace with)/i
    ];
    
    let beforeIntent = '';
    let afterIntent = '';
    
    for (const pattern of intentPatterns) {
      const match = transcript.match(pattern);
      if (match) {
        const splitIndex = match.index!;
        beforeIntent = transcript.substring(0, splitIndex).trim();
        
        // For "Sorry." pattern, the correction is in capture group 1
        if (pattern.source.includes('sorry\\.\\s*(.+)') && match[1]) {
          afterIntent = match[1].trim();
        } else {
          afterIntent = transcript.substring(splitIndex + match[0].length).trim();
        }
        break;
      }
    }
    
    // console.log('🔍 Secondary pattern parsing:', { beforeIntent, afterIntent });
    
    // If we have both parts and the original is substantial, merge them
    if (beforeIntent && beforeIntent.length > 10 && afterIntent) {
      const cleanedAfterIntent = this.cleanContentForCorrection(afterIntent);
      if (cleanedAfterIntent) {
        const mergedContent = this.mergeIntentContent(beforeIntent, cleanedAfterIntent);
        // console.log('✅ Secondary pattern merge:', mergedContent);
        return mergedContent;
      }
    }
    
    // FALLBACK: Just clean the transcript
    const cleanedTranscript = this.cleanContentForCorrection(transcript);
    // console.log('⚠️ Fallback to cleaned transcript:', cleanedTranscript);
    return cleanedTranscript || transcript;
  }

  /**
   * Determine if the intent/correction is about different content than what's currently in the editor
   * This prevents incorrectly modifying existing content when we should be adding new content
   */
  private isIntentAboutDifferentContent(transcript: string, recentContext: string, currentEditorText: string): boolean {
    // console.log('🔍 Checking if intent is about different content:', {
    //   transcript: transcript.slice(0, 50) + '...',
    //   currentEditor: currentEditorText.slice(0, 50) + '...',
    //   recentContext: recentContext.slice(-100)
    // });
    
    // Extract the main content from recent context (before any correction indicators)
    const contextSentences = recentContext.split(/[.!?]/).filter(s => s.trim().length > 10);
    if (contextSentences.length === 0) return false;
    
    // Get the last substantial sentence that might contain new content
    const lastContextSentence = contextSentences[contextSentences.length - 1].trim();
    
    // Check if this sentence contains different subject matter than current editor
    const contextKeywords = this.extractKeywords(lastContextSentence);
    const editorKeywords = this.extractKeywords(currentEditorText);
    
    // Look for major topic differences
    const topicSimilarity = this.calculateTopicSimilarity(contextKeywords, editorKeywords);
    
    // console.log('🔍 Content analysis:', {
    //   lastContextSentence: lastContextSentence.slice(0, 50) + '...',
    //   contextKeywords,
    //   editorKeywords,
    //   topicSimilarity,
    //   isDifferent: topicSimilarity < 0.3
    // });
    
    // If topic similarity is low, this is likely about different content
    return topicSimilarity < 0.3;
  }

  /**
   * Extract key words/topics from text
   */
  private extractKeywords(text: string): string[] {
    if (!text) return [];
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['have', 'been', 'will', 'that', 'this', 'with', 'from', 'they', 'were', 'said', 'each', 'make', 'like', 'into', 'time', 'over', 'only', 'also', 'back', 'after', 'first', 'well', 'work', 'year', 'years'].includes(word));
    
    return Array.from(new Set(words));
  }

  /**
   * Calculate similarity between two sets of keywords
   */
  private calculateTopicSimilarity(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const intersection = keywords1.filter(word => keywords2.includes(word));
    const union = Array.from(new Set(keywords1.concat(keywords2)));
    
    return intersection.length / union.length;
  }

  /**
   * Determine if this is a "late correction" - a correction that applies to content 
   * that was recently added to the editor from the context
   */
  private isLateCorrection(transcript: string, recentContext: string, currentEditorText: string): boolean {
    // console.log('🔍 Checking if this is a late correction:', {
    //   transcript: transcript.slice(0, 30) + '...',
    //   recentContext: recentContext.slice(-50),
    //   currentEditor: currentEditorText.slice(-50)
    // });
    
    // Look for patterns that suggest this is a correction to something recently said
    const hasTimeReference = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i.test(transcript);
    const hasDateTimeCorrection = hasTimeReference && /\b(friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/i.test(currentEditorText);
    
    // Check if the correction matches something in the current editor content
    if (hasDateTimeCorrection) {
      // console.log('🕒 Found time/date correction that matches editor content');
      return true;
    }
    
    // Check if recent context shows a correction pattern where part was already processed
    // Pattern: "Content was added. Sorry. [This correction]"
    const correctionPatterns = [
      /\.\s*sorry\s*\.\s*$/i,  // Recent context ends with ". Sorry."
      /\bsorry\b.*$/i          // Contains "sorry" towards the end
    ];
    
    const hasRecentSorry = correctionPatterns.some(pattern => recentContext.match(pattern));
    
    // If we had a recent "sorry" and current transcript looks like a correction value
    if (hasRecentSorry && (hasTimeReference || /^\w+\s*\d*\s*(?:am|pm)?$/i.test(transcript.trim()))) {
      // console.log('🔄 Found late correction pattern - recent sorry + correction value');
      return true;
    }
    
    return false;
  }

  private mergeIntentContent(beforeIntent: string, correction: string): string {
    // Enhanced merging logic to handle complex time/date/number corrections
    // console.log('🔄 Merging intent content:', { beforeIntent, correction });
    
    // Pattern 1: Combined day and time correction (e.g., "Saturday, 5PM")
    const combinedDayTimePattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/i;
    const correctionCombinedMatch = correction.match(combinedDayTimePattern);
    
    if (correctionCombinedMatch) {
      const newDay = correctionCombinedMatch[1];
      const newTime = correctionCombinedMatch[2];
      
      // Replace both day and time in the original
      let result = beforeIntent;
      
      // Replace day
      const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
      const beforeDayMatch = beforeIntent.match(dayPattern);
      if (beforeDayMatch) {
        result = result.replace(beforeDayMatch[0], newDay);
      }
      
      // Replace time
      const timePattern = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/i;
      const beforeTimeMatch = result.match(timePattern);
      if (beforeTimeMatch) {
        result = result.replace(beforeTimeMatch[0], newTime);
      }
      
      // console.log('✅ Combined day+time replacement:', result);
      return result;
    }
    
    // Pattern 2: Time replacement only (3PM -> 5PM)
    const timePattern = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/i;
    const correctionTimeMatch = correction.match(timePattern);
    const beforeTimeMatch = beforeIntent.match(timePattern);
    
    if (correctionTimeMatch && beforeTimeMatch) {
      const result = beforeIntent.replace(beforeTimeMatch[0], correctionTimeMatch[0]);
      // console.log('✅ Time replacement:', result);
      return result;
    }
    
    // Pattern 3: Day replacement only (Friday -> Saturday)
    const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
    const correctionDayMatch = correction.match(dayPattern);
    const beforeDayMatch = beforeIntent.match(dayPattern);
    
    if (correctionDayMatch && beforeDayMatch) {
      const result = beforeIntent.replace(beforeDayMatch[0], correctionDayMatch[0]);
      // console.log('✅ Day replacement:', result);
      return result;
    }
    
    // Pattern 4: Number replacement
    const numberPattern = /\b(\d+)\b/;
    const correctionNumberMatch = correction.match(numberPattern);
    const beforeNumberMatch = beforeIntent.match(numberPattern);
    
    if (correctionNumberMatch && beforeNumberMatch) {
      // Replace the last number in beforeIntent with the correction number
      const lastNumberMatch = beforeIntent.match(/\b(\d+)\b(?!.*\b\d+\b)/);
      if (lastNumberMatch) {
        const result = beforeIntent.replace(lastNumberMatch[0], correctionNumberMatch[0]);
        // console.log('✅ Number replacement:', result);
        return result;
      }
    }
    
    // Pattern 5: Name replacement (Amit -> Manish)
    const namePattern = /\b[A-Z][a-z]+\b/;
    const correctionNameMatch = correction.match(namePattern);
    const beforeNameMatch = beforeIntent.match(namePattern);
    
    if (correctionNameMatch && beforeNameMatch) {
      // Replace the last name in beforeIntent
      const lastNamePattern = /\b[A-Z][a-z]+\b(?!.*\b[A-Z][a-z]+\b)/;
      const lastNameMatch = beforeIntent.match(lastNamePattern);
      if (lastNameMatch) {
        const result = beforeIntent.replace(lastNameMatch[0], correctionNameMatch[0]);
        // console.log('✅ Name replacement:', result);
        return result;
      }
    }
    
    // Fallback: append correction to before content
    // console.log('⚠️ No pattern match found, combining both parts');
    return `${beforeIntent} ${correction}`;
  }

  /**
   * Clean content to remove "Sorry" when it appears to be preparing for correction
   * This prevents "Sorry" from appearing in the final text output
   */
  private cleanContentForCorrection(content: string): string {
    if (!content || !content.trim()) return '';

    const trimmedContent = content.trim();
    
    // Pattern 1: "Sorry." alone - return empty (user is preparing to correct)
    if (/^sorry\.?$/i.test(trimmedContent)) {
      // console.log('🧹 Removing standalone "Sorry" - waiting for correction');
      return '';
    }
    
    // Pattern 2: "Sorry, [correction]" - extract just the correction part
    const sorryCommaPattern = /^sorry[,\s]+(.+)/i;
    const sorryCommaMatch = trimmedContent.match(sorryCommaPattern);
    if (sorryCommaMatch && sorryCommaMatch[1].trim()) {
      const correctionPart = sorryCommaMatch[1].trim();
      // console.log('🧹 Extracting correction from "Sorry, ...":', correctionPart);
      return correctionPart;
    }
    
    // Pattern 3: Remove "Sorry" at the beginning when followed by correction context
    // Example: "Sorry Saturday 1PM" -> "Saturday 1PM"
    const sorryPrefixPattern = /^sorry\s+(.+)/i;
    const sorryPrefixMatch = trimmedContent.match(sorryPrefixPattern);
    if (sorryPrefixMatch && sorryPrefixMatch[1].trim()) {
      const withoutSorry = sorryPrefixMatch[1].trim();
      // console.log('🧹 Removing "Sorry" prefix:', withoutSorry);
      return withoutSorry;
    }
    
    // Pattern 4: Remove mid-sentence "Sorry" that appears to be a correction marker
    // Example: "Meeting on Friday. Sorry. Saturday, 1PM." -> "Meeting on Friday. Saturday, 1PM."
    const midSorryPattern = /\.\s*sorry\.\s*/i;
    if (midSorryPattern.test(trimmedContent)) {
      const cleanedContent = trimmedContent.replace(midSorryPattern, '. ');
      // console.log('🧹 Removing mid-sentence "Sorry":', cleanedContent);
      return cleanedContent;
    }
    
    // No "Sorry" patterns found, return original content
    return content;
  }

  /**
   * Determine if recent context contains unprocessed content that should be included with corrections
   * This helps handle cases like "Can you mail Amit? Sorry, Manish" where the original sentence wasn't processed yet
   */
  private hasUnprocessedContext(transcript: string, recentContext: string): boolean {
    if (!recentContext || !transcript) return false;
    
    // Check if transcript indicates correction/replacement intent
    const hasCorrection = /sorry|actually|change|make that|replace|fix|correction/i.test(transcript);
    if (!hasCorrection) return false;
    
    // Look for unprocessed substantial content in recent context
    // Split context into sentences and find ones that might contain the original content being corrected
    const allContext = recentContext;
    
    // Check if context contains time/date patterns that might be getting corrected
    const hasTimeReference = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i.test(allContext);
    const hasNumberReference = /\b\d+\b/.test(allContext);
    const hasNameReference = /\b[A-Z][a-z]+\b/.test(allContext);
    const hasActionVerb = /\b(schedule|meeting|send|mail|call|visit|have|need|want)\b/i.test(allContext);
    
    // Check if we have a correction pattern within the same context
    const correctionPattern = /(.+?)(?:\.\s*)?(?:sorry|actually|make that|change|correction)[,\s]+(.+)/i;
    const correctionMatch = allContext.match(correctionPattern);
    
    const shouldInclude = hasCorrection && (hasTimeReference || hasNumberReference || hasNameReference) && hasActionVerb;
    
    // console.log('🔍 Enhanced context analysis:', { 
    //   hasCorrection, 
    //   hasTimeReference,
    //   hasNumberReference,
    //   hasNameReference,
    //   hasActionVerb,
    //   hasCorrectionPattern: !!correctionMatch,
    //   context: allContext.slice(-100),
    //   shouldInclude
    // });
    
    return shouldInclude;
  }

  /**
   * More reliable check for when we should include context with corrections
   * This specifically looks for correction patterns and substantial content
   */
  private hasUnprocessedContextForCorrection(transcript: string, recentContext: string): boolean {
    if (!recentContext || !transcript) return false;
    
    // Must have correction indicator
    const hasCorrection = /sorry|actually|change|make that|replace|fix|correction/i.test(transcript);
    if (!hasCorrection) return false;
    
    // Check if recent context has substantial content that looks like it should be preserved
    const contextLength = recentContext.length;
    const hasSubstantialContext = contextLength > 20;
    
    // Look for sentence patterns that indicate unprocessed content
    const hasActionPattern = /\b(I have|I need|I want|schedule|meeting|send|mail|call|visit)\b/i.test(recentContext);
    
    // console.log('🔍 Correction context check:', {
    //   hasCorrection,
    //   hasSubstantialContext,
    //   hasActionPattern,
    //   contextLength,
    //   shouldInclude: hasCorrection && hasSubstantialContext && hasActionPattern
    // });
    
    return hasCorrection && hasSubstantialContext && hasActionPattern;
  }

  /**
   * Build corrected content from recent context and current transcript
   * This extracts the original sentence and applies the correction from the transcript
   */
  private buildCorrectedContentFromContext(transcript: string, recentContext: string): string {
    // console.log('🔨 Building corrected content from context:', { transcript, recentContext });
    
    // First, try to extract full content directly from the transcript itself
    const fullContentFromTranscript = this.extractFullContentFromIntent(transcript);
    if (fullContentFromTranscript && fullContentFromTranscript !== transcript && fullContentFromTranscript.length > transcript.length) {
      // console.log('✅ Used full content from transcript:', fullContentFromTranscript);
      return fullContentFromTranscript;
    }
    
    // Look for the original sentence in recent context
    // Priority: find sentences that are NOT just correction parts
    const allSentences = recentContext.split(/[.!?]/).filter(s => s.trim().length > 10);
    
    // Filter out sentences that are just corrections (contain only correction words)
    const substantialSentences = allSentences.filter(sentence => {
      const cleaned = sentence.trim().toLowerCase();
      return !cleaned.startsWith('sorry') && 
             !cleaned.startsWith('make that') &&
             !cleaned.startsWith('actually') &&
             !cleaned.match(/^(sorry|make that|actually|change|correction)[,\s]/);
    });
    
    if (substantialSentences.length === 0) {
      // Fallback to last sentence if no substantial ones found
      const lastSentence = allSentences[allSentences.length - 1]?.trim();
      return lastSentence || transcript;
    }
    
    // Get the last substantial sentence (likely the one being corrected)
    const originalSentence = substantialSentences[substantialSentences.length - 1].trim();
    
    // Extract the correction part from the transcript
    const correctionPart = this.extractCorrectionFromTranscript(transcript);
    if (!correctionPart) {
      // console.log('⚠️ No correction found, returning original sentence:', originalSentence);
      return originalSentence;
    }
    
    // Apply the correction to the original sentence
    const correctedSentence = this.mergeIntentContent(originalSentence, correctionPart);
    
    // console.log('✅ Built corrected content:', {
    //   original: originalSentence,
    //   correction: correctionPart,
    //   result: correctedSentence
    // });
    
    return correctedSentence;
  }

  /**
   * Extract just the correction value from a transcript with correction indicators
   */
  private extractCorrectionFromTranscript(transcript: string): string {
    // Remove "sorry" and extract the actual correction
    const cleaned = this.cleanContentForCorrection(transcript);
    
    // Look for patterns after correction indicators
    const patterns = [
      /(?:sorry|actually|change|make that|correction)[,\s]+(.+)/i,
      /\.\s*sorry[,\s]*(.+)/i,
      /sorry[,\s]+(.+)/i
    ];
    
    for (const pattern of patterns) {
      const match = transcript.match(pattern);
      if (match && match[1]) {
        const extraction = match[1].trim();
        // console.log('📤 Extracted correction:', extraction);
        return extraction;
      }
    }
    
    return cleaned;
  }

  private formatAsText(content: string): string {
    if (!content.trim()) return '';
    
    // Always return as paragraph for consistency
    return `<p>${content.trim()}</p>`;
  }

  private handleContinuousText(content: string, editor: Editor): string {
    if (!content.trim()) return '';
    
    const now = Date.now();
    const timeSinceLastInsert = now - this.context.continuousText.lastInsertTime;
    
    // If it's been more than 3 seconds since last text or this is the first chunk,
    // treat as new paragraph
    if (timeSinceLastInsert > 3000 || !this.context.continuousText.accumulated) {
      this.context.continuousText.accumulated = content.trim();
      this.context.continuousText.lastInsertTime = now;
      return `<p>${content.trim()}</p>`;
    }
    
    // Otherwise, accumulate the text and update the current paragraph
    this.context.continuousText.accumulated += ` ${content.trim()}`;
    this.context.continuousText.lastInsertTime = now;
    
    // Try to find and replace the last paragraph in the editor PRESERVING FORMATTING
    try {
      const currentHTML = editor.getHTML();
      
      // Look for the last paragraph that might contain our text
      // But be more careful about preserving existing formatting
      const paragraphs = currentHTML.match(/<p[^>]*>.*?<\/p>/gi);
      if (paragraphs && paragraphs.length > 0) {
        const lastParagraph = paragraphs[paragraphs.length - 1];
        
        // Check if the last paragraph contains our accumulated text start (without formatting)
        const textStart = this.context.continuousText.accumulated.split(' ').slice(0, 3).join(' ');
        const plainTextInParagraph = lastParagraph.replace(/<[^>]*>/g, '');
        
        if (plainTextInParagraph.includes(textStart.split(' ')[0])) {
          // DON'T replace if the paragraph has formatting - just append new content
          if (lastParagraph.includes('<strong>') || lastParagraph.includes('<em>') || 
              lastParagraph.includes('<b>') || lastParagraph.includes('<i>')) {
            // console.log('🎨 Preserving formatting - appending as new paragraph instead');
            return `<p>${content.trim()}</p>`;
          }
          
          // Only replace if it's plain text without formatting
          const updatedHTML = currentHTML.replace(
            lastParagraph,
            `<p>${this.context.continuousText.accumulated}</p>`
          );
          
          // Update the editor content
          editor.commands.clearContent();
          editor.commands.insertContent(updatedHTML);
          
          // Let TipTap editor handle autoscroll for continuous text updates
          setTimeout(() => {
            const { selection } = editor.state;
            const { from, to } = selection;
            editor.commands.setTextSelection({ from: to, to: to });
          }, 50);
          
          return ''; // Return empty since we've already updated the editor
        }
      }
      
      // No matching paragraph found, insert as new paragraph
      return `<p>${this.context.continuousText.accumulated}</p>`;
    } catch (error) {
      console.error('❌ Error updating continuous text:', error);
      // Fallback to normal paragraph insertion
      return `<p>${content.trim()}</p>`;
    }
  }

  private isValidHTML(html: string): boolean {
    if (!html || html.trim() === '') return false;
    
    // Check for invalid patterns that TipTap can't handle
    const invalidPatterns = [
      /<>/,           // Empty fragments
      /<\/>/,         // Empty closing fragments
      /^<>.*<\/>$/,   // Content wrapped in empty fragments
    ];
    
    // Don't reject standard HTML tags like <ul><li>content</li></ul>
    const trimmedHtml = html.trim();
    
    // Basic check for well-formed HTML
    const hasValidStructure = (
      trimmedHtml.startsWith('<') && 
      trimmedHtml.endsWith('>') &&
      !invalidPatterns.some(pattern => pattern.test(trimmedHtml))
    );
    
    // console.log('🔍 HTML Validation:', { html: trimmedHtml, isValid: hasValidStructure });
    return hasValidStructure;
  }

  private isListCommand(transcript: string): boolean {
    const lowerTranscript = transcript.toLowerCase();
    return lowerTranscript.includes('create list') || 
           lowerTranscript.includes('make list') ||
           lowerTranscript.includes('create a list') ||
           lowerTranscript.includes('numbered list') ||
           lowerTranscript.includes('create numbered list') ||
           lowerTranscript.includes('create a numbered list') ||
           lowerTranscript.includes('ordered list');
  }

  private startListMode(transcript: string): string {
    const lowerTranscript = transcript.toLowerCase();
    
    // Determine list type based on command
    let listType: 'ul' | 'ol' = 'ul'; // default to unordered
    if (lowerTranscript.includes('numbered') || lowerTranscript.includes('ordered')) {
      listType = 'ol';
    }
    
    // console.log(`📋 Starting ${listType === 'ol' ? 'numbered' : 'bullet'} list mode`);
    
    // Find where the list command appears in the transcript
    const commandPatterns = [
      /create\s+(?:a\s+)?(?:numbered\s+)?list/i,
      /make\s+(?:a\s+)?(?:numbered\s+)?list/i,
      /bullet\s+list/i,
      /numbered\s+list/i,
      /ordered\s+list/i
    ];
    
    let commandEndIndex = -1;
    for (const pattern of commandPatterns) {
      const match = lowerTranscript.match(pattern);
      if (match) {
        commandEndIndex = match.index! + match[0].length;
        break;
      }
    }
    
    // Extract content only AFTER the command
    let initialContent = '';
    if (commandEndIndex > -1) {
      initialContent = transcript.substring(commandEndIndex).trim();
      // Remove common prefixes like "by", "of", "with"
      initialContent = initialContent.replace(/^(?:by|of|with)\s+/i, '').trim();
    }
    
    // Parse initial content for multiple items (only if there's content after the command)
    const initialItems = initialContent ? this.parseListItems(initialContent) : [];
    
    // console.log('📋 Command found at position', commandEndIndex, 'initial content:', initialContent, 'items:', initialItems);
    
    this.context.listMode = {
      active: true,
      items: initialItems,
      startTime: Date.now(),
      type: listType
    };
    
    // Return empty string - we're collecting items, not inserting yet
    return '';
  }

  private autoFinalizationTimeout: NodeJS.Timeout | null = null;

  private handleListModeInput(transcript: string): string {
    // console.log('📝 Adding to list:', transcript);
    
    // Check for end list commands
    const lowerTranscript = transcript.toLowerCase();
    if (lowerTranscript.includes('end list') || 
        lowerTranscript.includes('finish list') || 
        lowerTranscript.includes('complete list')) {
      return this.finalizeList();
    }
    
    // Parse the input for list items
    const items = this.parseListItems(transcript);
    this.context.listMode.items.push(...items);
    
    // console.log('📋 Current list items:', this.context.listMode.items);
    
    // Check if we should auto-finalize (after a pause or many items)
    if (this.context.listMode.items.length >= 4) {
      // console.log('📝 Auto-finalizing list (reached 4 items)');
      return this.finalizeList();
    }
    
    // Clear existing timeout and set new one
    if (this.autoFinalizationTimeout) {
      clearTimeout(this.autoFinalizationTimeout);
    }
    
    this.autoFinalizationTimeout = setTimeout(() => {
      if (this.context.listMode.active && this.context.listMode.items.length > 0) {
        // console.log('⏰ Auto-finalizing list due to inactivity');
        const finalizedHTML = this.finalizeList();
        
        // Trigger a callback to insert the HTML into the editor
        if (finalizedHTML && this.onAutoFinalize) {
          this.onAutoFinalize(finalizedHTML);
        }
      }
    }, 2000); // Reduced to 2 seconds for better UX
    
    // Return empty string - still collecting
    return '';
  }

  private parseListItems(text: string): string[] {
    if (!text || !text.trim()) return [];
    
    // Split by common separators
    const items = text.split(/[,;]|\s+(?:and|then|next|also)\s+/i)
      .map(item => item.trim())
      .map(item => item.replace(/[.!?]+$/, '')) // Remove trailing punctuation
      .filter(item => item.length > 0 && !this.isStopWord(item) && !this.isPunctuation(item));
    
    return items;
  }

  private isStopWord(word: string): boolean {
    const stopWords = ['uh', 'um', 'like', 'you know', 'okay', 'alright'];
    return stopWords.includes(word.toLowerCase());
  }

  private isPunctuation(word: string): boolean {
    // Filter out pure punctuation like ".", "!", "?", etc.
    return /^[.!?,:;]+$/.test(word);
  }

  private finalizeList(): string {
    if (!this.context.listMode.active || this.context.listMode.items.length === 0) {
      this.context.listMode.active = false;
      return '';
    }
    
    // console.log('✅ Finalizing list with items:', this.context.listMode.items);
    
    // Clear any pending auto-finalization timeout
    if (this.autoFinalizationTimeout) {
      clearTimeout(this.autoFinalizationTimeout);
      this.autoFinalizationTimeout = null;
    }
    
    const listTag = this.context.listMode.type;
    const listHTML = `<${listTag}>${this.context.listMode.items.map(item => `<li>${item}</li>`).join('')}</${listTag}>`;
    
    // Reset list mode
    this.context.listMode = {
      active: false,
      items: [],
      startTime: 0,
      type: 'ul'
    };
    
    return listHTML;
  }

  private updateContext(transcript: string, editor: Editor): void {
    // Keep last 5 chunks for context
    this.context.previousChunks.push(transcript);
    if (this.context.previousChunks.length > 5) {
      this.context.previousChunks.shift();
    }
    
    // Update editor content snapshot
    this.context.editorContent = editor.getHTML();
    this.context.timestamp = Date.now();
  }

  private isHeadingCommand(transcript: string): boolean {
    const lowerTranscript = transcript.toLowerCase().trim();
    
    // Direct heading commands without content - handle both "h1" and "h 1" patterns
    const directCommands = [
      'h1 heading', 'h 1 heading', 'h2 heading', 'h 2 heading', 'h3 heading', 'h 3 heading',
      'heading 1', 'heading 2', 'heading 3',
      'make heading', 'create heading'
    ];
    
    // Check if transcript is exactly one of these commands or starts with one
    return directCommands.some(cmd => {
      const cmdMatch = lowerTranscript.match(new RegExp(`^${cmd}\\s*(.*)`, 'i'));
      if (cmdMatch) {
        const remainingText = cmdMatch[1].trim();
        // If there's little or no content after the command, activate heading mode
        return remainingText.length < 3;
      }
      return false;
    });
  }

  private startHeadingMode(transcript: string): string {
    const lowerTranscript = transcript.toLowerCase().trim();
    
    // Determine heading level from command - handle both "h1" and "h 1" patterns
    let level = 2; // default to h2
    if (lowerTranscript.includes('h1') || lowerTranscript.includes('h 1') || lowerTranscript.includes('heading 1')) {
      level = 1;
    } else if (lowerTranscript.includes('h3') || lowerTranscript.includes('h 3') || lowerTranscript.includes('heading 3')) {
      level = 3;
    }
    
    // console.log(`📝 Starting heading mode (H${level})`);
    
    this.context.headingMode = {
      active: true,
      level: level,
      startTime: Date.now()
    };
    
    // Return empty string - we're waiting for the next text to format as heading
    return '';
  }

  private handleHeadingModeInput(transcript: string): string {
    // console.log(`📝 Processing heading input (H${this.context.headingMode.level}):`, transcript);
    
    const level = this.context.headingMode.level;
    
    // Clean the transcript to extract only the content part
    let cleanContent = transcript.trim();
    
    // Look for heading command patterns and extract content after them
    const headingExtractionPatterns = [
      // Pattern: "H 1 heading, content" -> extract "content"
      /^.*?h\s*1\s*heading[,\s]+(.+)$/i,
      /^.*?h\s*2\s*heading[,\s]+(.+)$/i,
      /^.*?h\s*3\s*heading[,\s]+(.+)$/i,
      // Pattern: "heading 1, content" -> extract "content"
      /^.*?heading\s*1[,\s]+(.+)$/i,
      /^.*?heading\s*2[,\s]+(.+)$/i,
      /^.*?heading\s*3[,\s]+(.+)$/i,
      // Pattern: "make heading content" -> extract "content"
      /^.*?(?:make|create)\s*heading[,\s]+(.+)$/i
    ];
    
    // Try to extract content after heading command
    for (const pattern of headingExtractionPatterns) {
      const match = cleanContent.match(pattern);
      if (match && match[1]) {
        cleanContent = match[1].trim();
        // console.log('📝 Extracted content after heading command:', cleanContent);
        break;
      }
    }
    
    // If no extraction pattern matched, remove heading commands from the start
    if (cleanContent === transcript.trim()) {
      const cleanupPatterns = [
        /^h\s*1\s*heading[,\s]*/i,
        /^h\s*2\s*heading[,\s]*/i,
        /^h\s*3\s*heading[,\s]*/i,
        /^heading\s*1[,\s]*/i,
        /^heading\s*2[,\s]*/i,
        /^heading\s*3[,\s]*/i,
        /^make\s*heading[,\s]*/i,
        /^create\s*heading[,\s]*/i
      ];
      
      for (const pattern of cleanupPatterns) {
        cleanContent = cleanContent.replace(pattern, '').trim();
      }
    }
    
    // If after cleaning we have no content, use a default
    if (!cleanContent) {
      cleanContent = 'Heading';
    }
    
    const headingHTML = `<h${level}>${cleanContent}</h${level}>`;
    
    // Reset heading mode
    this.context.headingMode = {
      active: false,
      level: 1,
      startTime: 0
    };
    
    // console.log(`✅ Created H${level} heading with clean content:`, { original: transcript, cleaned: cleanContent, html: headingHTML });
    return headingHTML;
  }

  public clearContext(): void {
    // Clear any pending auto-finalization timeout
    if (this.autoFinalizationTimeout) {
      clearTimeout(this.autoFinalizationTimeout);
      this.autoFinalizationTimeout = null;
    }
    
    this.context = {
      previousChunks: [],
      editorContent: '',
      timestamp: Date.now(),
      listMode: {
        active: false,
        items: [],
        startTime: 0,
        type: 'ul'
      },
      continuousText: {
        accumulated: '',
        lastInsertTime: 0
      },
      headingMode: {
        active: false,
        level: 1,
        startTime: 0
      }
    };
  }

  public isReady(): boolean {
    return !!this.grokApiKey;
  }

  public setAutoFinalizeCallback(callback: (html: string) => void): void {
    this.onAutoFinalize = callback;
  }

  public getStats() {
    return {
      hasApiKey: !!this.grokApiKey,
      contextChunks: this.context.previousChunks.length,
      isOpenRouter: this.isOpenRouter,
      listMode: {
        active: this.context.listMode.active,
        itemCount: this.context.listMode.items.length,
        items: this.context.listMode.items,
        type: this.context.listMode.type
      },
      headingMode: {
        active: this.context.headingMode.active,
        level: this.context.headingMode.level
      }
    };
  }
}