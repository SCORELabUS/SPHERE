import { check } from 'express-validator';

/**
 * The values `unlisted` takes, in a JSON body or a multipart form: exactly the
 * ones `parseBooleanField` reads, so nothing passes validation to be read as
 * something else.
 */
const UNLISTED_VALUES = ['true', 'false'];

const unlisted = () =>
  check('unlisted')
    .optional()
    .isIn(UNLISTED_VALUES)
    .withMessage('The unlisted field must be boolean');

const create = [
  check('private')
    .exists({ checkNull: true, checkFalsy: true })
    .isBoolean()
    .withMessage('The private field is required and must be boolean'),
  check('collectionId')
    .optional()
    .isString()
    .withMessage('The collectionId field must be a string')
    .trim(),
  check('name')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
  // Only read when the upload creates a pricing; a new version takes its pricing's.
  unlisted(),
];

// Only the fields a client may change; PricingService.update refuses the rest
// (the stored file, organization, collection, identity, dates and analytics).
const update = [
  check('name')
    .optional()
    .isString()
    .withMessage('The name field must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('The name must have between 1 and 255 characters long')
    .trim(),
  check('private')
    .optional()
    .isBoolean()
    .withMessage('The private field must be boolean'),
  unlisted(),
  check('url')
    .optional()
    .isURL()
    .withMessage('The url field must be a valid URL')
    .trim(),
];

const updateVersion = [
  check('private')
    .exists({ checkNull: true })
    .withMessage('The private field is required')
    .isBoolean()
    .withMessage('The private field must be boolean')
    .toBoolean(),
];

export { create, update, updateVersion };
