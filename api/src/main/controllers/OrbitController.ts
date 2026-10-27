import container from '../config/container';
import OrbitService from '../services/orbit/OrbitService';
import OrbitMcpService from '../services/orbit/OrbitMcpService';
import { OrbitActor } from '../services/orbit/orbitAccess';
import { handleError } from '../utils/users/helpers';

function actorOf(req: any): OrbitActor {
  return { id: req.user.id, username: req.user.username, role: req.user.role };
}

// The chat gives a stream up as lost after 45 seconds of silence.
const HEARTBEAT_MS = 15_000;

function wantsEventStream(req: any): boolean {
  return String(req.headers?.accept ?? '').includes('text/event-stream');
}

/**
 * A server-sent events response that only commits to streaming with its first
 * event, so an error raised before anything happened (a missing plan, a full
 * rate limit) still answers with a plain status code and JSON body. Events
 * keep being produced if the client goes away; they are just no longer sent.
 */
function openEventStream(req: any, res: any) {
  let started = false;
  let clientGone = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  req.on('close', () => {
    clientGone = true;
    stopHeartbeat();
  });

  const send = (event: { type: string }) => {
    if (clientGone || res.writableEnded) return;
    if (!started) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      started = true;
      // A comment line now and then, ignored by the client, so it can tell a
      // long wait for the model from a connection that silently died.
      heartbeat = setInterval(() => {
        if (!clientGone && !res.writableEnded) res.write(': keep-alive\n\n');
      }, HEARTBEAT_MS);
    }
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  return {
    send,
    end: () => {
      stopHeartbeat();
      if (!res.writableEnded) res.end();
    },
    fail: (status: number, message: string) => {
      stopHeartbeat();
      if (!started) {
        res.status(status).send({ error: message });
      } else if (!res.writableEnded) {
        send({ type: 'error', error: message, status } as any);
        res.end();
      }
    },
  };
}

class OrbitController {
  private orbitService: OrbitService;

  constructor() {
    this.orbitService = container.resolve('orbitService');
    this.status = this.status.bind(this);
    this.listConversations = this.listConversations.bind(this);
    this.createConversation = this.createConversation.bind(this);
    this.showConversation = this.showConversation.bind(this);
    this.deleteConversation = this.deleteConversation.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.showPlan = this.showPlan.bind(this);
    this.confirmPlan = this.confirmPlan.bind(this);
    this.cancelPlan = this.cancelPlan.bind(this);
    this.mcp = this.mcp.bind(this);
    this.mcpMethodNotAllowed = this.mcpMethodNotAllowed.bind(this);
  }

  async status(req: any, res: any) {
    res.json(this.orbitService.status());
  }

  async listConversations(req: any, res: any) {
    try {
      res.json(await this.orbitService.listConversations(actorOf(req)));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async createConversation(req: any, res: any) {
    try {
      res.status(201).json(await this.orbitService.createConversation(actorOf(req)));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async showConversation(req: any, res: any) {
    try {
      res.json(await this.orbitService.getConversation(actorOf(req), req.params.conversationId));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async deleteConversation(req: any, res: any) {
    try {
      await this.orbitService.deleteConversation(actorOf(req), req.params.conversationId);
      res.status(204).send();
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  /**
   * Sends a message to ORBIT. Clients that accept server-sent events get the
   * turn as it happens (what ORBIT is doing, and its answer as it is written);
   * anyone else gets the finished turn as JSON.
   */
  async sendMessage(req: any, res: any) {
    const input = { content: req.body?.content, attachment: req.body?.attachment };

    if (!wantsEventStream(req)) {
      try {
        const result = await this.orbitService.sendMessage(actorOf(req), req.params.conversationId, input);
        res.status(201).json(result);
      } catch (err: any) {
        const { status, message } = handleError(err);
        res.status(status).send({ error: message });
      }
      return;
    }

    const stream = openEventStream(req, res);
    try {
      const result = await this.orbitService.sendMessage(actorOf(req), req.params.conversationId, input, stream.send);
      stream.send({ type: 'done', ...result });
      stream.end();
    } catch (err: any) {
      const { status, message } = handleError(err);
      stream.fail(status, message);
    }
  }

  async showPlan(req: any, res: any) {
    try {
      res.json(await this.orbitService.getPlan(actorOf(req), req.params.planId));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  /**
   * Runs a confirmed plan and streams its progress as server-sent events. The
   * run carries on if the client goes away; the plan keeps the outcome, so it
   * can be read back afterwards.
   */
  async confirmPlan(req: any, res: any) {
    const stream = openEventStream(req, res);
    try {
      await this.orbitService.confirmPlan(actorOf(req), req.params.planId, stream.send, req.body?.confirmation);
      stream.end();
    } catch (err: any) {
      const { status, message } = handleError(err);
      stream.fail(status, message);
    }
  }

  async cancelPlan(req: any, res: any) {
    try {
      res.json(await this.orbitService.cancelPlan(actorOf(req), req.params.planId));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  /** The MCP endpoint, for assistants that use ORBIT's tools with one of the user's API keys. */
  async mcp(req: any, res: any) {
    if (req.authType !== 'api-key' || !req.user?.apiKey) {
      res.status(401).json(mcpError('UNAUTHORIZED: The MCP endpoint takes one of your API keys, in the x-api-key header'));
      return;
    }
    try {
      const mcpService: OrbitMcpService = container.resolve('orbitMcpService');
      await mcpService.handle(actorOf(req), req.user.apiKey, req, res, req.body);
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json(mcpError(String(err?.message ?? err)));
    }
  }

  /** The server keeps no sessions, so there is no stream to open with GET nor session to end with DELETE. */
  async mcpMethodNotAllowed(req: any, res: any) {
    res.status(405).set('Allow', 'POST').json(mcpError('Method not allowed: send MCP messages with POST'));
  }
}

function mcpError(message: string) {
  return { jsonrpc: '2.0', error: { code: -32000, message }, id: null };
}

export default OrbitController;
