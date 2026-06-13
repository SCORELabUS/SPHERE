import { useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { ChatMessage, PromptPreset } from '../types/types';
import ChatMessageComponent from './chat-message';
import WelcomeScreen from './welcome-screen';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  promptPresets: PromptPreset[];
  onPresetSelect: (preset: PromptPreset) => void;
}

export default function ChatTranscript({ messages, isLoading, promptPresets, onPresetSelect }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return <WelcomeScreen presets={promptPresets} onSelect={onPresetSelect} />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6" aria-live="polite" aria-busy={isLoading}>
      <div className="mx-auto max-w-[800px] space-y-6">
        <AnimatePresence mode="popLayout">
          {messages.map((message, i) => (
            <ChatMessageComponent
              key={message.id}
              message={message}
              isLast={i === messages.length - 1}
            />
          ))}
        </AnimatePresence>

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-tp-cream text-[11px] font-semibold text-tp-primary">
                H
              </div>
              <div className="rounded-xl rounded-tl-sm bg-tp-surface px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-tp-muted [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-tp-muted [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-tp-muted [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
