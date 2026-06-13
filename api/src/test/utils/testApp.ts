import request from 'supertest';
import type { Server } from 'http';
import { initializeServer, disconnectDatabase } from '../../main/app';
import { Application } from 'express';
import mongoose from 'mongoose';

let testServer: Server | null = null;
let testApp: Application | null = null;

export type TestApp = Parameters<typeof request>[0];

const getApp = async (): Promise<TestApp> => {
  if (!testServer) {
    const { server, app } = await initializeServer();
    if (mongoose.connection.db) await mongoose.connection.db.dropDatabase();
    testServer = server;
    testApp = app;
  }
  return testServer as TestApp;
};

const shutdownApp = async () => {
  if (testServer) {
    testServer.close();
    await disconnectDatabase();
    testApp = null;
    testServer = null;
  }
};

export { getApp, shutdownApp };
