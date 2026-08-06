import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChatTranscript from '../../components-new/chat-transcript';
import ChatInput from '../../components-new/chat-input';
import ContextPanel from '../../components-new/context-panel';
import HarveyLayout from '../../layouts/harvey-layout';
import SearchPricings from '../../components/SearchPricings';
import type {
  ChatMessage,
  ChatRequest,
  ContextInputType,
  NotificationUrlEvent,
  PresetContextInput,
  PricingContextItem,
  PricingContextUrlWithId,
  PromptPreset,
} from '../../types/types';
import { PROMPT_PRESETS } from '../../prompts';
import { USE_CASES } from '../../use-cases';
import { PricingContext } from '../../context/pricingContext';
import {
  chatWithAgent,
  createContextBodyPayload,
  deleteYamlPricing,
  diffPricingContextWithDetectedUrls,
  extractHttpReferences,
  extractPricingUrls,
  uploadYamlPricing,
} from '../../utils';
import PlaygroundProvider from '../../components/PlaygroundProvider';
import PresetProvider from '../../components/PresetProvider';
import {
  playgroundMockUrlTrnasformEvent,
  sseUrlTransformEvent,
} from '../../sse';
import { UseCases } from '../../use-cases';

function PricingAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [contextItems, setContextItems] = useState<PricingContextItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [preset, setPreset] = useState<PromptPreset | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showMobileContext, setShowMobileContext] = useState(false);
  const [playground, setPlayground] = useState(false);
  const sessionVersionRef = useRef(0);

  useEffect(() => {
    const urlTransformEvent = playground
      ? playgroundMockUrlTrnasformEvent
      : sseUrlTransformEvent;

    return urlTransformEvent.connect((notification: NotificationUrlEvent) =>
      setContextItems(previous =>
        previous.map(item =>
          item.kind === 'url' && item.id === notification.id
            ? { ...item, transform: 'done', value: notification.yaml_content }
            : item
        )
      )
    );
  }, [playground]);

  const detectedPricingUrls = useMemo(() => extractPricingUrls(question), [question]);

  const isSubmitDisabled =
    isLoading || !question.trim() || (playground && messages.length > 0);

  const createPricingContextItems = (contextInputItems: ContextInputType[]): PricingContextItem[] =>
    contextInputItems
      .map(item => ({
        ...item,
        value: item.value.trim(),
        id: crypto.randomUUID(),
      }))
      .filter(
        item =>
          !contextItems.some(
            stateItem => stateItem.kind === item.kind && stateItem.value === item.value
          )
      );

  const addContextItems = (inputs: ContextInputType[]) => {
    if (inputs.length === 0) return null;

    const newPricingContextItems: PricingContextItem[] = createPricingContextItems(inputs);

    if (!playground) {
      const uploadPromises = newPricingContextItems
        .filter(
          item =>
            item.kind === 'yaml' &&
            item.origin &&
            (item.origin === 'user' || item.origin === 'preset')
        )
        .map(item => uploadYamlPricing(`${item.id}.yaml`, item.value));

      if (uploadPromises.length > 0) {
        Promise.all(uploadPromises).catch(err => console.error('Upload failed', err));
      }
    }

    setContextItems(previous => [...previous, ...newPricingContextItems]);
    return newPricingContextItems;
  };

  const addContextItem = (input: ContextInputType) => {
    addContextItems([input]);
  };

  const removeContextItem = (id: string) => {
    if (!playground) {
      const deletePromises = contextItems
        .filter(
          item =>
            item.id === id &&
            item.kind === 'yaml' &&
            item.origin &&
            (item.origin === 'user' || item.origin === 'preset')
        )
        .map(item => deleteYamlPricing(`${item.id}.yaml`));
      if (deletePromises.length > 0) {
        Promise.all(deletePromises);
      }
    }
    setContextItems(previous => previous.filter(item => item.id !== id));
  };

  const removeSphereContextItem = (sphereId: string) => {
    setContextItems(previous =>
      previous.filter(item => item.origin && item.origin === 'sphere' && item.sphereId !== sphereId)
    );
  };

  const clearContext = () => {
    setContextItems([]);
    if (!playground) {
      const storedYamls = contextItems
        .filter(
          item =>
            (item.kind === 'yaml' && item.origin && item.origin !== 'sphere') ||
            (item.kind === 'url' && item.transform === 'done')
        )
        .map(item => deleteYamlPricing(`${item.id}.yaml`));
      Promise.all(storedYamls).catch(() => console.error('Failed to delete yamls'));
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const sessionVersion = sessionVersionRef.current;
    const fileArray = Array.from(files);
    Promise.all(fileArray.map(file => file.text().then(content => ({ name: file.name, content }))))
      .then(results => {
        if (sessionVersion !== sessionVersionRef.current) return;

        const inputs: ContextInputType[] = results
          .filter(result => Boolean(result.content.trim()))
          .map(result => ({
            kind: 'yaml',
            label: result.name,
            value: result.content,
            origin: 'user',
          }));

        if (inputs.length > 0) addContextItems(inputs);

        if (inputs.length !== results.length) {
          setMessages(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: 'One or more uploaded files were empty and were skipped.',
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      })
      .catch(error => {
        if (sessionVersion !== sessionVersionRef.current) return;

        console.error('Failed to read YAML file', error);
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Could not read the uploaded file. Please try again.',
            createdAt: new Date().toISOString(),
          },
        ]);
      });
  };

  const mapPresetContexttoContext = (contextInput: PresetContextInput): ContextInputType => {
    if (contextInput.kind === 'url') {
      return {
        kind: 'url',
        label: contextInput.label,
        value: contextInput.value,
        url: contextInput.value,
        transform: 'not-started',
        origin: 'preset',
      };
    }
    return { kind: 'yaml', label: contextInput.label, value: contextInput.value, origin: 'preset' };
  };

  const handlePromptSelect = (preset: PromptPreset) => {
    setPreset(preset);
    setQuestion(preset.question);
    if (preset.context.length > 0) {
      const mappedInput: ContextInputType[] = preset.context.map(entry =>
        mapPresetContexttoContext(entry)
      );
      addContextItems(mappedInput);
    }
  };

  const handleNewConversation = () => {
    sessionVersionRef.current += 1;
    setMessages([]);
    setQuestion('');
    setContextItems([]);
    setIsLoading(false);
    setPreset(null);
  };

  const handlePlaygroundToggle = () => {
    clearContext();
    handleNewConversation();
    setShowSearchModal(false);
    setShowMobileContext(false);
    setPlayground(previous => !previous);
  };

  const getUrlItems = () =>
    contextItems.filter(item => item.kind === 'url').map(item => ({ id: item.id, url: item.url }));

  const getUniqueYamlFiles = () =>
    Array.from(new Set(contextItems.filter(item => item.kind === 'yaml').map(item => item.value)));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitDisabled) return;

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;
    const sessionVersion = sessionVersionRef.current;

    const newlyDetected = diffPricingContextWithDetectedUrls(contextItems, detectedPricingUrls);
    let newUrls: PricingContextUrlWithId[] = [];
    if (newlyDetected.length > 0) {
      const newItems = addContextItems(
        newlyDetected.map(url => ({
          kind: 'url',
          url,
          label: url,
          value: url,
          origin: 'detected',
          transform: 'pending',
        }))
      );
      newUrls = newItems
        ? newItems.filter(item => item.kind === 'url').map(item => ({ id: item.id, url: item.url }))
        : [];
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedQuestion,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    setQuestion('');
    setIsLoading(true);
    setContextItems(prev =>
      prev.map(item => (item.kind === 'url' ? { ...item, transform: 'pending' } : item))
    );

    try {
      const requestBody: ChatRequest = {
        question: trimmedQuestion,
        ...createContextBodyPayload([...getUrlItems(), ...newUrls], getUniqueYamlFiles()),
      };
      const data = await chatWithAgent(requestBody);
      if (sessionVersion !== sessionVersionRef.current) return;

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer ?? 'No response available.',
        createdAt: new Date().toISOString(),
        metadata: {
          plan: data.plan ?? undefined,
          result: data.result ?? undefined,
        },
      };
      setMessages(prev => [...prev, assistantMessage]);

      const planReferences = extractHttpReferences(data?.plan);
      const resultReferences = extractHttpReferences(data?.result);
      const agentDiscoveredUrls = [...planReferences, ...resultReferences];
      const newAgentDiscovered = diffPricingContextWithDetectedUrls(contextItems, agentDiscoveredUrls);
      if (newAgentDiscovered.length > 0) {
        addContextItems(
          newAgentDiscovered.map(url => ({
            kind: 'url',
            url,
            label: url,
            value: url,
            origin: 'agent',
            transform: 'not-started',
          }))
        );
      }
    } catch (error) {
      if (sessionVersion !== sessionVersionRef.current) return;

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${(error as Error).message}`,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } finally {
      if (sessionVersion === sessionVersionRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handlePlaygroundSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (isSubmitDisabled || !preset) return;

    const createdAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `${preset.id}-user`,
      role: 'user',
      content: preset.question,
      createdAt,
    };
    const assistantMessage: ChatMessage = {
        id: preset.id,
        role: 'assistant',
        content: preset.response?.answer ?? '',
        createdAt,
        metadata: {
          plan: preset.response?.plan ?? {},
          result: preset.response?.result ?? {},
        },
    };

    if (preset.id === UseCases.AMINT) {
      setContextItems(items =>
        items.map(item => (item.kind === 'url' ? { ...item, transform: 'done' } : item))
      );
    }
    setMessages([userMessage, assistantMessage]);
    setQuestion('');
  };

  return (
    <PlaygroundProvider playground={playground}>
      <PresetProvider presetContext={{ preset, setPreset }}>
        <PricingContext.Provider value={contextItems}>
          <HarveyLayout isPlayground={playground} onTogglePlayground={handlePlaygroundToggle} onNewConversation={handleNewConversation}>
            <div className="flex flex-1 overflow-hidden">
              {/* Chat area */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {playground && (
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
                    Playground mode — responses are pre-scripted
                  </div>
                )}

                <ChatTranscript
                  messages={messages}
                  isLoading={isLoading}
                  promptPresets={playground ? USE_CASES : PROMPT_PRESETS}
                  onPresetSelect={handlePromptSelect}
                />

                <ChatInput
                  question={question}
                  isSubmitting={isLoading}
                  isDisabled={playground && messages.length > 0}
                  isSubmitDisabled={isSubmitDisabled}
                  isInputLocked={playground}
                  onQuestionChange={setQuestion}
                  onSubmit={!playground ? handleSubmit : handlePlaygroundSubmit}
                  onFileDrop={handleFilesSelected}
                  onOpenContext={() => setShowMobileContext(true)}
                />
              </div>

              {/* Context panel (desktop) */}
              <div className="hidden w-80 shrink-0 border-l border-tp-hairline lg:block">
                <ContextPanel
                  items={contextItems}
                  detectedUrls={detectedPricingUrls}
                  isPlayground={playground}
                  onAdd={addContextItem}
                  onRemove={removeContextItem}
                  onClear={clearContext}
                  onOpenSearch={() => setShowSearchModal(true)}
                />
              </div>
            </div>
          </HarveyLayout>

          {/* Mobile context panel overlay */}
          <AnimatePresence>
            {showMobileContext && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-40 cursor-pointer bg-tp-ink/50 lg:hidden"
                  onClick={() => setShowMobileContext(false)}
                />
                <motion.div
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'tween', duration: 0.2 }}
                  className="fixed bottom-0 right-0 top-0 z-50 w-80 max-w-[85vw] border-l border-tp-hairline bg-tp-canvas shadow-elevation-4 lg:hidden"
                >
                  <ContextPanel
                    items={contextItems}
                    detectedUrls={detectedPricingUrls}
                    isPlayground={playground}
                    onAdd={addContextItem}
                    onRemove={removeContextItem}
                    onClear={clearContext}
                    onOpenSearch={() => { setShowMobileContext(false); setShowSearchModal(true); }}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Search Pricings Modal */}
          {showSearchModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-tp-ink/60 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-tp-hairline bg-tp-canvas p-4 shadow-elevation-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-tp-ink">Search Pricings</h3>
                  <button
                    type="button"
                    onClick={() => setShowSearchModal(false)}
                    className="cursor-pointer rounded-md border border-tp-hairline px-3 py-1.5 text-sm text-tp-steel hover:bg-tp-surface"
                  >
                    Close
                  </button>
                </div>
                <SearchPricings
                  onContextAdd={addContextItem}
                  onContextRemove={removeSphereContextItem}
                />
              </div>
            </div>
          )}
        </PricingContext.Provider>
      </PresetProvider>
    </PlaygroundProvider>
  );
}

export default PricingAssistantPage;
