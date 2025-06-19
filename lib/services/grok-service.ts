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
    
    return `You are an intelligent transcript processor and TipTap editor assistant. Your job is to:

1. Fix speech-to-text errors and typos
2. Understand user corrections and intent (CRITICAL: when user says "make that X" or "change to X", they want to REPLACE the previous value, not add to it)
3. When user gives editing commands, APPLY THE FORMATTING DIRECTLY using proper TipTap HTML syntax
4. UNDERSTAND CONTEXT - distinguish between introductory statements and the content to be formatted
5. Improve grammar and punctuation  
6. Format properly (capitalization, spacing)
7. Return properly formatted HTML that TipTap can render

${contextStr ? `Previous context: "${contextStr}"` : ''}
Current speech: "${text}"

CRITICAL RULES:
- When user corrects themselves ("make that 75", "change to 75", "actually 75"), REPLACE the previous number/value in the context
- If user says "make that seventy five" after saying "twenty five", the final result should have "75" NOT both numbers
- When user says editing commands, APPLY THE FORMATTING IMMEDIATELY using proper HTML
- CONTEXT AWARENESS: If user provides an introduction followed by points/items, format the POINTS/ITEMS, not the introduction
- For list commands: convert content to actual HTML lists using <ul><li> or <ol><li> syntax
- For formatting commands: wrap content in proper HTML tags like <strong>, <em>, <h1>, etc.
- Split content intelligently into list items when creating lists
- Remove duplications and repetitions
- Fix obvious speech-to-text errors
- Handle verbal punctuation ("comma", "period", "question mark")
- Format numbers, emails, dates properly

CONTEXT UNDERSTANDING EXAMPLES:
Input: "I'm a software engineer here are my top 5 learnings first one debugging second one testing third one code review fourth one documentation fifth one teamwork" + Command: "put in list"
Output: <p>I'm a software engineer, here are my top 5 learnings:</p><ol><li>debugging</li><li>testing</li><li>code review</li><li>documentation</li><li>teamwork</li></ol>

Input: "These are my project tasks clean the database update the API fix the bugs deploy to production" + Command: "make this a list"
Output: <p>These are my project tasks:</p><ul><li>clean the database</li><li>update the API</li><li>fix the bugs</li><li>deploy to production</li></ul>

Input: "Meeting agenda discussion one project status discussion two budget review discussion three timeline planning" + Command: "bullet list"
Output: <p>Meeting agenda:</p><ul><li>project status</li><li>budget review</li><li>timeline planning</li></ul>

Input: "Here are the steps to deploy first build the app second run tests third check staging fourth deploy to production" + Command: "numbered list"
Output: <p>Here are the steps to deploy:</p><ol><li>build the app</li><li>run tests</li><li>check staging</li><li>deploy to production</li></ol>

TIPTAP HTML FORMATTING RULES:
- Bold: <strong>text</strong>
- Italic: <em>text</em>
- Heading 1: <h1>text</h1>
- Heading 2: <h2>text</h2>
- Bullet list: <ul><li>item 1</li><li>item 2</li><li>item 3</li></ul>
- Numbered list: <ol><li>item 1</li><li>item 2</li><li>item 3</li></ol>
- Task list: <ul data-type="taskList"><li data-type="taskItem" data-checked="false">item 1</li><li data-type="taskItem" data-checked="false">item 2</li></ul>
- Quote: <blockquote><p>text</p></blockquote>
- Paragraph: <p>text</p>

PATTERN RECOGNITION FOR LISTS:
- Look for enumeration words: "first", "second", "third", "one", "two", "three", "number one", etc.
- Look for sequence indicators: "next", "then", "also", "another", "finally"
- Look for list introduction phrases: "here are", "top X", "steps to", "things to", "ways to"
- Preserve the introduction as a paragraph, format the enumerated items as list items
- Handle natural speech patterns and filler words

SIMPLE FORMATTING COMMANDS:
Input: "Project Update" + Current: "make this bold"
Output: <strong>Project Update</strong>

Input: "Meeting Notes" + Current: "make this a heading"
Output: <h2>Meeting Notes</h2>

CORRECTION EXAMPLES (no formatting commands):
Input: Context: "hire 25 engineers" + Current: "make that seventy five"
Output: hire 75 engineers

Input: Context: "revenue was 2 million" + Current: "no wait 3 million dollars"  
Output: revenue was 3 million dollars

Return ONLY the final result - either corrected text OR properly formatted HTML. No explanations, no command notation, no markdown.`;
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