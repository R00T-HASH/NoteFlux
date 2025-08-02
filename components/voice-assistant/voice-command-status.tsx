"use client";

import React from 'react';
import { List, Type, FileText, Clock } from 'lucide-react';
import { CommandState } from '@/components/editor/enhanced-voice-command-processor';

interface VoiceCommandStatusProps {
  state: CommandState;
  listBuffer: string[];
  isListening: boolean;
  onForceEnd?: () => void;
}

const VoiceCommandStatus: React.FC<VoiceCommandStatusProps> = ({
  state,
  listBuffer,
  isListening,
  onForceEnd
}) => {
  if (state === 'idle') {
    return null;
  }

  const getStateIcon = () => {
    switch (state) {
      case 'list':
        return <List className="w-4 h-4" />;
      case 'heading':
        return <Type className="w-4 h-4" />;
      case 'paragraph':
        return <FileText className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStateMessage = () => {
    switch (state) {
      case 'list':
        return `Creating list (${listBuffer.length} items)`;
      case 'heading':
        return 'Heading mode - speak your heading text';
      case 'paragraph':
        return 'Paragraph mode - speak your paragraph content';
      default:
        return 'Command mode active';
    }
  };

  const getInstructions = () => {
    switch (state) {
      case 'list':
        return listBuffer.length === 0 
          ? 'Speak your first list item or say "next item" to add more'
          : 'Say "next item" to add more or "end list" to finish';
      case 'heading':
        return 'Speak the heading text you want to create';
      case 'paragraph':
        return 'Speak the paragraph content';
      default:
        return 'Command in progress...';
    }
  };

  return (
    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-purple-400">
            {getStateIcon()}
          </div>
          <span className="text-sm font-medium text-purple-300">
            {getStateMessage()}
          </span>
          <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
        </div>
        
        {onForceEnd && (
          <button
            onClick={onForceEnd}
            className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 rounded text-red-300 hover:text-red-200 transition-colors"
          >
            End {state}
          </button>
        )}
      </div>
      
      <div className="text-xs text-purple-200/80">
        {getInstructions()}
      </div>
      
      {/* Show current list items if in list mode */}
      {state === 'list' && listBuffer.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-purple-300 mb-1">Current items:</div>
          <ul className="text-purple-200/70 list-disc list-inside max-h-20 overflow-y-auto">
            {listBuffer.map((item, index) => (
              <li key={index} className="truncate">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Timeout indicator */}
      {isListening && (
        <div className="mt-2 flex items-center gap-2 text-xs text-purple-200/60">
          <Clock className="w-3 h-3" />
          <span>Auto-complete in 3 seconds if no new input</span>
        </div>
      )}
    </div>
  );
};

export default VoiceCommandStatus; 