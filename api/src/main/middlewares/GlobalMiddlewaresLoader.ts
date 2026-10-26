import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { authenticationMiddleware } from './AuthenticationMiddleware';
import { authorizationMiddleware } from './AuthorizationMiddleware';

const loadGlobalMiddlewares = (app: express.Application) => {
  // Same limit as the body parser below: whichever parses first wins, and the
  // 100kb default would turn away files sent to ORBIT long before 2mb.
  app.use(express.json({ limit: '2mb' }));
  app.use(cors());
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );
  app.use(express.static('public'));
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use(bodyParser.urlencoded({ limit: '2mb', extended: true }));
  app.use(authenticationMiddleware);
  app.use(authorizationMiddleware);
};

export default loadGlobalMiddlewares;
