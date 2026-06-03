import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { retrievePricingFromYaml } from 'pricing4ts';
import HarveyChatBubble from './harvey-chat-bubble';
import HarveyChatPanel from './harvey-chat-panel';
import type { ChatMessage } from '../../../../modules/harvey/types/types';

export interface SuggestedQuestion {
  id: string;
  label: string;
  question: string;
}

interface HarveyChatProps {
  yamlContent: string;
  pricingSlug?: string;
  organizationId?: string;
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
  pricingSlug,
  organizationId,
  suggestedQuestions = [],
}: HarveyChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
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
        content: buildWelcomeMessage(pricingName),
        createdAt: new Date().toISOString(),
      };
      setMessages([greeting]);
    }
  }, [isOpen, pricingName]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      console.log('[HARVEY Chat] User message:', trimmed);
      console.log('[HARVEY Chat] Pricing context:', { pricingName, pricingSlug, organizationId });
      console.log('[HARVEY Chat] YAML content:', yamlContent);

      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue('');

      setTimeout(() => {
        const ack: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: `Thanks for your question about **${pricingName ?? 'this pricing'}**! In a future version, I'll provide a detailed analysis. For now, this is a prototype — your message was logged to the console.`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, ack]);
      }, 600);
    },
    [pricingName, pricingSlug, organizationId, yamlContent],
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
          />
        )}
      </AnimatePresence>

      <HarveyChatBubble isOpen={isOpen} onClick={handleToggle} />
    </>
  );
}

function buildWelcomeMessage(pricingName: string | null): string {
  if (pricingName) {
    return (
      `Hi there! I'm **H.A.R.V.E.Y.** — Holistic Agent for Reasoning on Value and Economic analYsis.\n\n` +
      `I'm here to help you with questions about the **${pricingName}** pricing. Feel free to ask anything — ` +
      `pricing structure, plan comparisons, feature analysis, or optimization suggestions.\n\n` +
      `Here are some questions you might find useful:`
    );
  }
  return (
    `Hi there! I'm **H.A.R.V.E.Y.** — Holistic Agent for Reasoning on Value and Economic analYsis.\n\n` +
    `I'm here to help you with any pricing questions. Ask me about subscriptions, ` +
    `plan comparisons, feature analysis, or optimization strategies.`
  );
}
