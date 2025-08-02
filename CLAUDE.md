# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NoteFlux is a Next.js application that provides voice-to-text conversion with AI-powered text editing. The app features a TipTap rich text editor enhanced with voice commands, real-time transcription using Deepgram and Web Speech APIs, and usage tracking with Supabase backend.

## Development Commands

```bash
# Development
npm run dev          # Start development server (localhost:3000)
npm run build        # Build for production
npm start            # Start production server

# No specific lint/typecheck commands defined in package.json
# TypeScript type checking happens during build process
```

## Architecture Overview

### Core Components Architecture
- **TipTap Editor** (`components/editor/tiptap-editor.tsx`): Rich text editor with voice command integration
- **Voice Assistant** (`components/voice-assistant/`): Voice transcription and processing interface
- **Enhanced Voice Commands** (`hooks/use-enhanced-voice-commands.ts`): Advanced voice command processing with AI enhancement

### Voice Transcription Stack
- **Deepgram Service** (`lib/deepgram-service.ts`): Primary voice-to-text using Deepgram Nova-2 model
- **Web Speech API**: Fallback transcription service (free tier)
- **Usage Service** (`lib/services/usage-service.ts`): Tracks transcription usage with 90-minute free tier limit

### Data Management
- **Supabase**: Authentication, user management, and usage tracking
- **Database Tables**: `usage_records`, `user_usage` for tracking voice transcription usage
- **Real-time Features**: Live transcription with interim results and utterance detection

### Voice Command Processing (SIMPLIFIED ARCHITECTURE)
The app uses a single, reliable processing pipeline:
1. **Raw Transcription**: Deepgram → `DeepgramTranscriptData`
2. **Unified Processing**: Single Grok API call determines if input is command/intent/text
3. **Direct Editor Insertion**: Processed HTML inserted directly into TipTap editor

**New Unified Approach:**
- `UnifiedVoiceProcessor`: Single service that handles all voice processing logic
- `useUnifiedVoiceProcessing`: Simple hook for TipTap integration
- **No complex state management** - each transcript chunk is processed independently
- **Reliable command detection** - Grok AI determines command vs regular text vs corrections

## Key Technical Details

### Voice Service Configuration
- **Deepgram**: Uses Nova-2 model with smart formatting, punctuation, and VAD events
- **Audio Processing**: 16kHz, single channel, linear16 encoding with noise suppression
- **Usage Limits**: 90 minutes free tier, tracked in seconds for accuracy

### Authentication Flow
- Supabase Auth with immediate sign-in after registration (bypasses email confirmation)
- User session management across client/server components
- Protected routes using middleware

### UI/Styling
- **Tailwind CSS** with shadcn/ui components
- **Dark theme** as default with next-themes
- **Component Structure**: Uses Radix UI primitives for accessibility

## Environment Variables Required

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
# Deepgram API key handled client-side via usage service
```

## Common Development Patterns

### Adding New Voice Commands
1. Extend voice command processor in `hooks/use-enhanced-voice-commands.ts`
2. Update command detection patterns in transcript manager
3. Integrate with TipTap editor commands via `onVoiceCommand` callback

### Supabase Database Operations
- Use `createClient()` from `utils/supabase/client.ts` for client-side operations
- Use `createClient()` from `utils/supabase/server.ts` for server actions
- Always check user authentication before database operations

### TipTap Editor Extensions
- Editor configured with StarterKit, Image, TaskList, TextAlign, Typography extensions
- Voice integration through `transcript` and `onVoiceCommand` props
- Custom toolbar with formatting options and voice status indicators

## Testing and Quality Assurance

The project doesn't include specific test commands in package.json. TypeScript compilation and Next.js build process provide type checking and basic validation.

## Notable Dependencies

- **@tiptap/react**: Rich text editor framework
- **@deepgram/sdk**: Voice transcription service
- **@supabase/supabase-js**: Backend and authentication
- **@tanstack/react-query**: Data fetching and caching
- **next-themes**: Theme management
- **sonner**: Toast notifications
- **openai**: AI enhancement services (for voice command processing)