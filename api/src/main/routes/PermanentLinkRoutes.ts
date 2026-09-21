import express from 'express';
import { createHash } from 'node:crypto';
import archiver from 'archiver';
import PermanentLinkService from '../services/PermanentLinkService';

export default function loadRoutes(app: express.Application) {
  const service = new PermanentLinkService();
  const base = (process.env.BASE_URL_PATH ?? '') + '/api/v1';
  const respond = (operation: (req: any) => Promise<any>, isYaml = false) => async (req: any, res: any) => {
    try {
      const result = await operation(req);
      const body = typeof result === 'string' ? result : JSON.stringify(result);
      const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
      res.set('Cache-Control', 'private, no-cache').set('ETag', etag);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      return isYaml ? res.type('application/yaml').send(body) : res.json(result);
    } catch (error) {
      return res.status((error as Error).message === 'NOT FOUND' ? 404 : 503).json({ error: 'Resource unavailable' });
    }
  };
  app.get(base + '/permalinks/:resourceType/:resourceId', respond(req => service.resolve(req.params.resourceType, req.params.resourceId, req.user, req.authType)));
  app.get(base + '/public/pricings/:pricingId', respond(req => service.manifest(req.params.pricingId)));
  app.get(base + '/public/pricings/:pricingId/versions/:versionId/yaml', respond(req => service.download(req.params.pricingId, req.params.versionId), true));
  app.get(base + '/public/pricings/:pricingId/download', async (req: any, res: any) => {
    try {
      const entries = await service.archiveEntries(req.params.pricingId, req.user, req.authType);
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.pricingId}-versions.zip"`);
      res.setHeader('Content-Type', 'application/zip');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', error => {
        if (!res.headersSent) res.status(500).json({ error: 'Unable to generate archive' });
        else res.destroy(error);
      });
      archive.pipe(res);
      for (const entry of entries) archive.append(entry.content, { name: entry.name });
      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) res.status((error as Error).message === 'NOT FOUND' ? 404 : 503).json({ error: 'Resource unavailable' });
      else res.destroy(error as Error);
    }
  });
}
