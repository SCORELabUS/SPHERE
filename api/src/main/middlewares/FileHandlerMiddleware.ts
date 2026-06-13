import fs from 'fs';
import multer from 'multer';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import {v4 as uuidv4} from 'uuid';
import { sanitizePathSegment } from '../utils/path-utils';
import path from 'path';

const addFilenameToBody = (...fieldNames: string[]) => (req: any, res: any, next: NextFunction) => {
  fieldNames.forEach(fieldName => {
    if (req.files && req.files[fieldName]) {
      let destination = req.files[fieldName][0].destination;
      if (destination.startsWith('public/')) {
        destination = destination.substring('public/'.length);
      }
      req.body[fieldName] = destination + '/' + req.files[fieldName][0].filename;
    } else if (req.file && req.file.fieldname === fieldName) {
      let destination = req.file.destination;
      if (destination.startsWith('public/')) {
        destination = destination.substring('public/'.length);
      }
      req.body[fieldName] = destination + '/' + req.file.filename;
    }
  });
  return next();
};

const handleFileUpload = (imageFieldNames: string[], folder: string): RequestHandler => {
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      fs.mkdirSync(folder, { recursive: true });
      cb(null, folder);
    },
    filename: function (req, file, cb) {
      cb(null, Math.random().toString(36).substring(7) + '-' + Date.now() + '.' + file.originalname.split('.').pop());
    }
  });

  if (imageFieldNames.length === 1) {
    return multer({ storage }).single(imageFieldNames[0]);
  } else {
    const fields = imageFieldNames.map(imageFieldName => { return { name: imageFieldName, maxCount: 1 }; });
    return multer({ storage }).fields(fields);
  }
};

const handlePricingUpload = (pricingFieldNames: string[], baseFolder: string): RequestHandler => {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const saasName = sanitizePathSegment(req.body?.saasName, "unknown-saas");
        const targetDir = path.resolve(baseFolder, saasName);

        // Ensure the directory exists
        fs.mkdirSync(targetDir, { recursive: true });

        cb(null, targetDir);
      } catch (error) {
        cb(error as Error, baseFolder);
      }
    },

    filename: (req, file, cb) => {
      try {
        if (!file) {
          cb(new Error("File does not exist"), "fail.yml");
          return;
        }

        const version = sanitizePathSegment(req.body?.version, "0.0.0");

        // Keep original extension (including .yml / .yaml)
        const ext = path.extname(file.originalname) || ".yml";

        cb(null, `${version}${ext}`);
      } catch (error) {
        cb(error as Error, "fail.yml");
      }
    }
  });

  if (pricingFieldNames.length === 1) {
    return multer({ storage }).single(pricingFieldNames[0]);
  }

  const fields = pricingFieldNames.map((name) => ({ name, maxCount: 1 }));
  return multer({ storage }).fields(fields);
};

const handleCollectionUpload = (
  collectionFieldNames: string[],
  baseFolder: string
): RequestHandler => {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        const targetDir = path.resolve(baseFolder);

        fs.mkdirSync(targetDir, { recursive: true });

        cb(null, targetDir);
      } catch (error) {
        cb(error as Error, baseFolder);
      }
    },

    filename: (_req, file, cb) => {
      try {
        if (!file) {
          cb(new Error("File does not exist"), "fail.zip");
          return;
        }

        const extension = path.extname(file.originalname) || ".zip";

        cb(null, `${uuidv4()}${extension}`);
      } catch (error) {
        cb(error as Error, "fail.zip");
      }
    }
  });

  if (collectionFieldNames.length === 1) {
    return multer({
      storage,
      limits: { fileSize: 2 * 1024 * 1024 }
    }).single(collectionFieldNames[0]);
  }

  const fields = collectionFieldNames.map((name) => ({
    name,
    maxCount: 1
  }));

  return multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }
  }).fields(fields);
};
export { handleFileUpload, addFilenameToBody, handlePricingUpload, handleCollectionUpload };
