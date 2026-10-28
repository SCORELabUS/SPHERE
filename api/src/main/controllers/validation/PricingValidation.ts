import { check } from 'express-validator';

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
