import { asClass, asValue } from 'awilix';
import mongoose from 'mongoose';
import container from '../../../main/config/container';
import OrbitLlmClient, { LlmChatRequest, LlmChatResponse } from '../../../main/services/orbit/OrbitLlmClient';
import OrbitConversationMongoose from '../../../main/repositories/mongoose/models/OrbitConversationMongoose';
import OrbitPlanMongoose from '../../../main/repositories/mongoose/models/OrbitPlanMongoose';
import OrbitAuditLogMongoose from '../../../main/repositories/mongoose/models/OrbitAuditLogMongoose';
import { randomSuffix } from '../helpers';

export type FakeLlmStep = LlmChatResponse | ((request: LlmChatRequest) => LlmChatResponse);

/**
 * Replaces the language model with a script: each call to the model takes the
 * next step, either a canned answer or a function of the request. Every request
 * is recorded so tests can check what the model was shown.
 */
export const installFakeLlm = (steps: FakeLlmStep[], configured = true, options: { stream?: boolean } = {}) => {
  const calls: LlmChatRequest[] = [];
  const queue = [...steps];
  const chat = async (request: LlmChatRequest) => {
    calls.push(JSON.parse(JSON.stringify(request)));
    const next = queue.shift();
    if (!next) throw new Error('Fake LLM: no scripted response left');
    return typeof next === 'function' ? next(request) : next;
  };
  container.register({
    orbitLlmClient: asValue({
      isConfigured: () => configured,
      chat,
      // When streaming, the text of every answer is handed over word by word.
      ...(options.stream
        ? {
            chatStream: async (request: LlmChatRequest, onDelta: (text: string) => void) => {
              const response = await chat(request);
              for (const piece of (response.content ?? '').split(/(?<= )/)) if (piece) onDelta(piece);
              return response;
            },
          }
        : {}),
    }),
  });
  return { calls, remaining: () => queue.length };
};

export const restoreLlm = () => {
  container.register({ orbitLlmClient: asClass(OrbitLlmClient).singleton() });
};

export const toolCall = (name: string, args: Record<string, unknown>): LlmChatResponse => ({
  content: null,
  toolCalls: [
    { id: `call_${randomSuffix()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ],
});

export const answer = (content: string): LlmChatResponse => ({ content, toolCalls: [] });

/** The tool results the model was sent in a request. */
export const toolResultsIn = (request: LlmChatRequest) =>
  request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)));

/** Reads a server-sent events body into its events. */
export const parseSse = (text: string): Array<{ event: string; data: any }> =>
  text
    .split('\n\n')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const event = block.match(/^event: (.*)$/m)?.[1] ?? 'message';
      const data = block.match(/^data: (.*)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });

export const cleanupOrbitData = async (userIds: string[]) => {
  const ids = userIds.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id));
  await OrbitConversationMongoose.deleteMany({ _userId: { $in: ids } });
  await OrbitPlanMongoose.deleteMany({ _userId: { $in: ids } });
  await OrbitAuditLogMongoose.deleteMany({ _userId: { $in: ids } });
};
