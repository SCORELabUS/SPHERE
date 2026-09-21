import express, {Application} from "express";
import * as dotenv from "dotenv";
import routes from "./routes/index";
import loadGlobalMiddlewares from "./middlewares/GlobalMiddlewaresLoader";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { disconnectMongoose, initMongoose } from "./config/mongoose";
import { seedDatabase } from "./database/seeders/mongo/seeder";
import { initRedis } from "./config/redis";
import container from "./config/container";

const green = "\x1b[32m"; // Color verde
const blue = "\x1b[36m"; // Color azul
const reset = "\x1b[0m"; // Resetear el estilo al final de la línea
const bold = "\x1b[1m"; // Negrita

const initializeApp = async () => {
  dotenv.config();
  const app: Application = express();
  loadGlobalMiddlewares(app);
  await routes(app);
  await initializeDatabase();
  const redisClient = await initRedis();
  container.resolve("cacheService").setRedisClient(redisClient);

  // Redis is shared with other local applications. CacheService namespaces
  // SPHERE keys, so startup must not issue the global FLUSHALL command.

  // await postInitializeDatabase(app)
  return app;
};

const initializeServer = async (): Promise<{
  server: Server;
  app: Application;
}> => {
  const app: Application = await initializeApp();
  const port = process.env.SERVER_PORT || 3000;
  // Using a promise to ensure the server is started before returning it
  const server: Server = await new Promise((resolve, reject) => {
    const server = app.listen(port, (err?: Error) => {
      if (err) return reject(err);
      resolve(server);
    });
  });

  const addressInfo: AddressInfo = server.address() as AddressInfo;

  console.log(
    `  ${green}➜${reset}  ${bold}API:${reset}     ${blue}http://localhost:${bold}${addressInfo.port}/${reset}`
  );

  if (['development', 'testing'].includes(process.env.ENVIRONMENT ?? '')) {
    console.log(`${green}➜${reset}  ${bold}Loaded Routes:${reset}`);
    app._router.stack
      .filter((layer: any) => layer.route)
      .forEach((layer: any) => {
        console.log(`  ${blue}${layer.route.path}${reset}`);
      });
  }

  return { server, app };
};

const initializeDatabase = async () => {
  let connection;
  try {
    switch (process.env.DATABASE_TECHNOLOGY) {
      case "mongoDB":
        connection = await initMongoose();
        break;
      default:
        throw new Error("Unsupported database technology");
    }
  } catch (error) {
    console.error(error);
  }
  return connection;
};

const disconnectDatabase = async () => {
  try {
    switch (process.env.DATABASE_TECHNOLOGY) {
      case "mongoDB":
        await disconnectMongoose();
        break;
      default:
        throw new Error("Unsupported database technology");
    }
  } catch (error) {
    console.error(error);
  }
};

export { initializeServer, disconnectDatabase };
