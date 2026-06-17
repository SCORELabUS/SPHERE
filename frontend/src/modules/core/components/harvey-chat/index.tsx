import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { retrievePricingFromYaml } from 'pricing4ts';
import HarveyChatBubble from './harvey-chat-bubble';
import HarveyChatPanel from './harvey-chat-panel';
import { chatWithAgent, createContextBodyPayload } from '../../../harvey/utils';
import type { ChatMessage, ChatRequest } from '../../../harvey/types/types';

export interface SuggestedQuestion {
  id: string;
  label: string;
  question: string;
}

interface HarveyChatProps {
  yamlContent: string;
  pricingVersion?: string;
  suggestedQuestions?: SuggestedQuestion[];
}

let messageIdCounter = 0;
function nextId() {
  return `chat-${Date.now()}-${++messageIdCounter}`;
}

function extractPricingName(yaml: string): string | null {
  try {
    const pricing = retrievePricingFromYaml(yaml);
    return pricing.saasName ?? null;
  } catch {
    // Fallback: try to extract saasName via regex for non-3.1 YAML
    const match = yaml.match(/saasName:\s*["']?([^"'\n]+)["']?/);
    return match?.[1]?.trim() ?? null;
  }
}

export default function HarveyChat({
  yamlContent,
  pricingVersion,
  suggestedQuestions = [],
}: HarveyChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const hasOpened = useRef(false);

  const pricingName = useMemo(
    () => (yamlContent ? extractPricingName(yamlContent) : null),
    [yamlContent],
  );

  useEffect(() => {
    if (isOpen && !hasOpened.current) {
      hasOpened.current = true;
      const greeting: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: buildWelcomeMessage(pricingName, pricingVersion),
        createdAt: new Date().toISOString(),
      };
      setMessages([greeting]);
    }
  }, [isOpen, pricingName, pricingVersion]);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue('');
      setIsLoading(true);

      try {
        const requestBody: ChatRequest = {
          question: trimmed,
          ...createContextBodyPayload([], yamlContent ? [yamlContent] : []),
        };
        const data = await chatWithAgent(requestBody);

        const assistantMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: data.answer ?? 'No response available.',
          createdAt: new Date().toISOString(),
          metadata: {
            plan: data.plan ?? undefined,
            result: data.result ?? undefined,
          },
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (error) {
        const errorMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${(error as Error).message}. Please try again.`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, yamlContent],
  );

  const handleSuggestionClick = useCallback(
    (question: string) => {
      handleSend(question);
    },
    [handleSend],
  );

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <HarveyChatPanel
            messages={messages}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSend={handleSend}
            onSuggestionClick={handleSuggestionClick}
            onClose={handleToggle}
            pricingName={pricingName ?? undefined}
            suggestedQuestions={suggestedQuestions}
            isLoading={isLoading}
          />
        )}
      </AnimatePresence>

      <HarveyChatBubble isOpen={isOpen} onClick={handleToggle} />
    </>
  );
}

function buildWelcomeMessage(pricingName: string | null, pricingVersion?: string): string {
  if (pricingName) {
    const versionText = pricingVersion ? ` (version **${pricingVersion}**)` : '';
    return (
      `Hi there! I'm **H.A.R.V.E.Y.** \u2014 Holistic Agent for Reasoning on Value and Economic analYsis.\n\n` +
      `I'm here to help you with questions about the **${pricingName}**${versionText} pricing. Feel free to ask anything \u2014 ` +
      `pricing structure, plan comparisons, feature analysis, or optimization suggestions.\n\n` +
      `Here are some questions you might find useful:`
    );
  }
  return (
    `Hi there! I'm **H.A.R.V.E.Y.** \u2014 Holistic Agent for Reasoning on Value and Economic analYsis.\n\n` +
    `I'm here to help you with any pricing questions. Ask me about subscriptions, ` +
    `plan comparisons, feature analysis, or optimization strategies.`
  );
}
