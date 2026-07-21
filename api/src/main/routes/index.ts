import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const basename = path.basename(__filename);

const loadRoutes = async function (app: express.Application) {
  return Promise.all(
    fs
      .readdirSync(__dirname)
      .filter(file => {
        return file.indexOf('.') !== 0 && file !== basename && file.slice(-3) === (["development"].includes(process.env.ENVIRONMENT ?? "") ? '.ts' : '.js');
      })
      .map(async file => {
        return import(`./${file}`);
      })
  ).then(routes => {
    return routes.forEach(route => {
      const loadFileRoutes = route.default;
      loadFileRoutes(app);
    });
  });
};

export default loadRoutes;
