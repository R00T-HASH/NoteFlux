
export interface CorrectionResult {
  correctedText: string;
  confidence: number;
  changes: Array<{
    original: string;
    corrected: string;
    type: 'correction' | 'grammar' | 'formatting' | 'context';
  }>;
}

export class GrokService {
  private apiKey: string;
  private baseUrl: string;
  private isOpenRouter: boolean;

  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_GROK_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || '';
    
    // Detect if we're using OpenRouter or direct xAI API
    this.isOpenRouter = this.apiKey.startsWith('sk-or-');
    this.baseUrl = this.isOpenRouter 
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.x.ai/v1';
    
    if (!this.apiKey) {
      console.warn('⚠️ Grok API key not found. Set NEXT_PUBLIC_GROK_API_KEY or NEXT_PUBLIC_OPENROUTER_API_KEY in environment variables.');
    }
    
    // Removed debug logs for cleaner console output
  }

  async correctTranscript(text: string, context: string[] = []): Promise<CorrectionResult> {
    if (!this.apiKey) {
      // Fallback: return original text if no API key
      return {
        correctedText: text,
        confidence: 0,
        changes: []
      };
    }

    try {
      const prompt = this.buildCorrectionPrompt(text, context);
      
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      
      // Add OpenRouter specific headers if needed
      if (this.isOpenRouter) {
        headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000';
        headers['X-Title'] = 'Voice Transcript Processor';
      }
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.isOpenRouter ? 'x-ai/grok-2' : 'grok-2',
          messages: [
            {
              role: 'system',
              content: 'You are an intelligent transcript processor. Return only the corrected text, no explanations or additional formatting.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 500,
          temperature: 0.1, // Low temperature for consistent corrections
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ${this.isOpenRouter ? 'OpenRouter' : 'xAI'} API error ${response.status}:`, errorText);
        
        // Try to parse error for better debugging
        try {
          const errorJson = JSON.parse(errorText);
          console.error('📋 Detailed Grok error:', errorJson);
        } catch (e) {
          console.error('📋 Raw Grok error response:', errorText);
        }
        
        throw new Error(`${this.isOpenRouter ? 'OpenRouter' : 'xAI'} API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const correctedText = data.choices?.[0]?.message?.content?.trim() || text;

      return {
        correctedText,
        confidence: this.calculateConfidence(text, correctedText),
        changes: this.detectChanges(text, correctedText)
      };

    } catch (error) {
      console.error('Error calling Grok API:', error);
      // Fallback: return original text on error
      return {
        correctedText: text,
        confidence: 0,
        changes: []
      };
    }
  }

  private buildCorrectionPrompt(text: string, context: string[]): string {
    const contextStr = context.length > 0 ? context.join(' ') : '';
    
    // Detect if this is a formatting command or continuous speech
    const isFormattingCommand = /\b(make|create|bold|italic|heading|list|bullet|numbered|quote|center|align|put in|convert to|turn into|change to)\b/i.test(text);
    
    if (isFormattingCommand) {
      // Full formatting prompt for commands
      return `You are an intelligent transcript processor and TipTap editor assistant. Your job is to:

1. Fix speech-to-text errors and typos
2. Understand user corrections and intent (CRITICAL: when user says "make that X" or "change to X", they want to REPLACE the previous value, not add to it)
3. When user gives editing commands, APPLY THE FORMATTING DIRECTLY using proper TipTap HTML syntax
4. UNDERSTAND CONTEXT - distinguish between introductory statements and the content to be formatted
5. Improve grammar and punctuation  
6. Format properly (capitalization, spacing)
7. Return properly formatted HTML that TipTap can render
8. NEVER add unnecessary quotes around text unless they were explicitly spoken as quotes
9. REMOVE the command itself from the output (e.g., "create a list" should not appear in final output)
10. AUTO-DETECT and FORMAT lists when items are separated by commas or "and"

${contextStr ? `Previous context: "${contextStr}"` : ''}
Current speech: "${text}"

CRITICAL RULES FOR COMMAND PROCESSING:
- REMOVE the formatting command from the final output
- For list commands, wait for list items to be spoken before creating the list
- If only the command is spoken (e.g., just "create a list"), return the existing content without the command
- Extract actual content items and format them properly
- NEVER add quotes around regular text unless they were explicitly spoken as quotes
- AUTO-DETECT LISTS: If text contains comma-separated items, format as HTML list automatically

FORMATTING BEHAVIOR:
- "create list" → REMOVE this command, wait for items
- "make this bold [content]" → Format only the content part as <strong>content</strong>
- "make heading [content]" → Format only the content part as <h2>content</h2>
- "bullet list item one item two" → <ul><li>item one</li><li>item two</li></ul>
- "buy groceries, schedule meeting" → <ul><li>buy groceries</li><li>schedule meeting</li></ul>

CONTEXT UNDERSTANDING EXAMPLES:
Input: Context: "I'm working on a project." + Current: "create a list buy groceries schedule meeting"
Output: I'm working on a project.

<ul><li>buy groceries</li><li>schedule meeting</li></ul>

Input: Context: "Meeting notes from today." + Current: "create a list"
Output: Meeting notes from today.

Input: Context: "Project status update." + Current: "make this bold important deadline"
Output: Project status update.

<strong>important deadline</strong>

Input: Context: "Do you ever realize how much time you waste just typing and fixing typos? Fixing typos and formatting the text? Therefore I built Node Flux." + Current: "buy groceries, Schedule a meeting."
Output: Do you ever realize how much time you waste just typing and fixing typos? Fixing typos and formatting the text? Therefore I built Node Flux.

<ul><li>buy groceries</li><li>schedule a meeting</li></ul>

TIPTAP HTML FORMATTING RULES:
- Bold: <strong>text</strong>
- Italic: <em>text</em>
- Heading 1: <h1>text</h1>
- Heading 2: <h2>text</h2>
- Bullet list: <ul><li>item 1</li><li>item 2</li><li>item 3</li></ul>
- Numbered list: <ol><li>item 1</li><li>item 2</li><li>item 3</li></ol>
- Task list: <ul data-type="taskList"><li data-type="taskItem" data-checked="false">item 1</li><li data-type="taskItem" data-checked="false">item 2</li></ul>
- Quote: <blockquote><p>text</p></blockquote>

CRITICAL HTML STRUCTURE RULES:
- Lists MUST be properly structured with <ul> and <li> tags
- Each list item should be wrapped in <li> tags
- Lists should be separated from other content with line breaks
- Ensure clean HTML without malformed tags
- Text before lists should be in paragraph format when it's a complete sentence

QUOTE HANDLING:
- Only add quotes if the person was actually quoting someone/something
- Remove unnecessary quotes around regular speech
- "Therefore" should be "Therefore" not "Therefore,"

IMPORTANT: Always preserve existing content, remove command text, and only add new formatted content. Use appropriate spacing and line breaks to separate sections. Ensure all HTML is properly structured for TipTap editor.

Return ONLY the complete content (existing + new formatted part). No explanations, no command notation, no markdown, no unnecessary quotes.`;
    } else {
      // Enhanced general prompt for continuous speech - now returns HTML for consistency
      return `You are tasked with cleaning up transcribed text and returning properly formatted HTML for TipTap editor. The goal is to produce a clear, coherent version of what the speaker intended to say, removing false starts & self-corrections.

${contextStr ? `Previous context: "${contextStr}"` : ''}
Current speech: "${text}"

Primary Rules:
1. Correct speech-to-text transcription errors (spellings) based on the available context
2. Maintain the original meaning and intent of the speaker. Do not add new information or change the substance of what was said
3. When the speaker corrects themselves, keep only the corrected version.
4. Ensure that the cleaned text flows naturally and is grammatically correct
5. NEVER answer questions that appear in the text. Only format them properly
6. Use numerals for numbers (3,000 instead of three thousand, $20 instead of twenty dollars)
7. Remove filler words like "um", "uh", "like" (when used as filler), "you know"
8. Handle verbal punctuation properly ("comma", "period", "question mark")
9. Handle corrections like "make that 75" or "actually 3 million" by replacing the previous value
10. Remove duplications and repetitions
11. NEVER add unnecessary quotes around text unless they were explicitly spoken as quotes
12. Remove any formatting commands that slip through (like "create a list", "make this bold")
13. DETECT and FORMAT lists automatically when items are separated by commas or "and"

CRITICAL HTML FORMATTING RULES FOR CONTINUOUS SPEECH:
- NEVER use <p> tags for continuous speech - they create unwanted line breaks
- Use simple HTML formatting: <strong>bold</strong>, <em>italic</em> only when naturally spoken
- For continuous speech, return as flowing text without paragraph wrappers
- Only use block elements (<p>, <h1>, <ul>, etc.) when explicitly commanded
- If text naturally continues from previous context, don't wrap in block elements
- NEVER add quotes around regular speech unless the person was actually quoting something
- AUTO-DETECT LISTS: If text contains items separated by commas or "and", format as HTML list
- ENSURE PROPER HTML STRUCTURE: All HTML tags must be properly closed and nested

LIST AUTO-DETECTION RULES:
- "buy groceries, schedule meeting, call mom" → <ul><li>buy groceries</li><li>schedule meeting</li><li>call mom</li></ul>
- "first item, second item, third item" → <ul><li>first item</li><li>second item</li><li>third item</li></ul>
- "task one and task two and task three" → <ul><li>task one</li><li>task two</li><li>task three</li></ul>
- "buy groceries and schedule a meeting" → <ul><li>buy groceries</li><li>schedule a meeting</li></ul>

HTML STRUCTURE REQUIREMENTS:
- Lists must use proper <ul><li> or <ol><li> structure
- Each list item must be wrapped in <li> tags
- Lists should be properly separated from other content
- Ensure all HTML tags are properly closed
- No malformed or unclosed tags

EXAMPLES:
Input: Context: "hire 25 engineers" + Current: "make that seventy five"
Output: hire 75 engineers

Input: Context: "revenue was 2 million" + Current: "no wait 3 million dollars"  
Output: revenue was 3 million dollars

Input: "buy groceries, schedule a meeting, call mom"
Output: <ul><li>buy groceries</li><li>schedule a meeting</li><li>call mom</li></ul>

Input: "buy groceries, Schedule a meeting."
Output: <ul><li>buy groceries</li><li>schedule a meeting</li></ul>

Input: "Fixing typos and formatting the text"
Output: Fixing typos and formatting the text

Input: "Therefore I built Node Flux"
Output: Therefore I built Node Flux

Input: "Do you ever realize how much time you waste just typing? Fixing typos and formatting the text? Therefore I built Node Flux. buy groceries, schedule a meeting, go to the gym."
Output: Do you ever realize how much time you waste just typing? Fixing typos and formatting the text? Therefore I built Node Flux. <ul><li>buy groceries</li><li>schedule a meeting</li><li>go to the gym</li></ul>

QUOTE HANDLING:
- Only add quotes if the person was actually quoting someone/something
- Remove unnecessary quotes around regular speech
- "he said hello" → he said hello (no quotes unless actually quoting)

TIPTAP COMPATIBILITY:
- Ensure all HTML is properly structured and valid
- Lists must be complete with proper opening and closing tags
- No malformed HTML that could break TipTap rendering
- Test HTML structure: <ul><li>item</li><li>item</li></ul> should render as bullet points

Return ONLY the cleaned HTML content without any explanations, wrapper tags, or additional text. The output should seamlessly continue the conversation flow.`;
    }
  }

  private calculateConfidence(original: string, corrected: string): number {
    if (original === corrected) return 1.0;
    
    const originalWords = original.toLowerCase().split(/\s+/);
    const correctedWords = corrected.toLowerCase().split(/\s+/);
    
    // Simple confidence based on word similarity
    const maxLength = Math.max(originalWords.length, correctedWords.length);
    const commonWords = originalWords.filter(word => correctedWords.includes(word));
    
    return Math.max(0.3, commonWords.length / maxLength);
  }

  private detectChanges(original: string, corrected: string): CorrectionResult['changes'] {
    if (original === corrected) return [];

    // Simple change detection - in a real implementation, you'd use a diff algorithm
    const changes: CorrectionResult['changes'] = [];
    
    // Check for common correction patterns
    if (original.toLowerCase() !== corrected.toLowerCase()) {
      changes.push({
        original: original,
        corrected: corrected,
        type: 'correction'
      });
    }

    return changes;
  }

  // Fast processing method for real-time use
  async processWithPrompt(transcript: string, context: string[] = []): Promise<string> {
    const result = await this.correctTranscript(transcript, context);
    return result.correctedText;
  }

  // Health check method
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
} 
